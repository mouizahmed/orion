package calendarpush

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
)

const (
	googleCalendarListResource = "calendarList"
	microsoftEventsResource    = "me/events"
)

type Config struct {
	Enabled     bool
	BaseURL     string
	RenewBefore time.Duration
	loadErr     error
}

func LoadConfig() Config {
	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("CALENDAR_WEBHOOK_BASE_URL")), "/")
	enabled := baseURL != ""
	if raw := strings.TrimSpace(os.Getenv("CALENDAR_PUSH_ENABLED")); raw != "" {
		if parsed, err := strconv.ParseBool(raw); err == nil {
			enabled = parsed
		} else {
			return Config{Enabled: true, BaseURL: baseURL, RenewBefore: 24 * time.Hour,
				loadErr: fmt.Errorf("CALENDAR_PUSH_ENABLED must be a boolean: %w", err)}
		}
	}
	return Config{Enabled: enabled, BaseURL: baseURL, RenewBefore: 24 * time.Hour}
}

func (c Config) Validate() error {
	if c.loadErr != nil {
		return c.loadErr
	}
	if !c.Enabled {
		return nil
	}
	if strings.TrimSpace(c.BaseURL) == "" {
		return fmt.Errorf("CALENDAR_WEBHOOK_BASE_URL is required when calendar push is enabled")
	}
	parsed, err := url.Parse(c.BaseURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("CALENDAR_WEBHOOK_BASE_URL must be an absolute HTTPS URL without query or fragment")
	}
	return nil
}

type subscriptionRepository interface {
	ListCalendarWebhookSubscriptions(context.Context, string, string) ([]models.IntegrationWebhookSubscription, error)
	CreatePendingCalendarWebhookSubscription(context.Context, *models.IntegrationWebhookSubscription) (string, error)
	ActivateCalendarWebhookSubscription(context.Context, string, string, string, time.Time) error
	RenewCalendarWebhookSubscription(context.Context, string, string, time.Time) error
	UpdateCalendarWebhookSubscriptionState(context.Context, string, string, string, string, *time.Time) error
}

type Service struct {
	config        Config
	connections   repository.IntegrationConnectionRepository
	cache         repository.CalendarCacheRepository
	subscriptions subscriptionRepository
	client        *http.Client
	now           func() time.Time
}

func NewService(config Config, connections repository.IntegrationConnectionRepository, cache repository.CalendarCacheRepository, subscriptions subscriptionRepository) *Service {
	return &Service{config: config, connections: connections, cache: cache, subscriptions: subscriptions,
		client: &http.Client{Timeout: 8 * time.Second}, now: time.Now}
}

func (s *Service) Enabled() bool { return s != nil && s.config.Enabled }

func (s *Service) ReconcileConnection(ctx context.Context, userID, connectionID string) error {
	if !s.Enabled() {
		return nil
	}
	connection, err := s.connections.GetByID(userID, connectionID)
	if err != nil {
		return err
	}
	if connection == nil || connection.Status != models.IntegrationConnectionStatusActive {
		return nil
	}
	subscriptions, err := s.subscriptions.ListCalendarWebhookSubscriptions(ctx, userID, connectionID)
	if err != nil {
		return err
	}
	switch connection.Provider {
	case models.IntegrationProviderGoogle:
		return s.reconcileGoogle(ctx, connection, subscriptions)
	case models.IntegrationProviderMicrosoft:
		return s.reconcileMicrosoft(ctx, connection, subscriptions)
	default:
		return nil
	}
}

func (s *Service) PrepareConnectionCleanup(ctx context.Context, connection *models.IntegrationConnection) (func(context.Context) error, error) {
	if !s.Enabled() || connection == nil {
		return nil, nil
	}
	subscriptions, err := s.subscriptions.ListCalendarWebhookSubscriptions(ctx, connection.UserID, connection.ID)
	if err != nil {
		return nil, err
	}
	return func(cleanupCtx context.Context) error {
		var cleanupErrors []error
		for i := range subscriptions {
			subscription := &subscriptions[i]
			if subscription.Status == "disabled" {
				continue
			}
			if err := s.stopRemote(cleanupCtx, connection, subscription); err != nil {
				cleanupErrors = append(cleanupErrors, err)
			}
		}
		return errors.Join(cleanupErrors...)
	}, nil
}

