package calendarpush

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
)

type fakeConnections struct {
	repository.IntegrationConnectionRepository
	connection *models.IntegrationConnection
}

func (f fakeConnections) GetByID(string, string) (*models.IntegrationConnection, error) {
	return f.connection, nil
}

type fakeCalendarCache struct {
	repository.CalendarCacheRepository
	sources []*models.CachedCalendarSource
}

func (f fakeCalendarCache) ListCalendarSources(context.Context, string) ([]*models.CachedCalendarSource, error) {
	return f.sources, nil
}

type fakeSubscriptions struct {
	items     []models.IntegrationWebhookSubscription
	pending   []*models.IntegrationWebhookSubscription
	activated int
}

func (f *fakeSubscriptions) ListCalendarWebhookSubscriptions(context.Context, string, string) ([]models.IntegrationWebhookSubscription, error) {
	return f.items, nil
}
func (f *fakeSubscriptions) CreatePendingCalendarWebhookSubscription(_ context.Context, item *models.IntegrationWebhookSubscription) (string, error) {
	copy := *item
	f.pending = append(f.pending, &copy)
	return "30a0ed8f-bcb7-4394-a0e6-a83e44cf4e54", nil
}
func (f *fakeSubscriptions) ActivateCalendarWebhookSubscription(context.Context, string, string, string, time.Time) error {
	f.activated++
	return nil
}
func (*fakeSubscriptions) RenewCalendarWebhookSubscription(context.Context, string, string, time.Time) error {
	return nil
}
func (*fakeSubscriptions) UpdateCalendarWebhookSubscriptionState(context.Context, string, string, string, string, *time.Time) error {
	return nil
}

type pushRoundTripFunc func(*http.Request) (*http.Response, error)

func (f pushRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestGoogleReconcileRegistersCalendarListAndVisibleCalendars(t *testing.T) {
	connection := &models.IntegrationConnection{ID: "20a0ed8f-bcb7-4394-a0e6-a83e44cf4e54", UserID: "10a0ed8f-bcb7-4394-a0e6-a83e44cf4e54", Provider: models.IntegrationProviderGoogle, Status: models.IntegrationConnectionStatusActive, AccessToken: "token"}
	subscriptions := &fakeSubscriptions{}
	service := NewService(Config{Enabled: true, BaseURL: "https://api.example.com", RenewBefore: 24 * time.Hour}, fakeConnections{connection: connection}, fakeCalendarCache{sources: []*models.CachedCalendarSource{
		{ID: "visible@example.com", ConnectionID: connection.ID, Visible: true},
		{ID: "hidden@example.com", ConnectionID: connection.ID, Visible: false},
	}}, subscriptions)
	var endpoints []string
	service.client = &http.Client{Transport: pushRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		endpoints = append(endpoints, request.URL.String())
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"resourceId":"resource","expiration":"1790000000000"}`))}, nil
	})}
	if err := service.ReconcileConnection(context.Background(), connection.UserID, connection.ID); err != nil {
		t.Fatal(err)
	}
	if len(subscriptions.pending) != 2 || subscriptions.activated != 2 || len(endpoints) != 2 {
		t.Fatalf("unexpected watch registrations pending=%d active=%d endpoints=%v", len(subscriptions.pending), subscriptions.activated, endpoints)
	}
	if subscriptions.pending[0].VerificationSecretHash == "" || subscriptions.pending[1].VerificationSecretHash == "" {
		t.Fatal("watch secrets were not stored as hashes")
	}
	for _, item := range subscriptions.pending {
		if strings.Contains(item.CallbackURL, "secret") || item.CallbackURL != "https://api.example.com/webhooks/calendar/google" {
			t.Fatalf("unsafe callback URL: %s", item.CallbackURL)
		}
	}
}

func TestPushConfigRequiresHTTPS(t *testing.T) {
	if err := (Config{Enabled: true, BaseURL: "http://api.example.com"}).Validate(); err == nil {
		t.Fatal("insecure callback URL accepted")
	}
	if err := (Config{Enabled: true, BaseURL: "https://api.example.com"}).Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestLoadConfigDoesNotSilentlyDisableRequestedPush(t *testing.T) {
	t.Setenv("CALENDAR_PUSH_ENABLED", "true")
	t.Setenv("CALENDAR_WEBHOOK_BASE_URL", "")
	config := LoadConfig()
	if !config.Enabled {
		t.Fatal("requested push was silently disabled")
	}
	if err := config.Validate(); err == nil {
		t.Fatal("expected missing webhook base URL to fail validation")
	}
}

func TestLoadConfigRejectsInvalidEnabledValue(t *testing.T) {
	t.Setenv("CALENDAR_PUSH_ENABLED", "sometimes")
	t.Setenv("CALENDAR_WEBHOOK_BASE_URL", "https://api.example.com")
	if err := LoadConfig().Validate(); err == nil {
		t.Fatal("expected invalid push enabled value to fail validation")
	}
}
