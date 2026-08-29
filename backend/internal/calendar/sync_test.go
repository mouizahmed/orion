package calendar

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"golang.org/x/oauth2"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

type syncStateRecordingCache struct {
	lockErr            error
	listSourcesErr     error
	applyErrorCalendar string
	sources            []*models.CachedCalendarSource
	calls              []string
}

type staticConnectionRepository struct {
	connections []*models.IntegrationConnection
}

func (*staticConnectionRepository) CreateOrUpdate(*models.IntegrationConnection) error { return nil }
func (*staticConnectionRepository) GetByID(string, string) (*models.IntegrationConnection, error) {
	return nil, errors.New("not implemented")
}
func (f *staticConnectionRepository) GetActiveByUser(string) ([]*models.IntegrationConnection, error) {
	return f.connections, nil
}
func (*staticConnectionRepository) GetActiveByUserAndProvider(string, string) ([]*models.IntegrationConnection, error) {
	return nil, nil
}
func (*staticConnectionRepository) DeleteCredentials(string, string) error { return nil }
func (*staticConnectionRepository) DisconnectLocal(context.Context, string, string) ([]string, error) {
	return nil, nil
}
func (*staticConnectionRepository) MarkNeedsReconnect(string, string) error { return nil }
func (*staticConnectionRepository) UpdateTokens(string, string, *models.UpdateIntegrationConnectionTokensRequest) error {
	return nil
}

func (f *syncStateRecordingCache) ListCalendarSources(context.Context, string) ([]*models.CachedCalendarSource, error) {
	f.calls = append(f.calls, "list-sources")
	return f.sources, f.listSourcesErr
}
func (*syncStateRecordingCache) ListUpcomingEvents(context.Context, string, time.Time, int) ([]*models.CachedCalendarEvent, error) {
	return nil, nil
}
func (*syncStateRecordingCache) GetEventByProviderID(context.Context, string, string, string, string) (*models.CachedCalendarEvent, error) {
	return nil, nil
}
func (*syncStateRecordingCache) SearchEvents(context.Context, string, string, int, *string) ([]*models.CachedCalendarEvent, error) {
	return nil, nil
}
func (*syncStateRecordingCache) ListConnectionSyncStates(context.Context, string) ([]*models.CalendarSyncState, error) {
	return nil, nil
}
func (*syncStateRecordingCache) ClearCalendarSyncToken(context.Context, string, string, string) error {
	return nil
}
func (f *syncStateRecordingCache) MarkSyncStarted(_ context.Context, _, _, scope string) error {
	f.calls = append(f.calls, "started:"+scope)
	return nil
}
func (f *syncStateRecordingCache) MarkSyncSuccess(_ context.Context, _, _, scope string, _, _ *time.Time) error {
	f.calls = append(f.calls, "success:"+scope)
	return nil
}
func (f *syncStateRecordingCache) MarkFullSyncSuccess(context.Context, string, string) error {
	f.calls = append(f.calls, "success:full")
	return nil
}
func (f *syncStateRecordingCache) MarkSyncPartial(_ context.Context, _, _, scope string, _ error) error {
	f.calls = append(f.calls, "partial:"+scope)
	return nil
}
func (f *syncStateRecordingCache) MarkSyncError(_ context.Context, _, _, scope string, _ error) error {
	f.calls = append(f.calls, "error:"+scope)
	return nil
}
func (f *syncStateRecordingCache) ReconcileCalendarSources(context.Context, string, *models.IntegrationConnection, []*models.CachedCalendarSource) ([]string, error) {
	f.calls = append(f.calls, "reconcile")
	return nil, nil
}
func (f *syncStateRecordingCache) ApplyCalendarEventSync(_ context.Context, _ string, _ *models.IntegrationConnection, calendarID string, _ models.CalendarEventSyncBatch) ([]string, error) {
	if calendarID == f.applyErrorCalendar {
		return nil, errors.New("event apply failed")
	}
	return nil, nil
}
func (f *syncStateRecordingCache) DeleteEventsBefore(context.Context, string, string, time.Time) ([]string, error) {
	f.calls = append(f.calls, "retention")
	return nil, nil
}
func (f *syncStateRecordingCache) DeleteEventsOutsideWindow(context.Context, string, string, time.Time, time.Time) ([]string, error) {
	f.calls = append(f.calls, "retention")
	return nil, nil
}
func (f *syncStateRecordingCache) AcquireSyncLock(context.Context, string, string) (func(), error) {
	f.calls = append(f.calls, "lock")
	if f.lockErr != nil {
		return nil, f.lockErr
	}
	return func() {}, nil
}

