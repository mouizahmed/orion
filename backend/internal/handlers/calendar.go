package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"golang.org/x/oauth2"
)

type CalendarHandler struct {
	oauthTokenRepo repository.OAuthTokenRepository
}

type CalendarEvent struct {
	ID           string             `json:"id"`
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
	Name            string `json:"name"`
	Provider        string `json:"provider"`
	Color           string `json:"color,omitempty"`
	BackgroundColor string `json:"background_color,omitempty"`
	ForegroundColor string `json:"foreground_color,omitempty"`
	Primary         bool   `json:"primary"`
	Selected        bool   `json:"selected"`
	AccessRole      string `json:"access_role,omitempty"`
}

func NewCalendarHandler(oauthTokenRepo repository.OAuthTokenRepository) *CalendarHandler {
	return &CalendarHandler{
		oauthTokenRepo: oauthTokenRepo,
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

func (h *CalendarHandler) getCalendars(userID string) ([]*CalendarSource, error) {
	var allCalendars []*CalendarSource

	tokens, err := h.oauthTokenRepo.GetByUser(userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get OAuth tokens: %w", err)
	}

	if len(tokens) == 0 {
		return []*CalendarSource{}, nil
	}

	for _, token := range tokens {
		if token.ExpiresAt != nil && time.Now().After(*token.ExpiresAt) {
			err := h.refreshTokenIfNeeded(userID, token.Provider)
			if err != nil {
				continue
			}
			refreshedToken, err := h.oauthTokenRepo.GetByUserAndProvider(userID, token.Provider)
			if err != nil {
				continue
			}
			token = refreshedToken
		}

		var calendars []*CalendarSource
		switch token.Provider {
		case "google":
			calendars, err = h.getGoogleCalendars(token)
		default:
			continue
		}

		if err != nil {
			continue
		}

		allCalendars = append(allCalendars, calendars...)
	}

	return allCalendars, nil
}

func (h *CalendarHandler) getUpcomingEvents(userID string, limit int) ([]*CalendarEvent, error) {
	var allEvents []*CalendarEvent

	tokens, err := h.oauthTokenRepo.GetByUser(userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get OAuth tokens: %w", err)
	}

	if len(tokens) == 0 {
		return []*CalendarEvent{}, nil
	}

	for _, token := range tokens {
		if token.ExpiresAt != nil && time.Now().After(*token.ExpiresAt) {
			err := h.refreshTokenIfNeeded(userID, token.Provider)
			if err != nil {
				continue
			}
			refreshedToken, err := h.oauthTokenRepo.GetByUserAndProvider(userID, token.Provider)
			if err != nil {
				continue
			}
			token = refreshedToken
		}

		var events []*CalendarEvent
		switch token.Provider {
		case "google":
			events, err = h.getGoogleCalendarEvents(token, limit)
		case "microsoft":
			events, err = h.getMicrosoftCalendarEvents(token, limit)
		default:
			continue
		}

		if err != nil {
			continue
		}

		allEvents = append(allEvents, events...)
	}

	// Sort events by start time
	for i := 0; i < len(allEvents)-1; i++ {
		for j := 0; j < len(allEvents)-i-1; j++ {
			if allEvents[j].Start.After(allEvents[j+1].Start) {
				allEvents[j], allEvents[j+1] = allEvents[j+1], allEvents[j]
			}
		}
	}

	if limit > 0 && len(allEvents) > limit {
		allEvents = allEvents[:limit]
	}

	return allEvents, nil
}

func (h *CalendarHandler) refreshTokenIfNeeded(userID, provider string) error {
	token, err := h.oauthTokenRepo.GetByUserAndProvider(userID, provider)
	if err != nil {
		return fmt.Errorf("failed to get token: %w", err)
	}

	if token.RefreshToken == nil {
		return fmt.Errorf("no refresh token available for %s", provider)
	}

	var refreshURL string
	var clientID, clientSecret string

	switch provider {
	case "google":
		refreshURL = "https://oauth2.googleapis.com/token"
		clientID = os.Getenv("GOOGLE_CLIENT_ID")
		clientSecret = os.Getenv("GOOGLE_CLIENT_SECRET")
	case "microsoft":
		refreshURL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
		clientID = os.Getenv("MICROSOFT_CLIENT_ID")
		clientSecret = os.Getenv("MICROSOFT_CLIENT_SECRET")
	default:
		return fmt.Errorf("unsupported provider: %s", provider)
	}

	oauthToken := &oauth2.Token{
		AccessToken:  token.AccessToken,
		RefreshToken: *token.RefreshToken,
		TokenType:    "Bearer",
	}
	if token.ExpiresAt != nil {
		oauthToken.Expiry = *token.ExpiresAt
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
		return fmt.Errorf("failed to refresh token: %w", err)
	}

	updates := &models.UpdateOAuthTokenRequest{
		AccessToken: &newToken.AccessToken,
	}

	if newToken.RefreshToken != "" {
		updates.RefreshToken = &newToken.RefreshToken
	}

	if !newToken.Expiry.IsZero() {
		updates.ExpiresAt = &newToken.Expiry
	}

	err = h.oauthTokenRepo.Update(userID, provider, updates)
	if err != nil {
		return fmt.Errorf("failed to update token: %w", err)
	}

	return nil
}

func (h *CalendarHandler) getGoogleCalendars(token *models.OAuthToken) ([]*CalendarSource, error) {
	client := &http.Client{}
	req, err := http.NewRequest("GET", "https://www.googleapis.com/calendar/v3/users/me/calendarList", nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token.AccessToken)

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
			Name:            item.Summary,
			Provider:        "google",
			Color:           item.BackgroundColor,
			BackgroundColor: item.BackgroundColor,
			ForegroundColor: item.ForegroundColor,
			Primary:         item.Primary,
			Selected:        item.Selected,
			AccessRole:      item.AccessRole,
		})
	}

	return calendars, nil
}