func (s *Service) reconcileGoogle(ctx context.Context, connection *models.IntegrationConnection, existing []models.IntegrationWebhookSubscription) error {
	desired := map[string]string{googleCalendarListResource: "calendar-list"}
	sources, err := s.cache.ListCalendarSources(ctx, connection.UserID)
	if err != nil {
		return err
	}
	for _, source := range sources {
		if source.ConnectionID == connection.ID && source.Visible {
			desired["events:"+source.ID] = source.ID
		}
	}
	return s.reconcileDesired(ctx, connection, existing, desired)
}

func (s *Service) reconcileMicrosoft(ctx context.Context, connection *models.IntegrationConnection, existing []models.IntegrationWebhookSubscription) error {
	return s.reconcileDesired(ctx, connection, existing, map[string]string{microsoftEventsResource: microsoftEventsResource})
}

func (s *Service) reconcileDesired(ctx context.Context, connection *models.IntegrationConnection, existing []models.IntegrationWebhookSubscription, desired map[string]string) error {
	latest := map[string]*models.IntegrationWebhookSubscription{}
	for i := range existing {
		subscription := &existing[i]
		if current := latest[subscription.WatchedResourceID]; current == nil || subscription.Generation > current.Generation {
			latest[subscription.WatchedResourceID] = subscription
		}
	}
	var reconcileErrors []error
	for resourceKey, providerResource := range desired {
		current := latest[resourceKey]
		if current != nil && current.Status == "active" && current.ExpiresAt != nil && current.ExpiresAt.After(s.now().Add(s.config.RenewBefore)) {
			continue
		}
		if connection.Provider == models.IntegrationProviderMicrosoft && current != nil && current.ProviderSubscriptionID != "" && current.Status != "failed" {
			if err := s.renewMicrosoft(ctx, connection, current); err == nil {
				continue
			} else {
				reconcileErrors = append(reconcileErrors, err)
			}
		}
		if err := s.createSubscription(ctx, connection, resourceKey, providerResource, current); err != nil {
			reconcileErrors = append(reconcileErrors, err)
		}
	}
	for i := range existing {
		subscription := &existing[i]
		if _, wanted := desired[subscription.WatchedResourceID]; wanted || subscription.Status == "disabled" {
			continue
		}
		if err := s.stopRemote(ctx, connection, subscription); err != nil {
			reconcileErrors = append(reconcileErrors, err)
		}
		if err := s.subscriptions.UpdateCalendarWebhookSubscriptionState(ctx, connection.UserID, subscription.ID, "disabled", "", nil); err != nil {
			reconcileErrors = append(reconcileErrors, err)
		}
	}
	return errors.Join(reconcileErrors...)
}

