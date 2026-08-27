package calendar

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"golang.org/x/oauth2"
	"golang.org/x/sync/errgroup"
	"golang.org/x/sync/semaphore"
)

const (
	CalendarListTTL = 10 * time.Minute
	EventTTL        = 2 * time.Minute
)

type SyncScope string

const (
	SyncScopeAll       SyncScope = "all"
	SyncScopeCalendars SyncScope = "calendars"
	SyncScopeEvents    SyncScope = "events"
)

// PartialSyncError reports that at least one provider unit committed while
// another failed. Callers can safely retain the committed cache and surface a
// degraded state instead of claiming either complete success or total failure.
type PartialSyncError struct {
	Err error
}

func (e *PartialSyncError) Error() string { return e.Err.Error() }
func (e *PartialSyncError) Unwrap() error { return e.Err }

type calendarFetchResult struct {
	Events      []*models.CachedCalendarEvent
	Deleted     []string
	NextToken   string
	WasFullSync bool
}

type googleEventItem struct {
	ID       string `json:"id"`
	Status   string `json:"status"`
	Summary  string `json:"summary"`
	HTMLLink string `json:"htmlLink"`
	Start    struct {
		DateTime string `json:"dateTime"`
		Date     string `json:"date"`
	} `json:"start"`
	End struct {
		DateTime string `json:"dateTime"`
		Date     string `json:"date"`
	} `json:"end"`
	Location       string `json:"location"`
	Description    string `json:"description"`
	HangoutLink    string `json:"hangoutLink"`
	ConferenceData struct {
		EntryPoints []struct {
			EntryPointType string `json:"entryPointType"`
			URI            string `json:"uri"`
		} `json:"entryPoints"`
	} `json:"conferenceData"`
	Organizer struct {
		DisplayName string `json:"displayName"`
		Email       string `json:"email"`
	} `json:"organizer"`
	Attendees []struct {
		Email          string `json:"email"`
		DisplayName    string `json:"displayName"`
		ResponseStatus string `json:"responseStatus"`
		Optional       bool   `json:"optional"`
		Organizer      bool   `json:"organizer"`
		Self           bool   `json:"self"`
		Resource       bool   `json:"resource"`
		ID             string `json:"id"`
	} `json:"attendees"`
}

type microsoftEventItem struct {
	ID      string `json:"id"`
	Removed *struct {
		Reason string `json:"reason"`
	} `json:"@removed,omitempty"`
	Subject  string `json:"subject"`
	WebLink  string `json:"webLink"`
	IsAllDay bool   `json:"isAllDay"`
	Start    struct {
		DateTime string `json:"dateTime"`
	} `json:"start"`
	End struct {
		DateTime string `json:"dateTime"`
	} `json:"end"`
	Location struct {
		DisplayName string `json:"displayName"`
	} `json:"location"`
	BodyPreview      string `json:"bodyPreview"`
	OnlineMeetingURL string `json:"onlineMeetingUrl"`
	OnlineMeeting    struct {
		JoinURL string `json:"joinUrl"`
	} `json:"onlineMeeting"`
	Organizer struct {
		EmailAddress struct {
			Name    string `json:"name"`
			Address string `json:"address"`
		} `json:"emailAddress"`
	} `json:"organizer"`
	Attendees []struct {
		EmailAddress struct {
			Name    string `json:"name"`
			Address string `json:"address"`
		} `json:"emailAddress"`
		Status struct {
			Response string `json:"response"`
		} `json:"status"`
		Type string `json:"type"`
	} `json:"attendees"`
}

func anchoredSyncWindow(now time.Time) (time.Time, time.Time) {
	return AnchoredSyncWindow(now)
}

func AnchoredSyncWindow(now time.Time) (time.Time, time.Time) {
	day := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC)
	return day.Add(-30 * 24 * time.Hour), day.Add(90 * 24 * time.Hour)
}

type Service struct {
	connections repository.IntegrationConnectionRepository
	preferences repository.CalendarPreferenceRepository
	cache       repository.CalendarCacheRepository
	client      *http.Client
	metrics     *SyncMetrics
}

func NewService(connections repository.IntegrationConnectionRepository, preferences repository.CalendarPreferenceRepository, cache repository.CalendarCacheRepository) *Service {
	return &Service{
		connections: connections,
		preferences: preferences,
		cache:       cache,
		client: &http.Client{
			Timeout: 8 * time.Second,
		},
		metrics: &SyncMetrics{},
	}
}

func (s *Service) MetricsSnapshot() SyncMetricsSnapshot { return s.metrics.Snapshot() }

func (s *Service) SyncUser(ctx context.Context, userID string, scope SyncScope) ([]string, error) {
	started := time.Now()
	if s.metrics != nil {
		s.metrics.Attempts.Add(1)
		defer s.metrics.addDuration(started)
	}
	connections, err := s.calendarConnections(userID)
	if err != nil {
		if s.metrics != nil {
			s.metrics.Failures.Add(1)
		}
		return nil, err
	}
	if len(connections) == 0 {
		return nil, nil
	}

	sem := semaphore.NewWeighted(4)
	var group errgroup.Group
	var mutex sync.Mutex
	var syncErrors []error
	var successfulConnections int
	changedNotes := map[string]struct{}{}
	for _, connection := range connections {
		connection := connection
		group.Go(func() error {
			if err := sem.Acquire(ctx, 1); err != nil {
				mutex.Lock()
				syncErrors = append(syncErrors, err)
				mutex.Unlock()
				return nil
			}
			defer sem.Release(1)

			noteIDs, err := s.syncConnection(ctx, userID, connection, scope)
			mutex.Lock()
			for _, noteID := range noteIDs {
				changedNotes[noteID] = struct{}{}
			}
			if err != nil {
				syncErrors = append(syncErrors, fmt.Errorf("connection %s: %w", connection.ID, err))
			} else {
				successfulConnections++
			}
			mutex.Unlock()
			return nil
		})
	}
	_ = group.Wait()
	noteIDs := make([]string, 0, len(changedNotes))
	for noteID := range changedNotes {
		noteIDs = append(noteIDs, noteID)
	}
	joined := errors.Join(syncErrors...)
	if joined != nil && successfulConnections > 0 {
		if s.metrics != nil {
			s.metrics.PartialFailures.Add(1)
		}
		return noteIDs, &PartialSyncError{Err: joined}
	}
	if s.metrics != nil {
		if joined != nil {
			s.metrics.Failures.Add(1)
		} else {
			s.metrics.Successes.Add(1)
		}
	}
	return noteIDs, joined
}

