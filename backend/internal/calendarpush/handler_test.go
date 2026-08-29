package calendarpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type fakeWebhookRepository struct {
	subscription *models.IntegrationWebhookSubscription
	accepted     int
	lastJob      *models.IntegrationJob
	resolveErr   error
	acceptErr    error
	stateErr     error
	state        string
}

func (f *fakeWebhookRepository) ResolveCalendarWebhookSubscription(context.Context, string, string) (*models.IntegrationWebhookSubscription, error) {
	if f.resolveErr != nil {
		return nil, f.resolveErr
	}
	return f.subscription, nil
}
func (f *fakeWebhookRepository) AcceptCalendarWebhook(_ context.Context, _ *models.IntegrationWebhookSubscription, _ string, _ []byte, job *models.IntegrationJob) (bool, error) {
	if f.acceptErr != nil {
		return false, f.acceptErr
	}
	f.accepted++
	f.lastJob = job
	return true, nil
}
func (f *fakeWebhookRepository) UpdateCalendarWebhookSubscriptionState(_ context.Context, _, _, status, _ string, _ *time.Time) error {
	f.state = status
	return f.stateErr
}

func testSubscription(secret string) *models.IntegrationWebhookSubscription {
	digest := sha256.Sum256([]byte(secret))
	return &models.IntegrationWebhookSubscription{
		ID:           "30a0ed8f-bcb7-4394-a0e6-a83e44cf4e54",
		UserID:       "10a0ed8f-bcb7-4394-a0e6-a83e44cf4e54",
		ConnectionID: "20a0ed8f-bcb7-4394-a0e6-a83e44cf4e54",
		Provider:     "google", CapabilityKey: "calendar.read",
		WatchedResourceID: "events:calendar", VerificationSecretHash: hex.EncodeToString(digest[:]),
	}
}

func TestGoogleWebhookVerifiesHeadersAndEnqueues(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repository := &fakeWebhookRepository{subscription: testSubscription("secret")}
	handler := NewHandler(repository)
	request := httptest.NewRequest(http.MethodPost, "/webhooks/calendar/google", nil)
	request.Header.Set("X-Goog-Channel-ID", "channel")
	request.Header.Set("X-Goog-Channel-Token", "secret")
	request.Header.Set("X-Goog-Message-Number", "42")
	request.Header.Set("X-Goog-Resource-State", "exists")
	response := httptest.NewRecorder()
	router := gin.New()
	router.POST("/webhooks/calendar/google", handler.Google)
	router.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent || repository.accepted != 1 || repository.lastJob == nil {
		t.Fatalf("unexpected Google webhook result status=%d accepted=%d", response.Code, repository.accepted)
	}
}

func TestGoogleWebhookRejectsWrongSecret(t *testing.T) {
	repository := &fakeWebhookRepository{subscription: testSubscription("secret")}
	handler := NewHandler(repository)
	request := httptest.NewRequest(http.MethodPost, "/webhooks/calendar/google", nil)
	request.Header.Set("X-Goog-Channel-ID", "channel")
	request.Header.Set("X-Goog-Channel-Token", "wrong")
	request.Header.Set("X-Goog-Message-Number", "42")
	request.Header.Set("X-Goog-Resource-State", "exists")
	response := httptest.NewRecorder()
	router := gin.New()
	router.POST("/webhooks/calendar/google", handler.Google)
	router.ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized || repository.accepted != 0 {
		t.Fatalf("wrong secret was accepted")
	}
}

func TestMicrosoftValidationReturnsPlainText(t *testing.T) {
	handler := NewHandler(&fakeWebhookRepository{})
	request := httptest.NewRequest(http.MethodPost, "/webhooks/calendar/microsoft?validationToken=a%2Bb", nil)
	response := httptest.NewRecorder()
	router := gin.New()
	router.POST("/webhooks/calendar/microsoft", handler.Microsoft)
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Body.String() != "a+b" || !strings.HasPrefix(response.Header().Get("Content-Type"), "text/plain") {
		t.Fatalf("invalid validation response: %d %q %q", response.Code, response.Body.String(), response.Header().Get("Content-Type"))
	}
}