func (s *Service) createSubscription(ctx context.Context, connection *models.IntegrationConnection, resourceKey, providerResource string, previous *models.IntegrationWebhookSubscription) error {
	secret, secretHash, err := newSecret()
	if err != nil {
		return err
	}
	if connection.Provider == models.IntegrationProviderGoogle {
		channelID, _, err := newSecret()
		if err != nil {
			return err
		}
		pending := &models.IntegrationWebhookSubscription{UserID: connection.UserID, ConnectionID: connection.ID,
			Provider: string(connection.Provider), ProviderSubscriptionID: channelID,
			WatchedResourceID: resourceKey, CallbackURL: s.googleCallbackURL(), VerificationSecretHash: secretHash}
		if previous != nil {
			pending.SupersedesID = &previous.ID
		}
		id, err := s.subscriptions.CreatePendingCalendarWebhookSubscription(ctx, pending)
		if err != nil {
			return err
		}
		providerResourceID, expiresAt, err := s.createGoogle(ctx, connection, resourceKey, providerResource, channelID, secret)
		if err != nil {
			retryAt := s.now().Add(5 * time.Minute)
			_ = s.subscriptions.UpdateCalendarWebhookSubscriptionState(ctx, connection.UserID, id, "failed", "provider_registration_failed", &retryAt)
			return err
		}
		if err := s.subscriptions.ActivateCalendarWebhookSubscription(ctx, connection.UserID, id, providerResourceID, expiresAt); err != nil {
			return err
		}
		if previous != nil {
			_ = s.subscriptions.UpdateCalendarWebhookSubscriptionState(ctx, connection.UserID, previous.ID, "retiring", "", nil)
			if err := s.stopRemote(ctx, connection, previous); err == nil {
				_ = s.subscriptions.UpdateCalendarWebhookSubscriptionState(ctx, connection.UserID, previous.ID, "disabled", "", nil)
			}
		}
		return nil
	}

	providerID, expiresAt, err := s.createMicrosoft(ctx, connection, secret)
	if err != nil {
		return err
	}
	pending := &models.IntegrationWebhookSubscription{UserID: connection.UserID, ConnectionID: connection.ID,
		Provider: string(connection.Provider), ProviderSubscriptionID: providerID,
		WatchedResourceID: resourceKey, CallbackURL: s.microsoftCallbackURL(), VerificationSecretHash: secretHash}
	if previous != nil {
		pending.SupersedesID = &previous.ID
	}
	id, err := s.subscriptions.CreatePendingCalendarWebhookSubscription(ctx, pending)
	if err != nil {
		return err
	}
	if err := s.subscriptions.ActivateCalendarWebhookSubscription(ctx, connection.UserID, id, "", expiresAt); err != nil {
		return err
	}
	if previous != nil {
		_ = s.subscriptions.UpdateCalendarWebhookSubscriptionState(ctx, connection.UserID, previous.ID, "disabled", "", nil)
	}
	return nil
}

func (s *Service) createGoogle(ctx context.Context, connection *models.IntegrationConnection, resourceKey, providerResource, channelID, secret string) (string, time.Time, error) {
	endpoint := "https://www.googleapis.com/calendar/v3/users/me/calendarList/watch"
	if resourceKey != googleCalendarListResource {
		endpoint = "https://www.googleapis.com/calendar/v3/calendars/" + url.PathEscape(providerResource) + "/events/watch"
	}
	body := map[string]any{"id": channelID, "type": "web_hook", "address": s.googleCallbackURL(), "token": secret,
		"params": map[string]string{"ttl": "604800"}}
	var response struct {
		ResourceID string `json:"resourceId"`
		Expiration string `json:"expiration"`
	}
	if err := s.providerJSON(ctx, http.MethodPost, endpoint, connection.AccessToken, body, &response); err != nil {
		return "", time.Time{}, err
	}
	millis, err := strconv.ParseInt(response.Expiration, 10, 64)
	if err != nil || response.ResourceID == "" {
		return "", time.Time{}, fmt.Errorf("invalid Google watch response")
	}
	return response.ResourceID, time.UnixMilli(millis).UTC(), nil
}

func (s *Service) createMicrosoft(ctx context.Context, connection *models.IntegrationConnection, secret string) (string, time.Time, error) {
	expiresAt := s.now().UTC().Add(3 * 24 * time.Hour)
	body := map[string]any{"changeType": "created,updated,deleted", "notificationUrl": s.microsoftCallbackURL(),
		"lifecycleNotificationUrl": s.microsoftCallbackURL(), "resource": microsoftEventsResource,
		"expirationDateTime": expiresAt.Format(time.RFC3339), "clientState": secret}
	var response struct {
		ID         string `json:"id"`
		Expiration string `json:"expirationDateTime"`
	}
	if err := s.providerJSON(ctx, http.MethodPost, "https://graph.microsoft.com/v1.0/subscriptions", connection.AccessToken, body, &response); err != nil {
		return "", time.Time{}, err
	}
	parsed, err := time.Parse(time.RFC3339Nano, response.Expiration)
	if err != nil || response.ID == "" {
		return "", time.Time{}, fmt.Errorf("invalid Microsoft subscription response")
	}
	return response.ID, parsed.UTC(), nil
}

