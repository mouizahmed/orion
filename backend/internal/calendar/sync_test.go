package calendar

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
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