func (s *Service) syncConnection(ctx context.Context, userID string, connection *models.IntegrationConnection, scope SyncScope) ([]string, error) {
	release, err := s.cache.AcquireSyncLock(ctx, userID, connection.ID)
	if err != nil {
		if errors.Is(err, repository.ErrCalendarSyncInProgress) {
			return nil, nil
		}
		return nil, err
	}
	defer release()

	if err := s.cache.MarkSyncStarted(ctx, userID, connection.ID, string(scope)); err != nil {
		return nil, err
	}

	if connection.ExpiresAt != nil && time.Now().Add(2*time.Minute).After(*connection.ExpiresAt) {
		if err := s.refreshConnectionTokenIfNeeded(ctx, userID, connection); err != nil {
			s.recordSyncError(ctx, userID, connection.ID, scope, err)
			return nil, err
		}
		refreshed, err := s.connections.GetByID(userID, connection.ID)
		if err != nil {
			s.recordSyncError(ctx, userID, connection.ID, scope, err)
			return nil, err
		}
		connection = refreshed
	}

	var fetchedCalendars []*models.CachedCalendarSource
	var changedNoteIDs []string
	if scope == SyncScopeAll || scope == SyncScopeCalendars {
		calendars, err := s.fetchCalendarsWithAuthRetry(ctx, userID, connection)
		if err != nil {
			s.markNeedsReconnectOnAuthError(userID, connection.ID, err)
			s.recordSyncError(ctx, userID, connection.ID, scope, err)
			return nil, err
		}
		noteIDs, err := s.cache.ReconcileCalendarSources(ctx, userID, connection, calendars)
		if err != nil {
			s.recordSyncError(ctx, userID, connection.ID, scope, err)
			return nil, err
		}
		changedNoteIDs = append(changedNoteIDs, noteIDs...)
		if s.metrics != nil {
			s.metrics.AffectedNotes.Add(uint64(len(noteIDs)))
		}
		fetchedCalendars = calendars
	}

	if scope == SyncScopeAll || scope == SyncScopeEvents {
		windowStart, windowEnd := anchoredSyncWindow(time.Now())
		outcome := s.syncEvents(ctx, userID, connection, fetchedCalendars, windowStart, windowEnd)
		if outcome.err != nil && isAuthorizationError(outcome.err) && connection.RefreshToken != nil {
			if refreshErr := s.refreshConnectionTokenIfNeeded(ctx, userID, connection); refreshErr == nil {
				if refreshed, getErr := s.connections.GetByID(userID, connection.ID); getErr == nil {
					connection = refreshed
					outcome = s.syncEvents(ctx, userID, connection, nil, windowStart, windowEnd)
				}
			}
		}
		changedNoteIDs = append(changedNoteIDs, outcome.noteIDs...)
		if s.metrics != nil {
			s.metrics.RetentionRuns.Add(1)
		}
		retainedNoteIDs, retentionErr := s.cache.DeleteEventsBefore(ctx, userID, connection.ID, windowStart)
		changedNoteIDs = append(changedNoteIDs, retainedNoteIDs...)
		if retentionErr != nil {
			if s.metrics != nil {
				s.metrics.RetentionFailures.Add(1)
			}
			outcome.err = errors.Join(outcome.err, retentionErr)
		}
		if s.metrics != nil {
			s.metrics.AffectedNotes.Add(uint64(len(outcome.noteIDs) + len(retainedNoteIDs)))
		}
		if outcome.err != nil {
			if outcome.succeeded > 0 {
				if stateErr := s.cache.MarkSyncPartial(ctx, userID, connection.ID, string(SyncScopeEvents), outcome.err); stateErr != nil {
					log.Printf("calendar sync: failed to persist partial state for connection %s: %v", connection.ID, stateErr)
				}
				return changedNoteIDs, &PartialSyncError{Err: outcome.err}
			} else {
				s.recordSyncError(ctx, userID, connection.ID, SyncScopeEvents, outcome.err)
			}
			return changedNoteIDs, outcome.err
		}
		if err := s.cache.MarkSyncSuccess(ctx, userID, connection.ID, string(scope), &windowStart, &windowEnd); err != nil {
			s.recordSyncError(ctx, userID, connection.ID, scope, errors.New("failed to persist sync completion"))
			return changedNoteIDs, err
		}
		return changedNoteIDs, nil
	}

	if err := s.cache.MarkSyncSuccess(ctx, userID, connection.ID, string(scope), nil, nil); err != nil {
		s.recordSyncError(ctx, userID, connection.ID, scope, errors.New("failed to persist sync completion"))
		return changedNoteIDs, err
	}
	return changedNoteIDs, nil
}