func (s *Service) renewMicrosoft(ctx context.Context, connection *models.IntegrationConnection, subscription *models.IntegrationWebhookSubscription) error {
	expiresAt := s.now().UTC().Add(3 * 24 * time.Hour)
	body := map[string]string{"expirationDateTime": expiresAt.Format(time.RFC3339)}
	var response struct {
		Expiration string `json:"expirationDateTime"`
	}
	endpoint := "https://graph.microsoft.com/v1.0/subscriptions/" + url.PathEscape(subscription.ProviderSubscriptionID)
	if err := s.providerJSON(ctx, http.MethodPatch, endpoint, connection.AccessToken, body, &response); err != nil {
		retryAt := s.now().Add(5 * time.Minute)
		_ = s.subscriptions.UpdateCalendarWebhookSubscriptionState(ctx, connection.UserID, subscription.ID, "failed", "provider_renewal_failed", &retryAt)
		return err
	}
	parsed, err := time.Parse(time.RFC3339Nano, response.Expiration)
	if err != nil {
		return fmt.Errorf("invalid Microsoft renewal response")
	}
	return s.subscriptions.RenewCalendarWebhookSubscription(ctx, connection.UserID, subscription.ID, parsed.UTC())
}

func (s *Service) stopRemote(ctx context.Context, connection *models.IntegrationConnection, subscription *models.IntegrationWebhookSubscription) error {
	if subscription.ProviderSubscriptionID == "" {
		return nil
	}
	if connection.Provider == models.IntegrationProviderGoogle {
		if subscription.ProviderResourceID == "" {
			return nil
		}
		body := map[string]string{"id": subscription.ProviderSubscriptionID, "resourceId": subscription.ProviderResourceID}
		return s.providerJSON(ctx, http.MethodPost, "https://www.googleapis.com/calendar/v3/channels/stop", connection.AccessToken, body, nil)
	}
	endpoint := "https://graph.microsoft.com/v1.0/subscriptions/" + url.PathEscape(subscription.ProviderSubscriptionID)
	return s.providerJSON(ctx, http.MethodDelete, endpoint, connection.AccessToken, nil, nil)
}

func (s *Service) providerJSON(ctx context.Context, method, endpoint, accessToken string, input, output any) error {
	var encoded []byte
	if input != nil {
		var err error
		encoded, err = json.Marshal(input)
		if err != nil {
			return err
		}
	}
	for attempt := 0; attempt < 4; attempt++ {
		var body io.Reader
		if encoded != nil {
			body = bytes.NewReader(encoded)
		}
		req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		if input != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := s.client.Do(req)
		if err != nil {
			if attempt < 3 {
				if err := waitForRetry(ctx, time.Duration(1<<attempt)*time.Second); err != nil {
					return err
				}
				continue
			}
			return err
		}
		status := resp.StatusCode
		retryAfter := resp.Header.Get("Retry-After")
		if status == http.StatusTooManyRequests || status >= 500 {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
			_ = resp.Body.Close()
			if attempt < 3 {
				if err := waitForRetry(ctx, pushRetryDelay(retryAfter, attempt)); err != nil {
					return err
				}
				continue
			}
			return fmt.Errorf("provider subscription endpoint returned status %d", status)
		}
		if status < 200 || status >= 300 {
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
			_ = resp.Body.Close()
			return fmt.Errorf("provider subscription endpoint returned status %d", status)
		}
		if output == nil || status == http.StatusNoContent {
			_ = resp.Body.Close()
			return nil
		}
		err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(output)
		_ = resp.Body.Close()
		if err != nil {
			return fmt.Errorf("decode provider subscription response: %w", err)
		}
		return nil
	}
	return fmt.Errorf("provider subscription retry attempts exhausted")
}

func pushRetryDelay(retryAfter string, attempt int) time.Duration {
	if seconds, err := strconv.Atoi(strings.TrimSpace(retryAfter)); err == nil && seconds > 0 && seconds <= 60 {
		return time.Duration(seconds) * time.Second
	}
	return time.Duration(1<<attempt) * time.Second
}

func waitForRetry(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *Service) googleCallbackURL() string { return s.config.BaseURL + "/webhooks/calendar/google" }
func (s *Service) microsoftCallbackURL() string {
	return s.config.BaseURL + "/webhooks/calendar/microsoft"
}

func newSecret() (string, string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	secret := base64.RawURLEncoding.EncodeToString(raw)
	digest := sha256.Sum256([]byte(secret))
	return secret, hex.EncodeToString(digest[:]), nil
}