func TestMicrosoftMissedNotificationForcesFullSync(t *testing.T) {
	subscription := testSubscription("secret")
	subscription.Provider = "microsoft"
	subscription.WatchedResourceID = microsoftEventsResource
	repository := &fakeWebhookRepository{subscription: subscription}
	handler := NewHandler(repository)
	handler.now = func() time.Time { return time.Date(2026, 8, 29, 12, 0, 0, 0, time.UTC) }
	body := `{"value":[{"subscriptionId":"subscription","clientState":"secret","lifecycleEvent":"missed","resource":"me/events"}]}`
	request := httptest.NewRequest(http.MethodPost, "/webhooks/calendar/microsoft", strings.NewReader(body))
	response := httptest.NewRecorder()
	router := gin.New()
	router.POST("/webhooks/calendar/microsoft", handler.Microsoft)
	router.ServeHTTP(response, request)
	if response.Code != http.StatusAccepted || repository.accepted != 1 || repository.state != "" || !strings.Contains(string(repository.lastJob.Payload), `"force_full":true`) {
		t.Fatalf("missed notification did not schedule recovery: status=%d state=%s job=%s", response.Code, repository.state, repository.lastJob.Payload)
	}
}

func TestMicrosoftReturnsRetryableStatusWhenPersistenceFails(t *testing.T) {
	subscription := testSubscription("secret")
	subscription.Provider = "microsoft"
	repository := &fakeWebhookRepository{subscription: subscription, acceptErr: errors.New("database unavailable")}
	handler := NewHandler(repository)
	body := `{"value":[{"subscriptionId":"subscription","clientState":"secret","changeType":"created","resource":"me/events/1","resourceData":{"id":"1"}}]}`
	request := httptest.NewRequest(http.MethodPost, "/webhooks/calendar/microsoft", strings.NewReader(body))
	response := httptest.NewRecorder()
	router := gin.New()
	router.POST("/webhooks/calendar/microsoft", handler.Microsoft)
	router.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected provider retry status, got %d", response.Code)
	}
}

func TestMicrosoftRemovedSubscriptionPersistsRecoveryBeforeAcknowledging(t *testing.T) {
	subscription := testSubscription("secret")
	subscription.Provider = "microsoft"
	repository := &fakeWebhookRepository{subscription: subscription}
	handler := NewHandler(repository)
	body := `{"value":[{"subscriptionId":"subscription","clientState":"secret","lifecycleEvent":"subscriptionRemoved","resource":"me/events"}]}`
	request := httptest.NewRequest(http.MethodPost, "/webhooks/calendar/microsoft", strings.NewReader(body))
	response := httptest.NewRecorder()
	router := gin.New()
	router.POST("/webhooks/calendar/microsoft", handler.Microsoft)
	router.ServeHTTP(response, request)
	if response.Code != http.StatusAccepted || repository.state != "failed" || repository.accepted != 1 || !strings.Contains(string(repository.lastJob.Payload), `"force_full":true`) {
		t.Fatalf("removed subscription recovery was incomplete: status=%d state=%s accepted=%d", response.Code, repository.state, repository.accepted)
	}
}

func TestMicrosoftLifecycleStateFailureIsRetryable(t *testing.T) {
	subscription := testSubscription("secret")
	subscription.Provider = "microsoft"
	repository := &fakeWebhookRepository{subscription: subscription, stateErr: errors.New("database unavailable")}
	handler := NewHandler(repository)
	body := `{"value":[{"subscriptionId":"subscription","clientState":"secret","lifecycleEvent":"reauthorizationRequired","resource":"me/events"}]}`
	request := httptest.NewRequest(http.MethodPost, "/webhooks/calendar/microsoft", strings.NewReader(body))
	response := httptest.NewRecorder()
	router := gin.New()
	router.POST("/webhooks/calendar/microsoft", handler.Microsoft)
	router.ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable || repository.accepted != 0 {
		t.Fatalf("expected retryable lifecycle persistence failure, got status=%d accepted=%d", response.Code, repository.accepted)
	}
}