func newCalendarListTestService(cache repository.CalendarCacheRepository) *Service {
	return &Service{
		cache: cache,
		client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return jsonResponse(`{"items":[{"id":"calendar","summary":"Calendar"}]}`), nil
		})},
	}
}

func TestForceRefreshOAuthTokenDoesNotReuseExistingAccessToken(t *testing.T) {
	t.Parallel()
	var refreshRequests int
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		refreshRequests++
		if err := request.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if request.Form.Get("grant_type") != "refresh_token" || request.Form.Get("refresh_token") != "refresh" {
			t.Fatalf("unexpected refresh form: %v", request.Form)
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"access_token": "new-access", "expires_in": 3600, "token_type": "Bearer"})
	}))
	defer server.Close()

	token, err := forceRefreshOAuthToken(context.Background(), &oauth2.Config{
		ClientID: "client", ClientSecret: "secret", Endpoint: oauth2.Endpoint{TokenURL: server.URL},
	}, "refresh")
	if err != nil {
		t.Fatal(err)
	}
	if refreshRequests != 1 || token.AccessToken != "new-access" {
		t.Fatalf("requests=%d token=%+v", refreshRequests, token)
	}
}

func TestProviderAPIErrorsDoNotExposeResponsePayload(t *testing.T) {
	t.Parallel()
	err := providerAPIError("Google Calendar", http.StatusUnauthorized, []byte(`{"error":{"code":401,"message":"private@example.com secret"}}`))
	if strings.Contains(err.Error(), "private@example.com") || strings.Contains(err.Error(), "secret") {
		t.Fatalf("provider payload leaked: %v", err)
	}
	if !strings.Contains(err.Error(), "401") {
		t.Fatalf("status/code missing: %v", err)
	}
}

func jsonResponse(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestFetchGoogleCalendarsPaginates(t *testing.T) {
	t.Parallel()
	var calls int
	service := &Service{client: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			if got := request.URL.Query().Get("pageToken"); got != "" {
				t.Fatalf("first page token = %q, want empty", got)
			}
			return jsonResponse(`{"items":[{"id":"one","summary":"One"}],"nextPageToken":"next"}`), nil
		}
		if got := request.URL.Query().Get("pageToken"); got != "next" {
			t.Fatalf("second page token = %q, want next", got)
		}
		return jsonResponse(`{"items":[{"id":"two","summary":"Two"}]}`), nil
	})}}

	calendars, err := service.fetchGoogleCalendars(context.Background(), &models.IntegrationConnection{
		ID: "connection", Provider: models.IntegrationProviderGoogle, AccessToken: "token",
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || len(calendars) != 2 || calendars[0].ID != "one" || calendars[1].ID != "two" {
		t.Fatalf("calls=%d calendars=%+v", calls, calendars)
	}
}

func TestFetchMicrosoftCalendarsFollowsNextLink(t *testing.T) {
	t.Parallel()
	var calls int
	service := &Service{client: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			return jsonResponse(`{"value":[{"id":"one","name":"One"}],"@odata.nextLink":"https://graph.microsoft.com/page-two"}`), nil
		}
		if request.URL.String() != "https://graph.microsoft.com/page-two" {
			t.Fatalf("second page URL = %q", request.URL.String())
		}
		return jsonResponse(`{"value":[{"id":"two","name":"Two"}]}`), nil
	})}}

	calendars, err := service.fetchMicrosoftCalendars(context.Background(), &models.IntegrationConnection{
		ID: "connection", Provider: models.IntegrationProviderMicrosoft, AccessToken: "token",
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || len(calendars) != 2 || calendars[0].ID != "one" || calendars[1].ID != "two" {
		t.Fatalf("calls=%d calendars=%+v", calls, calendars)
	}
}

func TestGoogleIncrementalSyncReturnsUpdatesAndDeletionTombstones(t *testing.T) {
	t.Parallel()
	service := &Service{client: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Query().Get("syncToken") != "cursor" || request.URL.Query().Get("singleEvents") != "true" {
			t.Fatalf("incremental request lost cursor/recurrence expansion: %s", request.URL.RawQuery)
		}
		return jsonResponse(`{"items":[{"id":"updated","status":"confirmed","summary":"Updated meeting","description":"new description","start":{"dateTime":"2026-08-29T10:00:00Z"},"end":{"dateTime":"2026-08-29T11:00:00Z"}},{"id":"deleted","status":"cancelled"}],"nextSyncToken":"next"}`), nil
	})}}
	result, err := service.fetchGoogleEvents(context.Background(), &models.IntegrationConnection{ID: "connection", Provider: models.IntegrationProviderGoogle, AccessToken: "token"}, &models.CachedCalendarSource{ID: "calendar"}, time.Now(), time.Now().Add(time.Hour), "cursor")
	if err != nil {
		t.Fatal(err)
	}
	if result.WasFullSync || result.NextToken != "next" || len(result.Events) != 1 || result.Events[0].Description != "new description" || len(result.Deleted) != 1 || result.Deleted[0] != "deleted" {
		t.Fatalf("unexpected incremental result: %+v", result)
	}
}