func (s *Service) recordSyncError(ctx context.Context, userID, connectionID string, scope SyncScope, syncErr error) {
	if stateErr := s.cache.MarkSyncError(ctx, userID, connectionID, string(scope), syncErr); stateErr != nil {
		log.Printf("calendar sync: failed to persist error state for connection %s: %v", connectionID, stateErr)
	}
}

func (s *Service) fetchCalendarsWithAuthRetry(ctx context.Context, userID string, connection *models.IntegrationConnection) ([]*models.CachedCalendarSource, error) {
	calendars, err := s.fetchCalendars(ctx, connection)
	if err == nil || !isAuthorizationError(err) || connection.RefreshToken == nil {
		return calendars, err
	}
	if refreshErr := s.refreshConnectionTokenIfNeeded(ctx, userID, connection); refreshErr != nil {
		return nil, errors.Join(err, fmt.Errorf("authorization refresh: %w", refreshErr))
	}
	refreshed, refreshErr := s.connections.GetByID(userID, connection.ID)
	if refreshErr != nil {
		return nil, refreshErr
	}
	*connection = *refreshed
	return s.fetchCalendars(ctx, connection)
}

func isAuthorizationError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "invalid_grant") || strings.Contains(message, "unauthorized") || strings.Contains(message, "401")
}

type eventSyncOutcome struct {
	noteIDs   []string
	attempted int
	succeeded int
	err       error
}

func (s *Service) syncEvents(ctx context.Context, userID string, connection *models.IntegrationConnection, calendars []*models.CachedCalendarSource, windowStart, windowEnd time.Time) eventSyncOutcome {
	outcome := eventSyncOutcome{}
	if calendars == nil {
		fetched, err := s.fetchCalendars(ctx, connection)
		if err != nil {
			s.markNeedsReconnectOnAuthError(userID, connection.ID, err)
			outcome.err = err
			return outcome
		}
		noteIDs, err := s.cache.ReconcileCalendarSources(ctx, userID, connection, fetched)
		if err != nil {
			outcome.err = err
			return outcome
		}
		outcome.noteIDs = append(outcome.noteIDs, noteIDs...)
	}

	dbSources, err := s.cache.ListCalendarSources(ctx, userID)
	if err != nil {
		outcome.err = err
		return outcome
	}
	var visible []*models.CachedCalendarSource
	for _, src := range dbSources {
		if src.ConnectionID == connection.ID && src.Visible {
			visible = append(visible, src)
		}
	}

	concurrency := int64(3)
	if connection.Provider == models.IntegrationProviderMicrosoft {
		concurrency = 1
	}
	sem := semaphore.NewWeighted(concurrency)
	var group errgroup.Group
	var mutex sync.Mutex
	var syncErrors []error
	outcome.attempted = len(visible)
	for _, source := range visible {
		source := source
		group.Go(func() error {
			if err := sem.Acquire(ctx, 1); err != nil {
				mutex.Lock()
				syncErrors = append(syncErrors, err)
				mutex.Unlock()
				return nil
			}
			defer sem.Release(1)

			effectiveToken := ""
			if source.SyncToken != "" && source.SyncWindowStart != nil && source.SyncWindowEnd != nil {
				if source.SyncWindowStart.Equal(windowStart) && source.SyncWindowEnd.Equal(windowEnd) {
					effectiveToken = source.SyncToken
				}
			}

			result, err := s.fetchEvents(ctx, connection, source, windowStart, windowEnd, effectiveToken)
			if err != nil {
				s.markNeedsReconnectOnAuthError(userID, connection.ID, err)
				if s.metrics != nil {
					s.metrics.CalendarFailures.Add(1)
				}
				mutex.Lock()
				syncErrors = append(syncErrors, fmt.Errorf("calendar %s: %w", source.ID, err))
				mutex.Unlock()
				return nil
			}
			noteIDs, err := s.cache.ApplyCalendarEventSync(ctx, userID, connection, source.ID, models.CalendarEventSyncBatch{
				Events: result.Events, Deleted: result.Deleted, NextToken: result.NextToken,
				WasFullSync: result.WasFullSync, WindowStart: windowStart, WindowEnd: windowEnd,
			})
			mutex.Lock()
			if err != nil {
				if s.metrics != nil {
					s.metrics.CalendarFailures.Add(1)
				}
				syncErrors = append(syncErrors, fmt.Errorf("calendar %s apply: %w", source.ID, err))
			} else {
				outcome.succeeded++
				if s.metrics != nil {
					s.metrics.EventsApplied.Add(uint64(len(result.Events)))
				}
				outcome.noteIDs = append(outcome.noteIDs, noteIDs...)
			}
			mutex.Unlock()
			return nil
		})
	}
	_ = group.Wait()
	outcome.err = errors.Join(syncErrors...)
	return outcome
}

func (s *Service) markNeedsReconnectOnAuthError(userID, connectionID string, err error) {
	if err == nil {
		return
	}
	if !isAuthorizationError(err) {
		return
	}
	if markErr := s.connections.MarkNeedsReconnect(userID, connectionID); markErr != nil {
		log.Printf("calendar sync: failed to mark connection %s needs reconnect: %v", connectionID, markErr)
	}
}

func (s *Service) calendarConnections(userID string) ([]*models.IntegrationConnection, error) {
	connections, err := s.connections.GetActiveByUser(userID)
	if err != nil {
		return nil, err
	}
	var calendarConnections []*models.IntegrationConnection
	for _, connection := range connections {
		if connection.Provider == models.IntegrationProviderGoogle || connection.Provider == models.IntegrationProviderMicrosoft {
			calendarConnections = append(calendarConnections, connection)
		}
	}
	return calendarConnections, nil
}

