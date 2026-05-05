package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"golang.org/x/oauth2"
)

type CalendarHandler struct {
	connectionRepo repository.IntegrationConnectionRepository
	preferenceRepo repository.CalendarPreferenceRepository
}

type CalendarEvent struct {
	ID           string             `json:"id"`
	ProviderID   string             `json:"provider_id"`
	ConnectionID string             `json:"connection_id"`
	AccountEmail string             `json:"account_email,omitempty"`
	Title        string             `json:"title"`
	Start        time.Time          `json:"start"`
	End          time.Time          `json:"end"`
	Location     string             `json:"location,omitempty"`
	Description  string             `json:"description,omitempty"`
	MeetingLink  string             `json:"meeting_link,omitempty"`
	CalendarID   string             `json:"calendar_id,omitempty"`
	CalendarName string             `json:"calendar_name,omitempty"`
	Color        string             `json:"color,omitempty"`
	Organizer    string             `json:"organizer,omitempty"`
	Provider     string             `json:"provider"`
	IsMeeting    bool               `json:"is_meeting"`
	Attendees    []CalendarAttendee `json:"attendees,omitempty"`
}

type CalendarAttendee struct {
	Name  string `json:"name,omitempty"`
	Email string `json:"email,omitempty"`
}

type CalendarSource struct {
	ID              string `json:"id"`
	ConnectionID    string `json:"connection_id"`
	AccountEmail    string `json:"account_email,omitempty"`
	Name            string `json:"name"`
	Provider        string `json:"provider"`
	Color           string `json:"color,omitempty"`
	BackgroundColor string `json:"background_color,omitempty"`
	ForegroundColor string `json:"foreground_color,omitempty"`
	Primary         bool   `json:"primary"`
	Selected        bool   `json:"selected"`
	Visible         bool   `json:"visible"`
	AccessRole      string `json:"access_role,omitempty"`
}

type updateCalendarVisibilityRequest struct {
	Visible *bool `json:"visible" binding:"required"`
}

func NewCalendarHandler(connectionRepo repository.IntegrationConnectionRepository, preferenceRepo repository.CalendarPreferenceRepository) *CalendarHandler {
	return &CalendarHandler{
		connectionRepo: connectionRepo,
		preferenceRepo: preferenceRepo,
	}
}

func (h *CalendarHandler) GetCalendars(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	calendars, err := h.getCalendars(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch calendars"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":    "success",
		"calendars": calendars,
	})
}

func (h *CalendarHandler) GetUpcomingEvents(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	limitStr := c.DefaultQuery("limit", "10")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 1 || limit > 100 {
		limit = 10
	}

	events, err := h.getUpcomingEvents(userID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch calendar events"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "success",
		"events": events,
	})
}

func (h *CalendarHandler) UpdateCalendarVisibility(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"status": "error", "error": "Unauthorized"})
		return
	}

	connectionID := strings.TrimSpace(c.Param("connectionID"))
	calendarID := strings.TrimSpace(c.Param("calendarID"))
	if connectionID == "" || calendarID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "error": "Missing connection or calendar ID"})
		return
	}

	var request updateCalendarVisibilityRequest
	if err := c.ShouldBindJSON(&request); err != nil || request.Visible == nil {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "error": "Invalid visibility request"})
		return
	}

	connection, err := h.connectionRepo.GetByID(userID, connectionID)
	if err != nil {
		log.Printf("calendar: failed to load connection %s for visibility update: %v", connectionID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "error": "Failed to update calendar visibility"})
		return
	}
	if connection == nil {
		c.JSON(http.StatusNotFound, gin.H{"status": "error", "error": "Connection not found"})
		return
	}
	if connection.Status == models.IntegrationConnectionStatusDisconnected {
		c.JSON(http.StatusBadRequest, gin.H{"status": "error", "error": "Connection is disconnected"})
		return
	}

	if err := h.preferenceRepo.UpsertVisibility(userID, connectionID, calendarID, *request.Visible); err != nil {
		log.Printf("calendar: failed to update visibility for connection %s calendar %s: %v", connectionID, calendarID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "error": "Failed to update calendar visibility"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":        "success",
		"connection_id": connectionID,
		"calendar_id":   calendarID,
		"visible":       *request.Visible,
	})
}