func TestGoogleExpiredCursorFallsBackToFullWindowSync(t *testing.T) {
	t.Parallel()
	var calls int
	service := &Service{client: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			return &http.Response{StatusCode: http.StatusGone, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":{"code":410}}`))}, nil
		}
		if request.URL.Query().Get("syncToken") != "" || request.URL.Query().Get("timeMin") == "" || request.URL.Query().Get("timeMax") == "" {
			t.Fatalf("fallback was not a bounded full sync: %s", request.URL.RawQuery)
		}
		return jsonResponse(`{"items":[],"nextSyncToken":"replacement"}`), nil
	})}}
	result, err := service.fetchGoogleEvents(context.Background(), &models.IntegrationConnection{ID: "connection", Provider: models.IntegrationProviderGoogle, AccessToken: "token"}, &models.CachedCalendarSource{ID: "calendar"}, time.Now(), time.Now().Add(time.Hour), "expired")
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || !result.WasFullSync || result.NextToken != "replacement" {
		t.Fatalf("cursor recovery failed: calls=%d result=%+v", calls, result)
	}
}

func TestMicrosoftIncrementalSyncMapsFullDescriptionAndDeletion(t *testing.T) {
	t.Parallel()
	service := &Service{client: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.String() != "https://graph.microsoft.com/delta" {
			t.Fatalf("unexpected delta URL: %s", request.URL)
		}
		return jsonResponse(`{"value":[{"id":"updated","subject":"Planning meeting","bodyPreview":"preview","body":{"contentType":"text","content":"complete description"},"start":{"dateTime":"2026-08-29T10:00:00"},"end":{"dateTime":"2026-08-29T11:00:00"}},{"id":"deleted","@removed":{"reason":"deleted"}}],"@odata.deltaLink":"https://graph.microsoft.com/next"}`), nil
	})}}
	result, err := service.fetchMicrosoftEvents(context.Background(), &models.IntegrationConnection{ID: "connection", Provider: models.IntegrationProviderMicrosoft, AccessToken: "token"}, &models.CachedCalendarSource{ID: "calendar"}, time.Now(), time.Now().Add(time.Hour), "https://graph.microsoft.com/delta")
	if err != nil {
		t.Fatal(err)
	}
	if result.WasFullSync || result.NextToken != "https://graph.microsoft.com/next" || len(result.Events) != 1 || result.Events[0].Description != "complete description" || len(result.Deleted) != 1 {
		t.Fatalf("unexpected Microsoft delta result: %+v", result)
	}
}

func TestGoogleAllDayEventPreservesExclusiveEndDate(t *testing.T) {
	item := googleEventItem{ID: "all-day", Summary: "Planning meeting"}
	item.Start.Date = "2026-08-29"
	item.End.Date = "2026-08-30"
	events, _ := (&Service{}).buildGoogleEvents([]googleEventItem{item}, &models.IntegrationConnection{ID: "connection"}, &models.CachedCalendarSource{ID: "calendar"})
	if len(events) != 1 || !events[0].AllDay || events[0].End.Sub(events[0].Start) != 24*time.Hour {
		t.Fatalf("all-day mapping failed: %+v", events)
	}
}