func (s *Service) preferenceVisibility(userID, connectionID string) (map[string]bool, error) {
	return s.preferences.GetVisibleCalendarIDs(userID, connectionID)
}

func (s *Service) fetchCalendars(ctx context.Context, connection *models.IntegrationConnection) ([]*models.CachedCalendarSource, error) {
	switch connection.Provider {
	case models.IntegrationProviderGoogle:
		return s.fetchGoogleCalendars(ctx, connection)
	case models.IntegrationProviderMicrosoft:
		return s.fetchMicrosoftCalendars(ctx, connection)
	default:
		return nil, fmt.Errorf("unsupported calendar provider: %s", connection.Provider)
	}
}

func (s *Service) fetchEvents(ctx context.Context, connection *models.IntegrationConnection, calendar *models.CachedCalendarSource, start, end time.Time, currentToken string) (*calendarFetchResult, error) {
	switch connection.Provider {
	case models.IntegrationProviderGoogle:
		return s.fetchGoogleEvents(ctx, connection, calendar, start, end, currentToken)
	case models.IntegrationProviderMicrosoft:
		return s.fetchMicrosoftEvents(ctx, connection, calendar, start, end, currentToken)
	default:
		return nil, fmt.Errorf("unsupported calendar provider: %s", connection.Provider)
	}
}

func (s *Service) fetchGoogleCalendars(ctx context.Context, connection *models.IntegrationConnection) ([]*models.CachedCalendarSource, error) {
	type calendarListItem struct {
		ID              string `json:"id"`
		Summary         string `json:"summary"`
		BackgroundColor string `json:"backgroundColor"`
		ForegroundColor string `json:"foregroundColor"`
		Primary         bool   `json:"primary"`
		Selected        bool   `json:"selected"`
		AccessRole      string `json:"accessRole"`
	}
	var calendars []*models.CachedCalendarSource
	pageToken := ""
	for {
		values := url.Values{"maxResults": []string{"250"}}
		if pageToken != "" {
			values.Set("pageToken", pageToken)
		}
		body, status, err := s.doGoogleGet(ctx, connection, "https://www.googleapis.com/calendar/v3/users/me/calendarList?"+values.Encode())
		if err != nil {
			return nil, err
		}
		if status != http.StatusOK {
			return nil, providerAPIError("Google CalendarList", status, body)
		}
		var page struct {
			Items         []calendarListItem `json:"items"`
			NextPageToken string             `json:"nextPageToken"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return nil, err
		}
		for _, item := range page.Items {
			calendars = append(calendars, &models.CachedCalendarSource{
				ID: item.ID, ConnectionID: connection.ID, AccountEmail: stringValue(connection.ProviderEmail),
				Name: item.Summary, Provider: string(models.IntegrationProviderGoogle), Color: item.BackgroundColor,
				BackgroundColor: item.BackgroundColor, ForegroundColor: item.ForegroundColor,
				Primary: item.Primary, Selected: item.Selected, Visible: item.Primary || item.Selected, AccessRole: item.AccessRole,
			})
		}
		if page.NextPageToken == "" {
			break
		}
		pageToken = page.NextPageToken
	}
	return calendars, nil
}

func (s *Service) fetchGoogleEvents(ctx context.Context, connection *models.IntegrationConnection, calendar *models.CachedCalendarSource, start, end time.Time, currentToken string) (*calendarFetchResult, error) {
	if currentToken != "" {
		result, err := s.fetchGoogleEventsIncremental(ctx, connection, calendar, currentToken)
		if err == nil {
			return result, nil
		}
		if !strings.Contains(err.Error(), "410") {
			return nil, err
		}
	}
	return s.fetchGoogleEventsFull(ctx, connection, calendar, start, end)
}

func (s *Service) fetchGoogleEventsFull(ctx context.Context, connection *models.IntegrationConnection, calendar *models.CachedCalendarSource, start, end time.Time) (*calendarFetchResult, error) {
	var allItems []googleEventItem
	var nextSyncToken string
	pageToken := ""
	for {
		values := url.Values{}
		values.Set("timeMin", start.Format(time.RFC3339))
		values.Set("timeMax", end.Format(time.RFC3339))
		values.Set("orderBy", "startTime")
		values.Set("singleEvents", "true")
		values.Set("maxResults", "2500")
		if pageToken != "" {
			values.Set("pageToken", pageToken)
		}
		requestURL := fmt.Sprintf("https://www.googleapis.com/calendar/v3/calendars/%s/events?%s", url.PathEscape(calendar.ID), values.Encode())
		body, status, err := s.doGoogleGet(ctx, connection, requestURL)
		if err != nil {
			return nil, err
		}
		if status != http.StatusOK {
			return nil, providerAPIError("Google Calendar", status, body)
		}
		var page struct {
			Items         []googleEventItem `json:"items"`
			NextPageToken string            `json:"nextPageToken"`
			NextSyncToken string            `json:"nextSyncToken"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return nil, err
		}
		allItems = append(allItems, page.Items...)
		if page.NextSyncToken != "" {
			nextSyncToken = page.NextSyncToken
		}
		if page.NextPageToken == "" {
			break
		}
		pageToken = page.NextPageToken
	}
	events, _ := s.buildGoogleEvents(allItems, connection, calendar)
	return &calendarFetchResult{Events: events, NextToken: nextSyncToken, WasFullSync: true}, nil
}