func (h *CalendarHandler) getCalendars(userID string) ([]*CalendarSource, error) {
	var allCalendars []*CalendarSource

	connections, err := h.connectionRepo.GetActiveByUserAndProvider(userID, string(models.IntegrationProviderGoogle))
	if err != nil {
		return nil, fmt.Errorf("failed to get calendar connections: %w", err)
	}

	if len(connections) == 0 {
		return []*CalendarSource{}, nil
	}

	for _, connection := range connections {
		if connection.ExpiresAt != nil && time.Now().After(*connection.ExpiresAt) {
			err := h.refreshConnectionTokenIfNeeded(userID, connection)
			if err != nil {
				log.Printf("calendar: failed to refresh connection %s for user %s: %v", connection.ID, userID, err)
				continue
			}
			refreshedConnection, err := h.connectionRepo.GetByID(userID, connection.ID)
			if err != nil {
				log.Printf("calendar: failed to reload refreshed connection %s for user %s: %v", connection.ID, userID, err)
				continue
			}
			connection = refreshedConnection
		}

		calendars, err := h.getGoogleCalendars(connection)
		if err != nil {
			log.Printf("calendar: failed to fetch calendars for connection %s: %v", connection.ID, err)
			continue
		}

		preferences, err := h.preferenceRepo.GetVisibleCalendarIDs(userID, connection.ID)
		if err != nil {
			log.Printf("calendar: failed to fetch preferences for connection %s: %v", connection.ID, err)
			preferences = map[string]bool{}
		}

		applyCalendarVisibility(calendars, preferences)
		allCalendars = append(allCalendars, calendars...)
	}

	return allCalendars, nil
}

func (h *CalendarHandler) getUpcomingEvents(userID string, limit int) ([]*CalendarEvent, error) {
	var allEvents []*CalendarEvent

	connections, err := h.connectionRepo.GetActiveByUserAndProvider(userID, string(models.IntegrationProviderGoogle))
	if err != nil {
		return nil, fmt.Errorf("failed to get calendar connections: %w", err)
	}

	if len(connections) == 0 {
		return []*CalendarEvent{}, nil
	}

	for _, connection := range connections {
		if connection.ExpiresAt != nil && time.Now().After(*connection.ExpiresAt) {
			err := h.refreshConnectionTokenIfNeeded(userID, connection)
			if err != nil {
				log.Printf("calendar: failed to refresh connection %s for user %s: %v", connection.ID, userID, err)
				continue
			}
			refreshedConnection, err := h.connectionRepo.GetByID(userID, connection.ID)
			if err != nil {
				log.Printf("calendar: failed to reload refreshed connection %s for user %s: %v", connection.ID, userID, err)
				continue
			}
			connection = refreshedConnection
		}

		events, err := h.getGoogleCalendarEvents(userID, connection, limit)
		if err != nil {
			log.Printf("calendar: failed to fetch events for connection %s: %v", connection.ID, err)
			continue
		}

		allEvents = append(allEvents, events...)
	}

	sort.Slice(allEvents, func(i, j int) bool {
		return allEvents[i].Start.Before(allEvents[j].Start)
	})

	if limit > 0 && len(allEvents) > limit {
		allEvents = allEvents[:limit]
	}

	return allEvents, nil
}