func TestBuildGoogleEventsPreservesAttendeeSemantics(t *testing.T) {
	t.Parallel()
	item := googleEventItem{ID: "event", Status: "confirmed", Summary: "Team meeting"}
	item.Start.DateTime = "2026-08-22T10:00:00Z"
	item.End.DateTime = "2026-08-22T11:00:00Z"
	item.Organizer.DisplayName = "Organizer"
	item.Organizer.Email = "ORGANIZER@EXAMPLE.COM"
	item.Attendees = append(item.Attendees,
		struct {
			Email          string `json:"email"`
			DisplayName    string `json:"displayName"`
			ResponseStatus string `json:"responseStatus"`
			Optional       bool   `json:"optional"`
			Organizer      bool   `json:"organizer"`
			Self           bool   `json:"self"`
			Resource       bool   `json:"resource"`
			ID             string `json:"id"`
		}{Email: "PERSON@EXAMPLE.COM", DisplayName: "Person", ResponseStatus: "accepted"},
		struct {
			Email          string `json:"email"`
			DisplayName    string `json:"displayName"`
			ResponseStatus string `json:"responseStatus"`
			Optional       bool   `json:"optional"`
			Organizer      bool   `json:"organizer"`
			Self           bool   `json:"self"`
			Resource       bool   `json:"resource"`
			ID             string `json:"id"`
		}{Email: "room@example.com", Resource: true, ResponseStatus: "accepted"},
		struct {
			Email          string `json:"email"`
			DisplayName    string `json:"displayName"`
			ResponseStatus string `json:"responseStatus"`
			Optional       bool   `json:"optional"`
			Organizer      bool   `json:"organizer"`
			Self           bool   `json:"self"`
			Resource       bool   `json:"resource"`
			ID             string `json:"id"`
		}{Email: "declined@example.com", ResponseStatus: "declined"},
	)

	service := &Service{}
	events, removed := service.buildGoogleEvents([]googleEventItem{item}, &models.IntegrationConnection{
		ID: "connection", Provider: models.IntegrationProviderGoogle,
	}, &models.CachedCalendarSource{ID: "calendar", Name: "Calendar"})
	if len(removed) != 0 || len(events) != 1 {
		t.Fatalf("events=%d removed=%v", len(events), removed)
	}
	event := events[0]
	if event.OrganizerName != "Organizer" || event.OrganizerEmail != "organizer@example.com" {
		t.Fatalf("organizer = %q <%s>", event.OrganizerName, event.OrganizerEmail)
	}
	if len(event.Attendees) != 3 || !event.Attendees[0].EligibleForNote() {
		t.Fatalf("attendees=%+v", event.Attendees)
	}
	if event.Attendees[1].EligibleForNote() || event.Attendees[2].EligibleForNote() {
		t.Fatalf("resource and declined attendees must not be note attendees: %+v", event.Attendees)
	}
}

func TestAnchoredSyncWindow(t *testing.T) {
	t.Parallel()
	start, end := AnchoredSyncWindow(time.Date(2026, 8, 22, 23, 59, 0, 0, time.FixedZone("local", -4*60*60)))
	if start.Hour() != 0 || end.Hour() != 0 || end.Sub(start) != 120*24*time.Hour {
		t.Fatalf("unexpected window %s - %s", start, end)
	}
}

func TestPartialSyncErrorCanBeClassified(t *testing.T) {
	t.Parallel()
	err := error(&PartialSyncError{Err: errors.New("one calendar failed")})
	var partial *PartialSyncError
	if !errors.As(err, &partial) || partial.Error() != "one calendar failed" {
		t.Fatalf("partial sync error was not classifiable: %v", err)
	}
}

func TestOnlySyncInProgressClassificationDoesNotHideOtherFailures(t *testing.T) {
	t.Parallel()
	contention := fmt.Errorf("connection one: %w", repository.ErrCalendarSyncInProgress)
	if !IsOnlySyncInProgress(&PartialSyncError{Err: errors.Join(contention, contention)}) {
		t.Fatal("wrapped contention should be classified as coalesced work")
	}
	if IsOnlySyncInProgress(errors.Join(contention, errors.New("provider failed"))) {
		t.Fatal("mixed contention and provider errors must not be classified as coalesced work")
	}
}