func (s *Service) fetchGoogleEventsIncremental(ctx context.Context, connection *models.IntegrationConnection, calendar *models.CachedCalendarSource, syncToken string) (*calendarFetchResult, error) {
	var allItems []googleEventItem
	var deleted []string
	var nextSyncToken string
	pageToken := ""
	for {
		values := url.Values{}
		values.Set("syncToken", syncToken)
		values.Set("singleEvents", "true")
		values.Set("maxResults", "2500")
		if pageToken != "" {
			values.Set("pageToken", pageToken)
		}
		requestURL := fmt.Sprintf("https://www.googleapis.com/calendar/v3/calendars/%s/events?%s", url.PathEscape(calendar.ID), values.Encode())
		body, status, err := s.doGoogleGet(ctx, connection, requestURL)
		if err != nil {
			return nil, err
		}
		if status == http.StatusGone {
			return nil, fmt.Errorf("Google Calendar syncToken expired (410 Gone)")
		}
		if status != http.StatusOK {
			return nil, providerAPIError("Google Calendar", status, body)
		}
		var page struct {
			Items         []googleEventItem `json:"items"`
			NextPageToken string            `json:"nextPageToken"`
			NextSyncToken string            `json:"nextSyncToken"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return nil, err
		}
		for _, item := range page.Items {
			if item.Status == "cancelled" {
				deleted = append(deleted, item.ID)
			} else {
				allItems = append(allItems, item)
			}
		}
		if page.NextSyncToken != "" {
			nextSyncToken = page.NextSyncToken
		}
		if page.NextPageToken == "" {
			break
		}
		pageToken = page.NextPageToken
	}
	events, noLongerMeetings := s.buildGoogleEvents(allItems, connection, calendar)
	deleted = append(deleted, noLongerMeetings...)
	return &calendarFetchResult{Events: events, Deleted: deleted, NextToken: nextSyncToken, WasFullSync: false}, nil
}

func (s *Service) doGoogleGet(ctx context.Context, connection *models.IntegrationConnection, requestURL string) ([]byte, int, error) {
	const maxAttempts = 4
	for attempt := 0; attempt < maxAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
		if err != nil {
			return nil, 0, err
		}
		req.Header.Set("Authorization", "Bearer "+connection.AccessToken)
		resp, err := s.client.Do(req)
		if err != nil {
			if attempt < maxAttempts-1 {
				if waitErr := sleepWithContext(ctx, time.Duration(1<<attempt)*time.Second); waitErr != nil {
					return nil, 0, waitErr
				}
				continue
			}
			return nil, 0, err
		}
		body, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if readErr != nil {
			return nil, 0, readErr
		}
		if (resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500) && attempt < maxAttempts-1 {
			if waitErr := sleepWithContext(ctx, microsoftRetryDelay(resp.Header.Get("Retry-After"), attempt)); waitErr != nil {
				return nil, 0, waitErr
			}
			continue
		}
		return body, resp.StatusCode, nil
	}
	return nil, 0, fmt.Errorf("Google Calendar API retry attempts exhausted")
}

func (s *Service) buildGoogleEvents(items []googleEventItem, connection *models.IntegrationConnection, calendar *models.CachedCalendarSource) ([]*models.CachedCalendarEvent, []string) {
	events := make([]*models.CachedCalendarEvent, 0, len(items))
	var nonMeetingIDs []string
	for _, item := range items {
		if item.Status == "cancelled" {
			continue
		}
		eventStart := parseGoogleTime(item.Start.DateTime, item.Start.Date)
		eventEnd := parseGoogleTime(item.End.DateTime, item.End.Date)
		if eventStart.IsZero() || eventEnd.IsZero() {
			continue
		}
		meetingLink := item.HangoutLink
		if meetingLink == "" {
			for _, entryPoint := range item.ConferenceData.EntryPoints {
				if entryPoint.URI != "" && (entryPoint.EntryPointType == "video" || entryPoint.EntryPointType == "hangoutsMeet") {
					meetingLink = entryPoint.URI
					break
				}
			}
		}
		attendees := make([]models.CalendarEventAttendee, 0, len(item.Attendees))
		for _, attendee := range item.Attendees {
			if attendee.DisplayName != "" || attendee.Email != "" {
				attendeeType := "required"
				if attendee.Optional {
					attendeeType = "optional"
				}
				if attendee.Resource {
					attendeeType = "resource"
				}
				attendees = append(attendees, models.CalendarEventAttendee{
					ProviderID:     attendee.ID,
					Name:           attendee.DisplayName,
					Email:          strings.ToLower(strings.TrimSpace(attendee.Email)),
					ResponseStatus: strings.ToLower(attendee.ResponseStatus),
					AttendeeType:   attendeeType,
					Optional:       attendee.Optional,
					Organizer:      attendee.Organizer,
					Self:           attendee.Self,
					Resource:       attendee.Resource,
				})
			}
		}
		attendeesJSON, _ := json.Marshal(attendees)
		event := &models.CachedCalendarEvent{
			Provider:       string(models.IntegrationProviderGoogle),
			ConnectionID:   connection.ID,
			AccountEmail:   stringValue(connection.ProviderEmail),
			CalendarID:     calendar.ID,
			CalendarName:   calendar.Name,
			Color:          calendar.Color,
			ProviderID:     item.ID,
			Title:          firstNonEmpty(item.Summary, "Untitled event"),
			Start:          eventStart,
			End:            eventEnd,
			AllDay:         item.Start.Date != "",
			Location:       item.Location,
			Description:    item.Description,
			MeetingLink:    meetingLink,
			EventLink:      item.HTMLLink,
			OrganizerName:  item.Organizer.DisplayName,
			OrganizerEmail: strings.ToLower(strings.TrimSpace(item.Organizer.Email)),
			Attendees:      attendees,
			AttendeesJSON:  attendeesJSON,
		}
		if !isMeeting(event.Title, event.Description, event.Location, event.MeetingLink, attendeesJSON) {
			nonMeetingIDs = append(nonMeetingIDs, event.ProviderID)
			continue
		}
		events = append(events, event)
	}
	return events, nonMeetingIDs
}

func (s *Service) fetchMicrosoftCalendars(ctx context.Context, connection *models.IntegrationConnection) ([]*models.CachedCalendarSource, error) {
	type calendarListItem struct {
		ID                string `json:"id"`
		Name              string `json:"name"`
		Color             string `json:"color"`
		IsDefaultCalendar bool   `json:"isDefaultCalendar"`
		CanEdit           bool   `json:"canEdit"`
	}
	var calendars []*models.CachedCalendarSource
	nextURL := "https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,color,isDefaultCalendar,canEdit&$top=100"
	for nextURL != "" {
		body, err := s.doMicrosoftGet(ctx, connection, nextURL, `odata.maxpagesize=100`)
		if err != nil {
			return nil, err
		}
		var page struct {
			Value    []calendarListItem `json:"value"`
			NextLink string             `json:"@odata.nextLink"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return nil, err
		}
		for _, item := range page.Value {
			color := microsoftCalendarColor(item.Color)
			calendars = append(calendars, &models.CachedCalendarSource{
				ID: item.ID, ConnectionID: connection.ID, AccountEmail: stringValue(connection.ProviderEmail),
				Name: item.Name, Provider: string(models.IntegrationProviderMicrosoft), Color: color,
				BackgroundColor: color, Primary: item.IsDefaultCalendar, Selected: true, Visible: true,
				AccessRole: microsoftCalendarAccessRole(item.CanEdit),
			})
		}
		nextURL = page.NextLink
	}
	return calendars, nil
}