func (h *CalendarHandler) refreshConnectionTokenIfNeeded(userID string, connection *models.IntegrationConnection) error {
	if connection.RefreshToken == nil {
		return fmt.Errorf("no refresh token available for %s", connection.Provider)
	}

	var refreshURL string
	var clientID, clientSecret string

	switch connection.Provider {
	case models.IntegrationProviderGoogle:
		refreshURL = "https://oauth2.googleapis.com/token"
		clientID = os.Getenv("GOOGLE_CLIENT_ID")
		clientSecret = os.Getenv("GOOGLE_CLIENT_SECRET")
	case models.IntegrationProviderMicrosoft:
		refreshURL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
		clientID = os.Getenv("MICROSOFT_CLIENT_ID")
		clientSecret = os.Getenv("MICROSOFT_CLIENT_SECRET")
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

	newToken, err := config.TokenSource(context.Background(), oauthToken).Token()
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "invalid_grant") {
			if markErr := h.connectionRepo.MarkNeedsReconnect(userID, connection.ID); markErr != nil {
				log.Printf("calendar: failed to mark connection %s needs reconnect: %v", connection.ID, markErr)
			}
		}
		return fmt.Errorf("failed to refresh token: %w", err)
	}

	updates := &models.UpdateIntegrationConnectionTokensRequest{
		AccessToken: &newToken.AccessToken,
	}

	if newToken.RefreshToken != "" {
		updates.RefreshToken = &newToken.RefreshToken
	}

	if !newToken.Expiry.IsZero() {
		updates.ExpiresAt = &newToken.Expiry
	}

	err = h.connectionRepo.UpdateTokens(userID, connection.ID, updates)
	if err != nil {
		return fmt.Errorf("failed to update token: %w", err)
	}

	return nil
}

func (h *CalendarHandler) getGoogleCalendars(connection *models.IntegrationConnection) ([]*CalendarSource, error) {
	client := &http.Client{}
	req, err := http.NewRequest("GET", "https://www.googleapis.com/calendar/v3/users/me/calendarList", nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+connection.AccessToken)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Google CalendarList API error: %s", string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
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

	if err := json.Unmarshal(body, &googleResponse); err != nil {
		return nil, err
	}

	calendars := make([]*CalendarSource, 0, len(googleResponse.Items))
	for _, item := range googleResponse.Items {
		calendars = append(calendars, &CalendarSource{
			ID:              item.ID,
			ConnectionID:    connection.ID,
			AccountEmail:    stringValue(connection.ProviderEmail),
			Name:            item.Summary,
			Provider:        "google",
			Color:           item.BackgroundColor,
			BackgroundColor: item.BackgroundColor,
			ForegroundColor: item.ForegroundColor,
			Primary:         item.Primary,
			Selected:        item.Selected,
			Visible:         defaultCalendarVisible(item.Primary, item.Selected),
			AccessRole:      item.AccessRole,
		})
	}

	return calendars, nil
}

func (h *CalendarHandler) getGoogleCalendarEvents(userID string, connection *models.IntegrationConnection, limit int) ([]*CalendarEvent, error) {
	calendars, err := h.getGoogleCalendars(connection)
	if err != nil {
		return nil, err
	}

	preferences, err := h.preferenceRepo.GetVisibleCalendarIDs(userID, connection.ID)
	if err != nil {
		log.Printf("calendar: failed to fetch preferences for connection %s: %v", connection.ID, err)
		preferences = map[string]bool{}
	}
	applyCalendarVisibility(calendars, preferences)

	var allEvents []*CalendarEvent
	for _, calendar := range calendars {
		if !calendar.Visible {
			continue
		}

		events, err := h.getGoogleCalendarEventsForCalendar(connection, calendar, limit)
		if err != nil {
			continue
		}
		allEvents = append(allEvents, events...)
	}

	return allEvents, nil
}

