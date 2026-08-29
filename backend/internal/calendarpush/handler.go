package calendarpush

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	calendar "github.com/mouizahmed/justscribe-backend/internal/calendar"
	"github.com/mouizahmed/justscribe-backend/internal/integrationworker"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

// repositoryContract is kept explicit to make the webhook's privileged lookup
// and tenant-scoped atomic write easy to audit.
type repositoryContract interface {
	ResolveCalendarWebhookSubscription(ctx context.Context, provider, providerSubscriptionID string) (*models.IntegrationWebhookSubscription, error)
	AcceptCalendarWebhook(ctx context.Context, subscription *models.IntegrationWebhookSubscription, providerEventID string, payload []byte, job *models.IntegrationJob) (bool, error)
	UpdateCalendarWebhookSubscriptionState(ctx context.Context, userID, id, status, errorCode string, nextAttemptAt *time.Time) error
}

type Handler struct {
	repository repositoryContract
	now        func() time.Time
}

func NewHandler(repository repositoryContract) *Handler {
	return &Handler{repository: repository, now: time.Now}
}

func (h *Handler) Google(c *gin.Context) {
	channelID := boundedHeader(c, "X-Goog-Channel-ID", 256)
	channelToken := boundedHeader(c, "X-Goog-Channel-Token", 512)
	messageNumber := boundedHeader(c, "X-Goog-Message-Number", 128)
	resourceState := boundedHeader(c, "X-Goog-Resource-State", 64)
	resourceID := boundedHeader(c, "X-Goog-Resource-ID", 256)
	if channelID == "" || channelToken == "" || messageNumber == "" || resourceState == "" {
		c.Status(http.StatusBadRequest)
		return
	}
	if _, err := strconv.ParseUint(messageNumber, 10, 64); err != nil ||
		(resourceState != "sync" && resourceState != "exists" && resourceState != "not_exists") {
		c.Status(http.StatusBadRequest)
		return
	}
	subscription, err := h.repository.ResolveCalendarWebhookSubscription(c.Request.Context(), "google", channelID)
	if err != nil {
		if err == sql.ErrNoRows {
			c.Status(http.StatusNoContent)
			return
		}
		c.Status(http.StatusServiceUnavailable)
		return
	}
	if !secretMatches(channelToken, subscription.VerificationSecretHash) {
		c.Status(http.StatusUnauthorized)
		return
	}
	if subscription.ProviderResourceID != "" && resourceID != subscription.ProviderResourceID {
		c.Status(http.StatusUnauthorized)
		return
	}
	payload := []byte(strings.Join([]string{channelID, messageNumber, resourceState, resourceID}, "\n"))
	job, err := integrationworker.CalendarConnectionSyncJob(subscription.UserID, subscription.ConnectionID,
		googleScope(subscription.WatchedResourceID), h.now(), 15*time.Second)
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}
	job.ProviderResourceKey = subscription.WatchedResourceID
	accepted, err := h.repository.AcceptCalendarWebhook(c.Request.Context(), subscription, channelID+":"+messageNumber, payload, job)
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	_ = accepted
	c.Status(http.StatusNoContent)
}

type microsoftNotificationEnvelope struct {
	Value []microsoftNotification `json:"value"`
}

type microsoftNotification struct {
	SubscriptionID         string          `json:"subscriptionId"`
	ClientState            string          `json:"clientState"`
	ChangeType             string          `json:"changeType"`
	Resource               string          `json:"resource"`
	LifecycleEvent         string          `json:"lifecycleEvent"`
	SubscriptionExpiration string          `json:"subscriptionExpirationDateTime"`
	ResourceData           json.RawMessage `json:"resourceData"`
}

func (h *Handler) Microsoft(c *gin.Context) {
	if values, exists := c.Request.URL.Query()["validationToken"]; exists {
		if len(values) != 1 || values[0] == "" || len(values[0]) > 4096 {
			c.Status(http.StatusBadRequest)
			return
		}
		c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(values[0]))
		return
	}
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, (1<<20)+1))
	if err != nil || len(body) > 1<<20 {
		c.Status(http.StatusRequestEntityTooLarge)
		return
	}
	var envelope microsoftNotificationEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil || len(envelope.Value) == 0 || len(envelope.Value) > 100 {
		c.Status(http.StatusBadRequest)
		return
	}
	for _, notification := range envelope.Value {
		if err := h.acceptMicrosoftNotification(c, notification); err != nil {
			c.Status(http.StatusServiceUnavailable)
			return
		}
	}
	c.Status(http.StatusAccepted)
}

func (h *Handler) acceptMicrosoftNotification(c *gin.Context, notification microsoftNotification) error {
	if notification.SubscriptionID == "" || len(notification.SubscriptionID) > 256 || len(notification.ClientState) > 512 {
		return nil
	}
	subscription, err := h.repository.ResolveCalendarWebhookSubscription(c.Request.Context(), "microsoft", notification.SubscriptionID)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return err
	}
	if !secretMatches(notification.ClientState, subscription.VerificationSecretHash) {
		return nil
	}
	forceFull := false
	if notification.LifecycleEvent != "" {
		var nextStatus string
		switch notification.LifecycleEvent {
		case "missed":
			forceFull = true
		case "subscriptionRemoved":
			forceFull = true
			nextStatus = "failed"
		case "reauthorizationRequired":
			forceFull = true
			nextStatus = "renewing"
		default:
			return nil
		}
		if nextStatus != "" {
			retryAt := h.now()
			if err := h.repository.UpdateCalendarWebhookSubscriptionState(c.Request.Context(), subscription.UserID, subscription.ID, nextStatus, "microsoft_"+notification.LifecycleEvent, &retryAt); err != nil {
				return err
			}
		}
	}
	if notification.LifecycleEvent == "" && notification.ChangeType != "created" && notification.ChangeType != "updated" && notification.ChangeType != "deleted" {
		return nil
	}
	var job *models.IntegrationJob
	if forceFull {
		job, err = integrationworker.CalendarConnectionFullSyncJob(subscription.UserID, subscription.ConnectionID, h.now())
	} else {
		job, err = integrationworker.CalendarConnectionSyncJob(subscription.UserID, subscription.ConnectionID, calendar.SyncScopeEvents, h.now(), 15*time.Second)
	}
	if err != nil {
		return err
	}
	job.ProviderResourceKey = subscription.WatchedResourceID
	raw, err := json.Marshal(notification)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(raw)
	// Graph has no universal notification ID. The content digest deduplicates
	// retries while the minute bucket permits a later identical-looking signal.
	eventID := fmt.Sprintf("%s:%s:%d", notification.SubscriptionID, hex.EncodeToString(digest[:]), h.now().UTC().Truncate(time.Minute).Unix())
	_, err = h.repository.AcceptCalendarWebhook(c.Request.Context(), subscription, eventID, raw, job)
	return err
}

func secretMatches(secret, expectedHash string) bool {
	digest := sha256.Sum256([]byte(secret))
	actual := hex.EncodeToString(digest[:])
	if len(actual) != len(expectedHash) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(actual), []byte(strings.ToLower(expectedHash))) == 1
}

func boundedHeader(c *gin.Context, name string, maximum int) string {
	values := c.Request.Header.Values(name)
	if len(values) != 1 {
		return ""
	}
	value := strings.TrimSpace(values[0])
	if len(value) > maximum {
		return ""
	}
	return value
}

func googleScope(resource string) calendar.SyncScope {
	if resource == googleCalendarListResource {
		return calendar.SyncScopeAll
	}
	return calendar.SyncScopeEvents
}