func TestAllSyncCompletesCalendarAndEventStatesIndependently(t *testing.T) {
	t.Parallel()
	cache := &syncStateRecordingCache{}
	service := newCalendarListTestService(cache)

	_, err := service.syncConnection(context.Background(), "user", &models.IntegrationConnection{
		ID: "connection", Provider: models.IntegrationProviderGoogle, AccessToken: "token",
	}, SyncScopeAll)
	if err != nil {
		t.Fatal(err)
	}

	want := []string{"lock", "started:all", "reconcile", "success:calendars", "list-sources", "retention", "success:events"}
	if strings.Join(cache.calls, ",") != strings.Join(want, ",") {
		t.Fatalf("sync state calls = %v, want %v", cache.calls, want)
	}
}

func TestAllSyncKeepsCalendarSuccessfulWhenEventSyncFails(t *testing.T) {
	t.Parallel()
	cache := &syncStateRecordingCache{listSourcesErr: errors.New("event source read failed")}
	service := newCalendarListTestService(cache)

	_, err := service.syncConnection(context.Background(), "user", &models.IntegrationConnection{
		ID: "connection", Provider: models.IntegrationProviderGoogle, AccessToken: "token",
	}, SyncScopeAll)
	if err == nil {
		t.Fatal("expected event sync failure")
	}

	want := []string{"lock", "started:all", "reconcile", "success:calendars", "list-sources", "retention", "error:events"}
	if strings.Join(cache.calls, ",") != strings.Join(want, ",") {
		t.Fatalf("sync state calls = %v, want %v", cache.calls, want)
	}
}

func TestAllSyncKeepsCalendarSuccessfulWhenEventSyncIsPartial(t *testing.T) {
	t.Parallel()
	cache := &syncStateRecordingCache{
		applyErrorCalendar: "bad",
		sources: []*models.CachedCalendarSource{
			{ID: "good", ConnectionID: "connection", Visible: true},
			{ID: "bad", ConnectionID: "connection", Visible: true},
		},
	}
	service := newCalendarListTestService(cache)

	_, err := service.syncConnection(context.Background(), "user", &models.IntegrationConnection{
		ID: "connection", Provider: models.IntegrationProviderGoogle, AccessToken: "token",
	}, SyncScopeAll)
	var partial *PartialSyncError
	if !errors.As(err, &partial) {
		t.Fatalf("event sync error = %v, want PartialSyncError", err)
	}

	want := []string{"lock", "started:all", "reconcile", "success:calendars", "list-sources", "retention", "partial:events"}
	if strings.Join(cache.calls, ",") != strings.Join(want, ",") {
		t.Fatalf("sync state calls = %v, want %v", cache.calls, want)
	}
}

func TestSyncLockContentionIsReturnedForRetry(t *testing.T) {
	t.Parallel()
	cache := &syncStateRecordingCache{lockErr: repository.ErrCalendarSyncInProgress}
	service := newCalendarListTestService(cache)

	_, err := service.syncConnection(context.Background(), "user", &models.IntegrationConnection{ID: "connection"}, SyncScopeAll)
	if !errors.Is(err, repository.ErrCalendarSyncInProgress) {
		t.Fatalf("lock contention = %v, want ErrCalendarSyncInProgress", err)
	}
	if strings.Join(cache.calls, ",") != "lock" {
		t.Fatalf("lock contention should not start sync state: %v", cache.calls)
	}
}

func TestSyncUserPreservesLockContentionForWorkerRetry(t *testing.T) {
	t.Parallel()
	cache := &syncStateRecordingCache{lockErr: repository.ErrCalendarSyncInProgress}
	service := NewService(&staticConnectionRepository{connections: []*models.IntegrationConnection{{
		ID: "connection", Provider: models.IntegrationProviderGoogle,
	}}}, nil, cache)

	_, err := service.SyncUser(context.Background(), "user", SyncScopeAll)
	if !errors.Is(err, repository.ErrCalendarSyncInProgress) {
		t.Fatalf("user sync contention = %v, want ErrCalendarSyncInProgress", err)
	}
}