func (s *Service) fetchMicrosoftEvents(ctx context.Context, connection *models.IntegrationConnection, calendar *models.CachedCalendarSource, start, end time.Time, currentToken string) (*calendarFetchResult, error) {
	if currentToken != "" {
		result, err := s.fetchMicrosoftEventsIncremental(ctx, connection, calendar, currentToken)
		if err == nil {
			return result, nil
		}
		if !strings.Contains(err.Error(), "410") {
			return nil, err
		}
	}
	return s.fetchMicrosoftEventsFull(ctx, connection, calendar, start, end)
}

func (s *Service) fetchMicrosoftEventsFull(ctx context.Context, connection *models.IntegrationConnection, calendar *models.CachedCalendarSource, start, end time.Time) (*calendarFetchResult, error) {
	values := url.Values{}
	values.Set("startDateTime", start.Format(time.RFC3339))
	values.Set("endDateTime", end.Format(time.RFC3339))
	values.Set("$select", "id,subject,start,end,isAllDay,location,bodyPreview,onlineMeetingUrl,onlineMeeting,organizer,attendees,webLink")
	requestURL := fmt.Sprintf("https://graph.microsoft.com/v1.0/me/calendars/%s/calendarView/delta?%s", url.PathEscape(calendar.ID), values.Encode())

	var allItems []microsoftEventItem
	var deltaLink string
	nextURL := requestURL
	for nextURL != "" {
		body, err := s.doMicrosoftGet(ctx, connection, nextURL, `outlook.timezone="UTC", odata.maxpagesize=250`)
		if err != nil {
			return nil, err
		}
		var page struct {
			Value     []microsoftEventItem `json:"value"`
			NextLink  string               `json:"@odata.nextLink"`
			DeltaLink string               `json:"@odata.deltaLink"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return nil, err
		}
		allItems = append(allItems, page.Value...)
		if page.DeltaLink != "" {
			deltaLink = page.DeltaLink
		}
		nextURL = page.NextLink
	}
	events, _ := s.buildMicrosoftEvents(allItems, connection, calendar)
	return &calendarFetchResult{Events: events, NextToken: deltaLink, WasFullSync: true}, nil
}

func (s *Service) fetchMicrosoftEventsIncremental(ctx context.Context, connection *models.IntegrationConnection, calendar *models.CachedCalendarSource, deltaLinkURL string) (*calendarFetchResult, error) {
	var allItems []microsoftEventItem
	var deleted []string
	var newDeltaLink string
	nextURL := deltaLinkURL
	for nextURL != "" {
		body, err := s.doMicrosoftGet(ctx, connection, nextURL, `outlook.timezone="UTC", odata.maxpagesize=250`)
		if err != nil {
			return nil, err
		}
		var page struct {
			Value     []microsoftEventItem `json:"value"`
			NextLink  string               `json:"@odata.nextLink"`
			DeltaLink string               `json:"@odata.deltaLink"`
		}
		if err := json.Unmarshal(body, &page); err != nil {
			return nil, err
		}
		for _, item := range page.Value {
			if item.Removed != nil {
				deleted = append(deleted, item.ID)
			} else {
				allItems = append(allItems, item)
			}
		}
		if page.DeltaLink != "" {
			newDeltaLink = page.DeltaLink
		}
		nextURL = page.NextLink
	}
	events, noLongerMeetings := s.buildMicrosoftEvents(allItems, connection, calendar)
	deleted = append(deleted, noLongerMeetings...)
	return &calendarFetchResult{Events: events, Deleted: deleted, NextToken: newDeltaLink, WasFullSync: false}, nil
}

func (s *Service) buildMicrosoftEvents(items []microsoftEventItem, connection *models.IntegrationConnection, calendar *models.CachedCalendarSource) ([]*models.CachedCalendarEvent, []string) {
	events := make([]*models.CachedCalendarEvent, 0, len(items))
	var nonMeetingIDs []string
	for _, item := range items {
		if item.Removed != nil {
			continue
		}
		eventStart, err := parseMicrosoftDateTime(item.Start.DateTime)
		if err != nil {
			continue
		}
		eventEnd, err := parseMicrosoftDateTime(item.End.DateTime)
		if err != nil {
			continue
		}
		attendees := make([]models.CalendarEventAttendee, 0, len(item.Attendees))
		organizerEmail := strings.ToLower(strings.TrimSpace(item.Organizer.EmailAddress.Address))
		accountEmail := strings.ToLower(strings.TrimSpace(stringValue(connection.ProviderEmail)))
		for _, attendee := range item.Attendees {
			name := attendee.EmailAddress.Name
			email := strings.ToLower(strings.TrimSpace(attendee.EmailAddress.Address))
			if name != "" || email != "" {
				attendeeType := strings.ToLower(attendee.Type)
				if attendeeType == "" {
					attendeeType = "required"
				}
				attendees = append(attendees, models.CalendarEventAttendee{
					Name:           name,
					Email:          email,
					ResponseStatus: strings.ToLower(attendee.Status.Response),
					AttendeeType:   attendeeType,
					Optional:       attendeeType == "optional",
					Organizer:      email != "" && email == organizerEmail,
					Self:           email != "" && email == accountEmail,
					Resource:       attendeeType == "resource",
				})
			}
		}
		attendeesJSON, _ := json.Marshal(attendees)
		meetingLink := firstNonEmpty(item.OnlineMeetingURL, item.OnlineMeeting.JoinURL)
		event := &models.CachedCalendarEvent{
			Provider:       string(models.IntegrationProviderMicrosoft),
			ConnectionID:   connection.ID,
			AccountEmail:   stringValue(connection.ProviderEmail),
			CalendarID:     calendar.ID,
			CalendarName:   calendar.Name,
			Color:          calendar.Color,
			ProviderID:     item.ID,
			Title:          firstNonEmpty(item.Subject, "Untitled event"),
			Start:          eventStart,
			End:            eventEnd,
			AllDay:         item.IsAllDay,
			Location:       item.Location.DisplayName,
			Description:    item.BodyPreview,
			MeetingLink:    meetingLink,
			EventLink:      item.WebLink,
			OrganizerName:  item.Organizer.EmailAddress.Name,
			OrganizerEmail: organizerEmail,
			Attendees:      attendees,
			AttendeesJSON:  attendeesJSON,
		}
		if !isMeeting(event.Title, event.Description, event.Location, event.MeetingLink, attendeesJSON) {
			nonMeetingIDs = append(nonMeetingIDs, event.ProviderID)
			continue
		}
		events = append(events, event)
	}
	return events, nonMeetingIDs
}

func (s *Service) doMicrosoftGet(ctx context.Context, connection *models.IntegrationConnection, requestURL string, prefer string) ([]byte, error) {
	const maxAttempts = 4
	for attempt := 0; attempt < maxAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+connection.AccessToken)
		if prefer != "" {
			req.Header.Set("Prefer", prefer)
		}

		resp, err := s.client.Do(req)
		if err != nil {
			if attempt < maxAttempts-1 {
				if waitErr := sleepWithContext(ctx, microsoftRetryDelay("", attempt)); waitErr != nil {
					return nil, waitErr
				}
				continue
			}
			return nil, err
		}

		body, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		if resp.StatusCode == http.StatusOK {
			return body, nil
		}
		if isRetryableMicrosoftGraphResponse(resp.StatusCode, body) && attempt < maxAttempts-1 {
			if waitErr := sleepWithContext(ctx, microsoftRetryDelay(resp.Header.Get("Retry-After"), attempt)); waitErr != nil {
				return nil, waitErr
			}
			continue
		}
		return nil, providerAPIError("Microsoft Graph", resp.StatusCode, body)
	}
	return nil, fmt.Errorf("Microsoft Graph API error: retry attempts exhausted")
}

func isRetryableMicrosoftGraphResponse(status int, body []byte) bool {
	if status == http.StatusTooManyRequests || status == http.StatusServiceUnavailable || status == http.StatusGatewayTimeout {
		return true
	}
	lowerBody := strings.ToLower(string(body))
	return strings.Contains(lowerBody, "applicationthrottled") || strings.Contains(lowerBody, "mailboxconcurrency")
}

func microsoftRetryDelay(retryAfter string, attempt int) time.Duration {
	if seconds, err := strconv.Atoi(strings.TrimSpace(retryAfter)); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	return time.Duration(1<<attempt) * time.Second
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *Service) refreshConnectionTokenIfNeeded(parent context.Context, userID string, connection *models.IntegrationConnection) (err error) {
	if s.metrics != nil {
		s.metrics.TokenRefreshAttempts.Add(1)
		defer func() {
			if err != nil {
				s.metrics.TokenRefreshFailures.Add(1)
			} else {
				s.metrics.TokenRefreshSuccesses.Add(1)
			}
		}()
	}
	if connection.RefreshToken == nil {
		return fmt.Errorf("no refresh token available for %s", connection.Provider)
	}

	var refreshURL string
	var clientID, clientSecret string
	switch connection.Provider {
	case models.IntegrationProviderGoogle:
		refreshURL = "https://oauth2.googleapis.com/token"
		clientID = os.Getenv("GOOGLE_INTEGRATION_CLIENT_ID")
		clientSecret = os.Getenv("GOOGLE_INTEGRATION_CLIENT_SECRET")
	case models.IntegrationProviderMicrosoft:
		refreshURL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
		clientID = os.Getenv("MICROSOFT_INTEGRATION_CLIENT_ID")
		clientSecret = os.Getenv("MICROSOFT_INTEGRATION_CLIENT_SECRET")
	default:
		return fmt.Errorf("unsupported provider: %s", connection.Provider)
	}

	config := &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Endpoint: oauth2.Endpoint{
			TokenURL: refreshURL,
		},
	}
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	newToken, err := forceRefreshOAuthToken(ctx, config, *connection.RefreshToken)
	if err != nil {
		safeErr := redactOAuthError(err)
		if strings.Contains(strings.ToLower(safeErr.Error()), "invalid_grant") {
			if markErr := s.connections.MarkNeedsReconnect(userID, connection.ID); markErr != nil {
				log.Printf("calendar sync: failed to mark connection %s needs reconnect: %v", connection.ID, markErr)
			}
		}
		return fmt.Errorf("failed to refresh token: %w", safeErr)
	}

	updates := &models.UpdateIntegrationConnectionTokensRequest{AccessToken: &newToken.AccessToken}
	if newToken.RefreshToken != "" {
		updates.RefreshToken = &newToken.RefreshToken
	}
	if !newToken.Expiry.IsZero() {
		updates.ExpiresAt = &newToken.Expiry
	}
	return s.connections.UpdateTokens(userID, connection.ID, updates)
}

func forceRefreshOAuthToken(ctx context.Context, config *oauth2.Config, refreshToken string) (*oauth2.Token, error) {
	// Config.TokenSource reuses a supplied token while it is valid. Supplying
	// only the refresh token makes this an explicit refresh, which is required
	// both for the pre-expiry threshold and for retrying a provider 401.
	return config.TokenSource(ctx, &oauth2.Token{RefreshToken: refreshToken}).Token()
}

func redactOAuthError(err error) error {
	if err == nil {
		return nil
	}
	var retrieveErr *oauth2.RetrieveError
	if errors.As(err, &retrieveErr) {
		status := 0
		if retrieveErr.Response != nil {
			status = retrieveErr.Response.StatusCode
		}
		code := safeProviderErrorCode(retrieveErr.ErrorCode)
		if code != "" {
			return fmt.Errorf("OAuth token endpoint status %d (%s)", status, code)
		}
		return fmt.Errorf("OAuth token endpoint status %d", status)
	}
	return fmt.Errorf("OAuth token request failed")
}

func providerAPIError(provider string, status int, body []byte) error {
	var payload struct {
		Error json.RawMessage `json:"error"`
	}
	code := ""
	if json.Unmarshal(body, &payload) == nil && len(payload.Error) > 0 {
		var text string
		if json.Unmarshal(payload.Error, &text) == nil {
			code = text
		} else {
			var nested struct {
				Code json.RawMessage `json:"code"`
			}
			if json.Unmarshal(payload.Error, &nested) == nil {
				if json.Unmarshal(nested.Code, &text) == nil {
					code = text
				} else {
					var number json.Number
					if json.Unmarshal(nested.Code, &number) == nil {
						code = number.String()
					}
				}
			}
		}
	}
	code = safeProviderErrorCode(code)
	if code != "" {
		return fmt.Errorf("%s API error status %d (%s)", provider, status, code)
	}
	return fmt.Errorf("%s API error status %d", provider, status)
}

func safeProviderErrorCode(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 80 {
		value = value[:80]
	}
	for _, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') || strings.ContainsRune("._-", character) {
			continue
		}
		return ""
	}
	return value
}

func parseGoogleTime(dateTime, date string) time.Time {
	if dateTime != "" {
		if parsed, err := time.Parse(time.RFC3339, dateTime); err == nil {
			return parsed
		}
	}
	if date != "" {
		if parsed, err := time.Parse("2006-01-02", date); err == nil {
			return parsed
		}
	}
	return time.Time{}
}

func parseMicrosoftDateTime(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, fmt.Errorf("missing Microsoft dateTime")
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed, nil
	}
	for _, layout := range []string{"2006-01-02T15:04:05.9999999", "2006-01-02T15:04:05.999999", "2006-01-02T15:04:05"} {
		if parsed, err := time.ParseInLocation(layout, value, time.UTC); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid Microsoft dateTime: %s", value)
}

func isMeeting(title, description, location, meetingLink string, attendeesJSON []byte) bool {
	var attendees []map[string]string
	_ = json.Unmarshal(attendeesJSON, &attendees)
	if len(attendees) > 1 {
		return true
	}

	for _, keyword := range []string{"meeting", "call", "standup", "sync", "review", "interview", "discussion", "conference", "session", "catch up", "check in", "demo", "presentation", "workshop", "training", "scrum", "retrospective", "planning", "1:1", "one-on-one"} {
		if strings.Contains(strings.ToLower(title), keyword) {
			return true
		}
	}

	combined := strings.ToLower(description + " " + location + " " + meetingLink)
	for _, pattern := range []string{"zoom.us", "teams.microsoft.com", "meet.google.com", "webex.com", "gotomeeting.com", "join.me", "whereby.com", "discord.gg", "bluejeans.com"} {
		if strings.Contains(combined, pattern) {
			return true
		}
	}
	return false
}

func microsoftCalendarAccessRole(canEdit bool) string {
	if canEdit {
		return "writer"
	}
	return "reader"
}

func microsoftCalendarColor(value string) string {
	switch strings.ToLower(value) {
	case "lightblue":
		return "#5b9bd5"
	case "lightgreen":
		return "#70ad47"
	case "lightorange":
		return "#ed7d31"
	case "lightgray":
		return "#a5a5a5"
	case "lightyellow":
		return "#ffc000"
	case "lightteal":
		return "#00a2a5"
	case "lightpink":
		return "#ff99cc"
	case "lightbrown":
		return "#a0522d"
	case "lightred":
		return "#e06666"
	case "maxcolor":
		return "#7c3aed"
	default:
		return "#2563eb"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
