package calendar

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/redis/go-redis/v9"
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
		Email       string `json:"email"`
		DisplayName string `json:"displayName"`
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
	connections   repository.IntegrationConnectionRepository
	preferences   repository.CalendarPreferenceRepository
	cache         repository.CalendarCacheRepository
	noteAttendees *repository.NoteAttendeeRepository
	redis         *redis.Client
	client        *http.Client
}

func NewService(connections repository.IntegrationConnectionRepository, preferences repository.CalendarPreferenceRepository, cache repository.CalendarCacheRepository, noteAttendees *repository.NoteAttendeeRepository, redisClient *redis.Client) *Service {
	return &Service{
		connections:   connections,
		preferences:   preferences,
		cache:         cache,
		noteAttendees: noteAttendees,
		redis:         redisClient,
		client: &http.Client{
			Timeout: 8 * time.Second,
		},
	}
}

func (s *Service) SyncUser(ctx context.Context, userID string, scope SyncScope) error {
	connections, err := s.calendarConnections(userID)
	if err != nil {
		return err
	}
	if len(connections) == 0 {
		return nil
	}

	sem := semaphore.NewWeighted(4)
	group, ctx := errgroup.WithContext(ctx)
	for _, connection := range connections {
		connection := connection
		group.Go(func() error {
			if err := sem.Acquire(ctx, 1); err != nil {
				return err
			}
			defer sem.Release(1)

			if err := s.syncConnection(ctx, userID, connection, scope); err != nil {
				log.Printf("calendar sync: connection %s failed: %v", connection.ID, err)
			}
			return nil
		})
	}
	if err := group.Wait(); err != nil {
		return err
	}
	if err := s.noteAttendees.SyncAllFromCalendarEvents(userID); err != nil {
		log.Printf("calendar sync: failed to sync note attendees for user %s: %v", userID, err)
	}
	return nil
}

func (s *Service) syncConnection(ctx context.Context, userID string, connection *models.IntegrationConnection, scope SyncScope) error {
	lockKey := fmt.Sprintf("calendar-sync:%s:%s:%s", userID, connection.ID, scope)
	if s.redis != nil {
		locked, err := s.redis.SetNX(ctx, lockKey, "1", 3*time.Minute).Result()
		if err != nil {
			log.Printf("calendar sync: redis lock failed for %s: %v", connection.ID, err)
		} else if !locked {
			return nil
		} else {
			defer s.redis.Del(context.Background(), lockKey)
		}
	}

	if err := s.cache.MarkSyncStarted(ctx, userID, connection.ID); err != nil {
		return err
	}

	if connection.ExpiresAt != nil && time.Now().After(*connection.ExpiresAt) {
		if err := s.refreshConnectionTokenIfNeeded(ctx, userID, connection); err != nil {
			_ = s.cache.MarkSyncError(ctx, userID, connection.ID, err)
			return err
		}
		refreshed, err := s.connections.GetByID(userID, connection.ID)
		if err != nil {
			_ = s.cache.MarkSyncError(ctx, userID, connection.ID, err)
			return err
		}
		connection = refreshed
	}

	var fetchedCalendars []*models.CachedCalendarSource
	if scope == SyncScopeAll || scope == SyncScopeCalendars {
		calendars, err := s.fetchCalendars(ctx, connection)
		if err != nil {
			s.markNeedsReconnectOnAuthError(userID, connection.ID, err)
			_ = s.cache.MarkSyncError(ctx, userID, connection.ID, err)
			return err
		}
		if err := s.cache.UpsertCalendarSources(ctx, userID, connection, calendars); err != nil {
			_ = s.cache.MarkSyncError(ctx, userID, connection.ID, err)
			return err
		}
		fetchedCalendars = calendars
	}

	if scope == SyncScopeAll || scope == SyncScopeEvents {
		windowStart, windowEnd := anchoredSyncWindow(time.Now())
		if err := s.syncEvents(ctx, userID, connection, fetchedCalendars, windowStart, windowEnd); err != nil {
			_ = s.cache.MarkSyncError(ctx, userID, connection.ID, err)
			return err
		}
		if err := s.cache.MarkSyncSuccess(ctx, userID, connection.ID, string(scope), &windowStart, &windowEnd); err != nil {
			return err
		}
		return nil
	}

	return s.cache.MarkSyncSuccess(ctx, userID, connection.ID, string(scope), nil, nil)
}