func (h *CalendarHandler) getGoogleCalendarEventsForCalendar(connection *models.IntegrationConnection, calendar *CalendarSource, limit int) ([]*CalendarEvent, error) {
	client := &http.Client{}

	timeMin := url.QueryEscape(time.Now().Format(time.RFC3339))
	calendarID := url.PathEscape(calendar.ID)
	requestURL := fmt.Sprintf("https://www.googleapis.com/calendar/v3/calendars/%s/events?timeMin=%s&orderBy=startTime&singleEvents=true&maxResults=%d", calendarID, timeMin, limit)

	req, err := http.NewRequest("GET", requestURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+connection.AccessToken)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var googleResponse struct {
		Items []struct {
			ID      string `json:"id"`
			Summary string `json:"summary"`
			Start   struct {
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
				Optional    bool   `json:"optional"`
			} `json:"attendees"`
		} `json:"items"`
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Google Calendar API error: %s", string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if err := json.Unmarshal(body, &googleResponse); err != nil {
		return nil, err
	}

	var events []*CalendarEvent
	for _, item := range googleResponse.Items {
		stableEventID := fmt.Sprintf("google:%s:%s:%s", connection.ID, calendar.ID, item.ID)
		event := &CalendarEvent{
			ID:           stableEventID,
			ProviderID:   item.ID,
			ConnectionID: connection.ID,
			AccountEmail: stringValue(connection.ProviderEmail),
			Title:        item.Summary,
			Location:     item.Location,
			Description:  item.Description,
			MeetingLink:  item.HangoutLink,
			CalendarID:   calendar.ID,
			CalendarName: calendar.Name,
			Color:        calendar.Color,
			Provider:     "google",
		}

		if event.MeetingLink == "" {
			for _, entryPoint := range item.ConferenceData.EntryPoints {
				if entryPoint.URI != "" && (entryPoint.EntryPointType == "video" || entryPoint.EntryPointType == "hangoutsMeet") {
					event.MeetingLink = entryPoint.URI
					break
				}
			}
		}

		if item.Organizer.DisplayName != "" {
			event.Organizer = item.Organizer.DisplayName
		} else if item.Organizer.Email != "" {
			event.Organizer = item.Organizer.Email
		}

		var attendees []CalendarAttendee
		for _, attendee := range item.Attendees {
			if attendee.DisplayName != "" || attendee.Email != "" {
				attendees = append(attendees, CalendarAttendee{
					Name:  attendee.DisplayName,
					Email: attendee.Email,
				})
			}
		}
		event.Attendees = attendees

		if item.Start.DateTime != "" {
			if startTime, err := time.Parse(time.RFC3339, item.Start.DateTime); err == nil {
				event.Start = startTime
			}
		} else if item.Start.Date != "" {
			if startTime, err := time.Parse("2006-01-02", item.Start.Date); err == nil {
				event.Start = startTime
			}
		}

		if item.End.DateTime != "" {
			if endTime, err := time.Parse(time.RFC3339, item.End.DateTime); err == nil {
				event.End = endTime
			}
		} else if item.End.Date != "" {
			if endTime, err := time.Parse("2006-01-02", item.End.Date); err == nil {
				event.End = endTime
			}
		}

		event.IsMeeting = h.isMeeting(event.Title, event.Description, event.Location, event.MeetingLink, event.Attendees)

		events = append(events, event)
	}

	return events, nil
}

func applyCalendarVisibility(calendars []*CalendarSource, preferences map[string]bool) {
	for _, calendar := range calendars {
		if visible, ok := preferences[calendar.ID]; ok {
			calendar.Visible = visible
			continue
		}
		calendar.Visible = defaultCalendarVisible(calendar.Primary, calendar.Selected)
	}
}

func defaultCalendarVisible(primary, selected bool) bool {
	return primary || selected
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (h *CalendarHandler) isMeeting(title, description, location, meetingLink string, attendees []CalendarAttendee) bool {
	if len(attendees) > 1 {
		return true
	}

	meetingKeywords := []string{
		"meeting", "call", "standup", "sync", "review", "interview",
		"discussion", "conference", "session", "catch up", "check in",
		"demo", "presentation", "workshop", "training", "scrum",
		"retrospective", "planning", "1:1", "one-on-one",
	}

	titleLower := strings.ToLower(title)
	for _, keyword := range meetingKeywords {
		if strings.Contains(titleLower, keyword) {
			return true
		}
	}

	meetingLinkPatterns := []string{
		"zoom.us", "teams.microsoft.com", "meet.google.com",
		"webex.com", "gotomeeting.com", "join.me",
		"whereby.com", "discord.gg", "bluejeans.com",
	}

	combinedText := strings.ToLower(description + " " + location + " " + meetingLink)
	for _, pattern := range meetingLinkPatterns {
		if strings.Contains(combinedText, pattern) {
			return true
		}
	}

	return false
}
