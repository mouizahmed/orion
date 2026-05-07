package handlers

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	calendarservice "github.com/mouizahmed/justscribe-backend/internal/calendar"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
)

type CalendarHandler struct {
	connectionRepo repository.IntegrationConnectionRepository
	preferenceRepo repository.CalendarPreferenceRepository
	cacheRepo      repository.CalendarCacheRepository
	syncService    *calendarservice.Service
}

type CalendarEvent struct {
	ID           string             `json:"id"`
	ProviderID   string             `json:"provider_id"`
	ConnectionID string             `json:"connection_id"`
	AccountEmail string             `json:"account_email,omitempty"`
	Title        string             `json:"title"`
	Start        time.Time          `json:"start"`
	End          time.Time          `json:"end"`
	AllDay       bool               `json:"all_day"`
	Location     string             `json:"location,omitempty"`
	Description  string             `json:"description,omitempty"`
	MeetingLink  string             `json:"meeting_link,omitempty"`
	CalendarID   string             `json:"calendar_id,omitempty"`
	CalendarName string             `json:"calendar_name,omitempty"`
	Color        string             `json:"color,omitempty"`
	Organizer    string             `json:"organizer,omitempty"`
	Provider     string             `json:"provider"`
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

type calendarCacheMetadata struct {
	Syncing      bool       `json:"syncing"`
	Stale        bool       `json:"stale"`
	LastSyncedAt *time.Time `json:"last_synced_at,omitempty"`
	LastError    string     `json:"last_error,omitempty"`
}

func NewCalendarHandler(connectionRepo repository.IntegrationConnectionRepository, preferenceRepo repository.CalendarPreferenceRepository, cacheRepo repository.CalendarCacheRepository, syncService *calendarservice.Service) *CalendarHandler {
	return &CalendarHandler{
		connectionRepo: connectionRepo,
		preferenceRepo: preferenceRepo,
		cacheRepo:      cacheRepo,
		syncService:    syncService,
	}
}

func (h *CalendarHandler) GetCalendars(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	calendars, err := h.getCachedCalendars(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch calendars"})
		return
	}
	metadata := h.getCacheMetadata(c.Request.Context(), userID, calendarservice.SyncScopeCalendars)
	if metadata.Stale {
		h.triggerBackgroundSync(userID, calendarservice.SyncScopeCalendars)
	}

	c.JSON(http.StatusOK, gin.H{
		"status":         "success",
		"calendars":      calendars,
		"syncing":        metadata.Syncing,
		"stale":          metadata.Stale,
		"last_synced_at": metadata.LastSyncedAt,
		"last_error":     metadata.LastError,
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

	events, err := h.getCachedUpcomingEvents(c.Request.Context(), userID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch calendar events"})
		return
	}
	metadata := h.getCacheMetadata(c.Request.Context(), userID, calendarservice.SyncScopeEvents)
	if metadata.Stale {
		h.triggerBackgroundSync(userID, calendarservice.SyncScopeEvents)
	}

	c.JSON(http.StatusOK, gin.H{
		"status":         "success",
		"events":         events,
		"syncing":        metadata.Syncing,
		"stale":          metadata.Stale,
		"last_synced_at": metadata.LastSyncedAt,
		"last_error":     metadata.LastError,
	})
}

func (h *CalendarHandler) Sync(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	if h.syncService == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "error": "Calendar sync is unavailable"})
		return
	}

	if c.Query("wait") == "true" {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
		defer cancel()
		if err := h.syncService.SyncUser(ctx, userID, calendarservice.SyncScopeAll); err != nil {
			log.Printf("calendar: manual sync failed for user %s: %v", userID, err)
			c.JSON(http.StatusInternalServerError, gin.H{"status": "error", "error": "Calendar sync failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "success", "syncing": false})
		return
	}

	h.triggerBackgroundSync(userID, calendarservice.SyncScopeAll)
	c.JSON(http.StatusOK, gin.H{"status": "success", "syncing": true})
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

func (h *CalendarHandler) getCachedCalendars(ctx context.Context, userID string) ([]*CalendarSource, error) {
	cached, err := h.cacheRepo.ListCalendarSources(ctx, userID)
	if err != nil {
		return nil, err
	}
	calendars := make([]*CalendarSource, 0, len(cached))
	for _, calendar := range cached {
		calendars = append(calendars, &CalendarSource{
			ID:              calendar.ID,
			ConnectionID:    calendar.ConnectionID,
			AccountEmail:    calendar.AccountEmail,
			Name:            calendar.Name,
			Provider:        calendar.Provider,
			Color:           calendar.Color,
			BackgroundColor: calendar.BackgroundColor,
			ForegroundColor: calendar.ForegroundColor,
			Primary:         calendar.Primary,
			Selected:        calendar.Selected,
			Visible:         calendar.Visible,
			AccessRole:      calendar.AccessRole,
		})
	}
	return calendars, nil
}

func (h *CalendarHandler) getCachedUpcomingEvents(ctx context.Context, userID string, limit int) ([]*CalendarEvent, error) {
	cached, err := h.cacheRepo.ListUpcomingEvents(ctx, userID, time.Now(), limit)
	if err != nil {
		return nil, err
	}
	events := make([]*CalendarEvent, 0, len(cached))
	for _, event := range cached {
		var attendees []CalendarAttendee
		if len(event.AttendeesJSON) > 0 {
			_ = json.Unmarshal(event.AttendeesJSON, &attendees)
		}
		events = append(events, &CalendarEvent{
			ID:           event.ID,
			ProviderID:   event.ProviderID,
			ConnectionID: event.ConnectionID,
			AccountEmail: event.AccountEmail,
			Title:        event.Title,
			Start:        event.Start,
			End:          event.End,
			AllDay:       event.AllDay,
			Location:     event.Location,
			Description:  event.Description,
			MeetingLink:  event.MeetingLink,
			CalendarID:   event.CalendarID,
			CalendarName: event.CalendarName,
			Color:        event.Color,
			Organizer:    event.Organizer,
			Provider:     event.Provider,
			Attendees:    attendees,
		})
	}
	return events, nil
}

func (h *CalendarHandler) getCacheMetadata(ctx context.Context, userID string, scope calendarservice.SyncScope) calendarCacheMetadata {
	metadata := calendarCacheMetadata{Stale: true}
	if h.cacheRepo == nil {
		return metadata
	}

	states, err := h.cacheRepo.ListConnectionSyncStates(ctx, userID)
	if err != nil {
		log.Printf("calendar: failed to load connection sync states: %v", err)
		return metadata
	}
	if len(states) == 0 {
		metadata.Stale = false
		return metadata
	}

	now := time.Now()
	requiredWindowEnd := now.Add(calendarservice.EventWindow)
	metadata.Stale = false
	for _, state := range states {
		if state.Status == "" {
			metadata.Stale = true
			continue
		}
		if state.Status == "syncing" && state.SyncStartedAt != nil && now.Sub(*state.SyncStartedAt) < 2*time.Minute {
			metadata.Syncing = true
		}
		if state.LastError != nil && metadata.LastError == "" {
			metadata.LastError = *state.LastError
		}
		var lastSynced *time.Time
		var ttl time.Duration
		switch scope {
		case calendarservice.SyncScopeCalendars:
			lastSynced = state.CalendarLastSyncedAt
			ttl = calendarservice.CalendarListTTL
		default:
			lastSynced = state.EventsLastSyncedAt
			ttl = calendarservice.EventTTL
			if state.EventsWindowStart == nil || state.EventsWindowEnd == nil || state.EventsWindowStart.After(now) || state.EventsWindowEnd.Before(requiredWindowEnd) {
				metadata.Stale = true
			}
		}
		if lastSynced == nil || now.Sub(*lastSynced) > ttl {
			metadata.Stale = true
		} else if metadata.LastSyncedAt == nil || lastSynced.After(*metadata.LastSyncedAt) {
			metadata.LastSyncedAt = lastSynced
		}
	}
	return metadata
}

func (h *CalendarHandler) SearchEvents(c *gin.Context) {
	userID, err := getUserID(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	query := strings.TrimSpace(c.Query("q"))
	limitStr := c.DefaultQuery("limit", "20")
	limit, err := strconv.Atoi(limitStr)
	if err != nil || limit < 1 || limit > 50 {
		limit = 20
	}

	events, err := h.cacheRepo.SearchEvents(c.Request.Context(), userID, query, limit)
	if err != nil {
		log.Printf("calendar: failed to search events for user %s: %v", userID, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to search events"})
		return
	}

	result := make([]*CalendarEvent, 0, len(events))
	for _, event := range events {
		result = append(result, &CalendarEvent{
			ID:           event.ID,
			ProviderID:   event.ProviderID,
			ConnectionID: event.ConnectionID,
			AccountEmail: event.AccountEmail,
			Title:        event.Title,
			Start:        event.Start,
			End:          event.End,
			AllDay:       event.AllDay,
			CalendarID:   event.CalendarID,
			CalendarName: event.CalendarName,
			Color:        event.Color,
			Organizer:    event.Organizer,
			Provider:     event.Provider,
		})
	}

	c.JSON(http.StatusOK, gin.H{"status": "success", "events": result})
}

func (h *CalendarHandler) triggerBackgroundSync(userID string, scope calendarservice.SyncScope) {
	if h.syncService == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := h.syncService.SyncUser(ctx, userID, scope); err != nil {
			log.Printf("calendar: background sync failed for user %s: %v", userID, err)
		}
	}()
}