func (s *Service) syncEvents(ctx context.Context, userID string, connection *models.IntegrationConnection, calendars []*models.CachedCalendarSource, windowStart, windowEnd time.Time) error {
	if calendars == nil {
		fetched, err := s.fetchCalendars(ctx, connection)
		if err != nil {
			s.markNeedsReconnectOnAuthError(userID, connection.ID, err)
			return err
		}
		if err := s.cache.UpsertCalendarSources(ctx, userID, connection, fetched); err != nil {
			return err
		}
	}

	dbSources, err := s.cache.ListCalendarSources(ctx, userID)
	if err != nil {
		return err
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
	group, ctx := errgroup.WithContext(ctx)
	for _, source := range visible {
		source := source
		group.Go(func() error {
			if err := sem.Acquire(ctx, 1); err != nil {
				return err
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
				log.Printf("calendar sync: failed to fetch events for connection %s calendar %s: %v", connection.ID, source.ID, err)
				return nil
			}
			if err := s.cache.UpsertCalendarEvents(ctx, userID, connection, result.Events); err != nil {
				return err
			}
			if len(result.Deleted) > 0 {
				if err := s.cache.DeleteCalendarEventsByProviderID(ctx, userID, connection.ID, source.ID, result.Deleted); err != nil {
					return err
				}
			}
			if result.WasFullSync {
				seen := make([]string, 0, len(result.Events))
				for _, event := range result.Events {
					seen = append(seen, event.ProviderID)
				}
				if err := s.cache.DeleteEventsNotSeen(ctx, userID, connection.ID, source.ID, windowStart, windowEnd, seen); err != nil {
					return err
				}
			}
			if result.NextToken != "" {
				if err := s.cache.SaveCalendarSyncToken(ctx, userID, connection.ID, source.ID, result.NextToken, windowStart, windowEnd); err != nil {
					return err
				}
			}
			return nil
		})
	}
	return group.Wait()
}

func (s *Service) markNeedsReconnectOnAuthError(userID, connectionID string, err error) {
	if err == nil {
		return
	}
	message := strings.ToLower(err.Error())
	if !strings.Contains(message, "invalid_grant") && !strings.Contains(message, "unauthorized") && !strings.Contains(message, "401") {
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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.googleapis.com/calendar/v3/users/me/calendarList", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+connection.AccessToken)

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Google CalendarList API error: %s", string(body))
	}

	var googleResponse struct {
		Items []struct {
			ID              string `json:"id"`
			Summary         string `json:"summary"`
			BackgroundColor string `json:"backgroundColor"`
			ForegroundColor string `json:"foregroundColor"`
			Primary         bool   `json:"primary"`
			Selected        bool   `json:"selected"`
			AccessRole      string `json:"accessRole"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&googleResponse); err != nil {
		return nil, err
	}

	calendars := make([]*models.CachedCalendarSource, 0, len(googleResponse.Items))
	for _, item := range googleResponse.Items {
		calendars = append(calendars, &models.CachedCalendarSource{
			ID:              item.ID,
			ConnectionID:    connection.ID,
			AccountEmail:    stringValue(connection.ProviderEmail),
			Name:            item.Summary,
			Provider:        string(models.IntegrationProviderGoogle),
			Color:           item.BackgroundColor,
			BackgroundColor: item.BackgroundColor,
			ForegroundColor: item.ForegroundColor,
			Primary:         item.Primary,
			Selected:        item.Selected,
			Visible:         item.Primary || item.Selected,
			AccessRole:      item.AccessRole,
		})
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
			return nil, fmt.Errorf("Google Calendar API error %d: %s", status, string(body))
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
			return nil, fmt.Errorf("Google Calendar API error %d: %s", status, string(body))
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
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+connection.AccessToken)
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	body, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	return body, resp.StatusCode, err
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
		attendees := make([]map[string]string, 0, len(item.Attendees))
		for _, attendee := range item.Attendees {
			if attendee.DisplayName != "" || attendee.Email != "" {
				attendees = append(attendees, map[string]string{"name": attendee.DisplayName, "email": attendee.Email})
			}
		}
		attendeesJSON, _ := json.Marshal(attendees)
		event := &models.CachedCalendarEvent{
			Provider:      string(models.IntegrationProviderGoogle),
			ConnectionID:  connection.ID,
			AccountEmail:  stringValue(connection.ProviderEmail),
			CalendarID:    calendar.ID,
			CalendarName:  calendar.Name,
			Color:         calendar.Color,
			ProviderID:    item.ID,
			Title:         firstNonEmpty(item.Summary, "Untitled event"),
			Start:         eventStart,
			End:           eventEnd,
			AllDay:        item.Start.Date != "",
			Location:      item.Location,
			Description:   item.Description,
			MeetingLink:   meetingLink,
			EventLink:     item.HTMLLink,
			Organizer:     firstNonEmpty(item.Organizer.DisplayName, item.Organizer.Email),
			AttendeesJSON: attendeesJSON,
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
	body, err := s.doMicrosoftGet(ctx, connection, "https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,color,isDefaultCalendar,canEdit", "")
	if err != nil {
		return nil, err
	}

	var microsoftResponse struct {
		Value []struct {
			ID                string `json:"id"`
			Name              string `json:"name"`
			Color             string `json:"color"`
			IsDefaultCalendar bool   `json:"isDefaultCalendar"`
			CanEdit           bool   `json:"canEdit"`
		} `json:"value"`
	}
	if err := json.Unmarshal(body, &microsoftResponse); err != nil {
		return nil, err
	}

	calendars := make([]*models.CachedCalendarSource, 0, len(microsoftResponse.Value))
	for _, item := range microsoftResponse.Value {
		color := microsoftCalendarColor(item.Color)
		calendars = append(calendars, &models.CachedCalendarSource{
			ID:              item.ID,
			ConnectionID:    connection.ID,
			AccountEmail:    stringValue(connection.ProviderEmail),
			Name:            item.Name,
			Provider:        string(models.IntegrationProviderMicrosoft),
			Color:           color,
			BackgroundColor: color,
			Primary:         item.IsDefaultCalendar,
			Selected:        true,
			Visible:         true,
			AccessRole:      microsoftCalendarAccessRole(item.CanEdit),
		})
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
		attendees := make([]map[string]string, 0, len(item.Attendees))
		for _, attendee := range item.Attendees {
			name := attendee.EmailAddress.Name
			email := attendee.EmailAddress.Address
			if name != "" || email != "" {
				attendees = append(attendees, map[string]string{"name": name, "email": email})
			}
		}
		attendeesJSON, _ := json.Marshal(attendees)
		meetingLink := firstNonEmpty(item.OnlineMeetingURL, item.OnlineMeeting.JoinURL)
		event := &models.CachedCalendarEvent{
			Provider:      string(models.IntegrationProviderMicrosoft),
			ConnectionID:  connection.ID,
			AccountEmail:  stringValue(connection.ProviderEmail),
			CalendarID:    calendar.ID,
			CalendarName:  calendar.Name,
			Color:         calendar.Color,
			ProviderID:    item.ID,
			Title:         firstNonEmpty(item.Subject, "Untitled event"),
			Start:         eventStart,
			End:           eventEnd,
			AllDay:        item.IsAllDay,
			Location:      item.Location.DisplayName,
			Description:   item.BodyPreview,
			MeetingLink:   meetingLink,
			EventLink:     item.WebLink,
			Organizer:     firstNonEmpty(item.Organizer.EmailAddress.Name, item.Organizer.EmailAddress.Address),
			AttendeesJSON: attendeesJSON,
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
		return nil, fmt.Errorf("Microsoft Graph API error status %d: %s", resp.StatusCode, string(body))
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

func (s *Service) refreshConnectionTokenIfNeeded(parent context.Context, userID string, connection *models.IntegrationConnection) error {
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

	oauthToken := &oauth2.Token{
		AccessToken:  connection.AccessToken,
		RefreshToken: *connection.RefreshToken,
		TokenType:    "Bearer",
	}
	if connection.ExpiresAt != nil {
		oauthToken.Expiry = *connection.ExpiresAt
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
	newToken, err := config.TokenSource(ctx, oauthToken).Token()
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "invalid_grant") {
			if markErr := s.connections.MarkNeedsReconnect(userID, connection.ID); markErr != nil {
				log.Printf("calendar sync: failed to mark connection %s needs reconnect: %v", connection.ID, markErr)
			}
		}
		return fmt.Errorf("failed to refresh token: %w", err)
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