func (h *CalendarHandler) getGoogleCalendarEvents(token *models.OAuthToken, limit int) ([]*CalendarEvent, error) {
	calendars, err := h.getGoogleCalendars(token)
	if err != nil {
		return nil, err
	}

	var allEvents []*CalendarEvent
	for _, calendar := range calendars {
		if !calendar.Selected && !calendar.Primary {
			continue
		}

		events, err := h.getGoogleCalendarEventsForCalendar(token, calendar, limit)
		if err != nil {
			continue
		}
		allEvents = append(allEvents, events...)
	}

	return allEvents, nil
}

func (h *CalendarHandler) getGoogleCalendarEventsForCalendar(token *models.OAuthToken, calendar *CalendarSource, limit int) ([]*CalendarEvent, error) {
	client := &http.Client{}

	timeMin := url.QueryEscape(time.Now().Format(time.RFC3339))
	calendarID := url.PathEscape(calendar.ID)
	requestURL := fmt.Sprintf("https://www.googleapis.com/calendar/v3/calendars/%s/events?timeMin=%s&orderBy=startTime&singleEvents=true&maxResults=%d", calendarID, timeMin, limit)

	req, err := http.NewRequest("GET", requestURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token.AccessToken)

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
		event := &CalendarEvent{
			ID:           item.ID,
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

func (h *CalendarHandler) getMicrosoftCalendarEvents(token *models.OAuthToken, limit int) ([]*CalendarEvent, error) {
	client := &http.Client{}

	startTime := time.Now().Format(time.RFC3339)
	url := fmt.Sprintf("https://graph.microsoft.com/v1.0/me/events?$filter=start/dateTime ge '%s'&$orderby=start/dateTime&$top=%d", startTime, limit)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token.AccessToken)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Microsoft Graph API error: %s", string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var microsoftResponse struct {
		Value []struct {
			ID      string `json:"id"`
			Subject string `json:"subject"`
			Start   struct {
				DateTime string `json:"dateTime"`
				TimeZone string `json:"timeZone"`
			} `json:"start"`
			End struct {
				DateTime string `json:"dateTime"`
				TimeZone string `json:"timeZone"`
			} `json:"end"`
			Location struct {
				DisplayName string `json:"displayName"`
			} `json:"location"`
			BodyPreview string `json:"bodyPreview"`
			Organizer   struct {
				EmailAddress struct {
					Name    string `json:"name"`
					Address string `json:"address"`
				} `json:"emailAddress"`
			} `json:"organizer"`
		} `json:"value"`
	}

	if err := json.Unmarshal(body, &microsoftResponse); err != nil {
		return nil, err
	}

	var events []*CalendarEvent
	for _, item := range microsoftResponse.Value {
		event := &CalendarEvent{
			ID:           item.ID,
			Title:        item.Subject,
			Location:     item.Location.DisplayName,
			Description:  item.BodyPreview,
			CalendarID:   "microsoft",
			CalendarName: "Microsoft Calendar",
			Color:        "#38bdf8",
			Provider:     "microsoft",
		}

		if item.Organizer.EmailAddress.Name != "" {
			event.Organizer = item.Organizer.EmailAddress.Name
		} else if item.Organizer.EmailAddress.Address != "" {
			event.Organizer = item.Organizer.EmailAddress.Address
		}

		if startTime, err := time.Parse(time.RFC3339, item.Start.DateTime); err == nil {
			event.Start = startTime
		}

		if endTime, err := time.Parse(time.RFC3339, item.End.DateTime); err == nil {
			event.End = endTime
		}

		event.IsMeeting = h.isMeeting(event.Title, event.Description, event.Location, event.MeetingLink, event.Attendees)

		events = append(events, event)
	}

	return events, nil
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
