package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/lib/pq"
	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type CalendarCacheRepository interface {
	ListCalendarSources(ctx context.Context, userID string) ([]*models.CachedCalendarSource, error)
	ListUpcomingEvents(ctx context.Context, userID string, now time.Time, limit int) ([]*models.CachedCalendarEvent, error)
	GetEventByProviderID(ctx context.Context, userID, connectionID, calendarID, providerEventID string) (*models.CachedCalendarEvent, error)
	SearchEvents(ctx context.Context, userID, query string, limit int, excludeLinkedExceptNoteID *string) ([]*models.CachedCalendarEvent, error)
	ListConnectionSyncStates(ctx context.Context, userID string) ([]*models.CalendarSyncState, error)
	UpsertCalendarSources(ctx context.Context, userID string, connection *models.IntegrationConnection, sources []*models.CachedCalendarSource) error
	UpsertCalendarEvents(ctx context.Context, userID string, connection *models.IntegrationConnection, events []*models.CachedCalendarEvent) error
	DeleteEventsNotSeen(ctx context.Context, userID, connectionID, calendarID string, windowStart, windowEnd time.Time, seenProviderIDs []string) error
	SaveCalendarSyncToken(ctx context.Context, userID, connectionID, calendarID, token string, windowStart, windowEnd time.Time) error
	ClearCalendarSyncToken(ctx context.Context, userID, connectionID, calendarID string) error
	DeleteCalendarEventsByProviderID(ctx context.Context, userID, connectionID, calendarID string, providerIDs []string) error
	MarkSyncStarted(ctx context.Context, userID, connectionID string) error
	MarkSyncSuccess(ctx context.Context, userID, connectionID, scope string, windowStart, windowEnd *time.Time) error
	MarkSyncError(ctx context.Context, userID, connectionID string, syncErr error) error
}

type calendarCacheRepository struct {
	db *database.DB
}

func NewCalendarCacheRepository(db *database.DB) CalendarCacheRepository {
	return &calendarCacheRepository{db: db}
}

func (r *calendarCacheRepository) ListCalendarSources(ctx context.Context, userID string) ([]*models.CachedCalendarSource, error) {
	query := `
		SELECT s.calendar_id, s.connection_id::text, COALESCE(s.account_email, ''),
			s.name, s.provider, COALESCE(s.color, ''), COALESCE(s.background_color, ''),
			COALESCE(s.foreground_color, ''), s.primary_calendar, s.selected,
			COALESCE(p.visible, s.primary_calendar OR s.selected) AS visible,
			COALESCE(s.access_role, ''), s.synced_at,
			COALESCE(s.sync_token, ''), s.sync_window_start, s.sync_window_end
		FROM calendar_sources s
		JOIN integration_connections c
			ON c.user_id = s.user_id AND c.id = s.connection_id AND c.status = 'active'
		LEFT JOIN calendar_preferences p
			ON p.user_id = s.user_id AND p.connection_id = s.connection_id AND p.calendar_id = s.calendar_id
		WHERE s.user_id = $1
		ORDER BY s.provider, s.account_email, s.primary_calendar DESC, s.name
	`
	rows, err := r.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var calendars []*models.CachedCalendarSource
	for rows.Next() {
		var calendar models.CachedCalendarSource
		if err := rows.Scan(
			&calendar.ID, &calendar.ConnectionID, &calendar.AccountEmail,
			&calendar.Name, &calendar.Provider, &calendar.Color,
			&calendar.BackgroundColor, &calendar.ForegroundColor,
			&calendar.Primary, &calendar.Selected, &calendar.Visible,
			&calendar.AccessRole, &calendar.SyncedAt,
			&calendar.SyncToken, &calendar.SyncWindowStart, &calendar.SyncWindowEnd,
		); err != nil {
			return nil, err
		}
		calendars = append(calendars, &calendar)
	}
	return calendars, rows.Err()
}

func (r *calendarCacheRepository) ListUpcomingEvents(ctx context.Context, userID string, now time.Time, limit int) ([]*models.CachedCalendarEvent, error) {
	query := `
		SELECT e.id::text, e.provider, e.connection_id::text, e.calendar_id, e.provider_event_id,
			COALESCE(e.account_email, ''), e.title, e.start_at, e.end_at, COALESCE(e.all_day, false),
			COALESCE(e.location, ''), COALESCE(e.description, ''), COALESCE(e.meeting_link, ''),
			COALESCE(e.event_link, ''), COALESCE(e.calendar_name, s.name), COALESCE(e.color, s.color, ''),
			COALESCE(e.organizer, ''), e.attendees
		FROM calendar_events e
		JOIN calendar_sources s
			ON s.user_id = e.user_id AND s.connection_id = e.connection_id AND s.calendar_id = e.calendar_id
		JOIN integration_connections c
			ON c.user_id = e.user_id AND c.id = e.connection_id AND c.status = 'active'
		LEFT JOIN calendar_preferences p
			ON p.user_id = e.user_id AND p.connection_id = e.connection_id AND p.calendar_id = e.calendar_id
		WHERE e.user_id = $1
			AND e.end_at >= $2
			AND COALESCE(p.visible, s.primary_calendar OR s.selected) = true
		ORDER BY e.start_at ASC
		LIMIT $3
	`
	rows, err := r.db.QueryContext(ctx, query, userID, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []*models.CachedCalendarEvent{}
	for rows.Next() {
		var event models.CachedCalendarEvent
		if err := rows.Scan(
			&event.ID, &event.Provider, &event.ConnectionID, &event.CalendarID, &event.ProviderID,
			&event.AccountEmail, &event.Title, &event.Start, &event.End, &event.AllDay,
			&event.Location, &event.Description, &event.MeetingLink,
			&event.EventLink, &event.CalendarName, &event.Color, &event.Organizer,
			&event.AttendeesJSON,
		); err != nil {
			return nil, err
		}
		events = append(events, &event)
	}
	return events, rows.Err()
}

func (r *calendarCacheRepository) GetEventByProviderID(ctx context.Context, userID, connectionID, calendarID, providerEventID string) (*models.CachedCalendarEvent, error) {
	query := `
		SELECT e.id::text, e.provider, e.connection_id::text, e.calendar_id, e.provider_event_id,
			COALESCE(e.account_email, ''), e.title, e.start_at, e.end_at, COALESCE(e.all_day, false),
			COALESCE(e.location, ''), COALESCE(e.description, ''), COALESCE(e.meeting_link, ''),
			COALESCE(e.event_link, ''), COALESCE(e.calendar_name, s.name), COALESCE(e.color, s.color, ''),
			COALESCE(e.organizer, ''), e.attendees
		FROM calendar_events e
		JOIN calendar_sources s
			ON s.user_id = e.user_id AND s.connection_id = e.connection_id AND s.calendar_id = e.calendar_id
		JOIN integration_connections c
			ON c.user_id = e.user_id AND c.id = e.connection_id AND c.status = 'active'
		WHERE e.user_id = $1
			AND e.connection_id = $2
			AND e.calendar_id = $3
			AND e.provider_event_id = $4
		LIMIT 1
	`

	var event models.CachedCalendarEvent
	if err := r.db.QueryRowContext(ctx, query, userID, connectionID, calendarID, providerEventID).Scan(
		&event.ID, &event.Provider, &event.ConnectionID, &event.CalendarID, &event.ProviderID,
		&event.AccountEmail, &event.Title, &event.Start, &event.End, &event.AllDay,
		&event.Location, &event.Description, &event.MeetingLink,
		&event.EventLink, &event.CalendarName, &event.Color, &event.Organizer,
		&event.AttendeesJSON,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &event, nil
}

func (r *calendarCacheRepository) SearchEvents(ctx context.Context, userID, query string, limit int, excludeLinkedExceptNoteID *string) ([]*models.CachedCalendarEvent, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	pattern := "%" + strings.ReplaceAll(strings.TrimSpace(query), "%", "\\%") + "%"
	sqlQuery := `
		SELECT e.id::text, e.provider, e.connection_id::text, e.calendar_id, e.provider_event_id,
			COALESCE(e.account_email, ''), e.title, e.start_at, e.end_at, COALESCE(e.all_day, false),
			COALESCE(e.location, ''), COALESCE(e.description, ''), COALESCE(e.meeting_link, ''),
			COALESCE(e.event_link, ''), COALESCE(e.calendar_name, s.name), COALESCE(e.color, s.color, ''),
			COALESCE(e.organizer, ''), e.attendees
		FROM calendar_events e
		JOIN calendar_sources s
			ON s.user_id = e.user_id AND s.connection_id = e.connection_id AND s.calendar_id = e.calendar_id
		JOIN integration_connections c
			ON c.user_id = e.user_id AND c.id = e.connection_id AND c.status = 'active'
		LEFT JOIN calendar_preferences p
			ON p.user_id = e.user_id AND p.connection_id = e.connection_id AND p.calendar_id = e.calendar_id
		WHERE e.user_id = $1
			AND COALESCE(p.visible, s.primary_calendar OR s.selected) = true
	`
	args := []interface{}{userID}
	argPos := 2
	if strings.TrimSpace(query) != "" {
		sqlQuery += fmt.Sprintf(" AND e.title ILIKE $%d", argPos)
		args = append(args, pattern)
		argPos++
	}
	// Exclude events already linked to a note, except for the note currently being edited
	if excludeLinkedExceptNoteID != nil && *excludeLinkedExceptNoteID != "" {
		sqlQuery += fmt.Sprintf(`
			AND NOT EXISTS (
				SELECT 1 FROM notes n
				WHERE n.calendar_event_id = e.id
				  AND n.deleted_at IS NULL
				  AND n.user_id = e.user_id
				  AND n.id != $%d
			)`, argPos)
		args = append(args, *excludeLinkedExceptNoteID)
		argPos++
	} else {
		sqlQuery += `
			AND NOT EXISTS (
				SELECT 1 FROM notes n
				WHERE n.calendar_event_id = e.id
				  AND n.deleted_at IS NULL
				  AND n.user_id = e.user_id
			)`
	}
	sqlQuery += fmt.Sprintf(`
		ORDER BY ABS(EXTRACT(EPOCH FROM (e.start_at - NOW()))) ASC
		LIMIT $%d
	`, argPos)
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx, sqlQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []*models.CachedCalendarEvent{}
	for rows.Next() {
		var event models.CachedCalendarEvent
		if err := rows.Scan(
			&event.ID, &event.Provider, &event.ConnectionID, &event.CalendarID, &event.ProviderID,
			&event.AccountEmail, &event.Title, &event.Start, &event.End, &event.AllDay,
			&event.Location, &event.Description, &event.MeetingLink,
			&event.EventLink, &event.CalendarName, &event.Color, &event.Organizer,
			&event.AttendeesJSON,
		); err != nil {
			return nil, err
		}
		events = append(events, &event)
	}
	return events, rows.Err()
}

func (r *calendarCacheRepository) ListConnectionSyncStates(ctx context.Context, userID string) ([]*models.CalendarSyncState, error) {
	query := `
		SELECT c.id,
			ss.status, ss.calendar_last_synced_at, ss.events_last_synced_at,
			ss.sync_started_at, ss.last_error, ss.events_window_start, ss.events_window_end,
			ss.updated_at
		FROM integration_connections c
		LEFT JOIN calendar_sync_state ss
			ON ss.user_id = c.user_id AND ss.connection_id = c.id
		WHERE c.user_id = $1
		  AND c.status = 'active'
		  AND c.provider IN ('google', 'microsoft')
	`
	rows, err := r.db.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var states []*models.CalendarSyncState
	for rows.Next() {
		var connectionID string
		var status sql.NullString
		var calLastSynced, evtLastSynced, syncStarted *time.Time
		var lastError *string
		var evtWindowStart, evtWindowEnd *time.Time
		var updatedAt sql.NullTime

		if err := rows.Scan(
			&connectionID, &status,
			&calLastSynced, &evtLastSynced, &syncStarted,
			&lastError, &evtWindowStart, &evtWindowEnd, &updatedAt,
		); err != nil {
			return nil, err
		}

		state := &models.CalendarSyncState{
			ConnectionID:         connectionID,
			Status:               status.String,
			CalendarLastSyncedAt: calLastSynced,
			EventsLastSyncedAt:   evtLastSynced,
			SyncStartedAt:        syncStarted,
			LastError:            lastError,
			EventsWindowStart:    evtWindowStart,
			EventsWindowEnd:      evtWindowEnd,
		}
		if updatedAt.Valid {
			state.UpdatedAt = updatedAt.Time
		}
		states = append(states, state)
	}
	return states, rows.Err()
}

func (r *calendarCacheRepository) UpsertCalendarSources(ctx context.Context, userID string, connection *models.IntegrationConnection, sources []*models.CachedCalendarSource) error {
	if len(sources) == 0 {
		return nil
	}

	const nParams = 12
	placeholders := make([]string, len(sources))
	args := make([]interface{}, 0, len(sources)*nParams)
	for i, source := range sources {
		b := i * nParams
		placeholders[i] = fmt.Sprintf(
			"($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,now(),now(),now())",
			b+1, b+2, b+3, b+4, b+5, b+6, b+7, b+8, b+9, b+10, b+11, b+12,
		)
		args = append(args,
			userID, connection.ID, source.ID, source.Provider,
			nullString(source.AccountEmail), source.Name,
			nullString(source.Color), nullString(source.BackgroundColor), nullString(source.ForegroundColor),
			source.Primary, source.Selected, nullString(source.AccessRole),
		)
	}

	query := `INSERT INTO calendar_sources (
		user_id, connection_id, calendar_id, provider, account_email, name,
		color, background_color, foreground_color, primary_calendar, selected,
		access_role, synced_at, created_at, updated_at
	) VALUES ` + strings.Join(placeholders, ",") + `
	ON CONFLICT (user_id, connection_id, calendar_id) DO UPDATE SET
		provider = EXCLUDED.provider, account_email = EXCLUDED.account_email,
		name = EXCLUDED.name, color = EXCLUDED.color,
		background_color = EXCLUDED.background_color, foreground_color = EXCLUDED.foreground_color,
		primary_calendar = EXCLUDED.primary_calendar, selected = EXCLUDED.selected,
		access_role = EXCLUDED.access_role, synced_at = EXCLUDED.synced_at,
		updated_at = EXCLUDED.updated_at`

	_, err := r.db.ExecContext(ctx, query, args...)
	return err
}

func (r *calendarCacheRepository) UpsertCalendarEvents(ctx context.Context, userID string, connection *models.IntegrationConnection, events []*models.CachedCalendarEvent) error {
	const chunkSize = 500
	for i := 0; i < len(events); i += chunkSize {
		end := i + chunkSize
		if end > len(events) {
			end = len(events)
		}
		if err := r.upsertCalendarEventsChunk(ctx, userID, connection, events[i:end]); err != nil {
			return err
		}
	}
	return nil
}

func (r *calendarCacheRepository) upsertCalendarEventsChunk(ctx context.Context, userID string, connection *models.IntegrationConnection, events []*models.CachedCalendarEvent) error {
	if len(events) == 0 {
		return nil
	}

	const nParams = 18
	placeholders := make([]string, len(events))
	args := make([]interface{}, 0, len(events)*nParams)
	for i, event := range events {
		b := i * nParams
		placeholders[i] = fmt.Sprintf(
			"($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,now(),now(),now())",
			b+1, b+2, b+3, b+4, b+5, b+6, b+7, b+8, b+9, b+10,
			b+11, b+12, b+13, b+14, b+15, b+16, b+17, b+18,
		)
		attendees := event.AttendeesJSON
		if len(attendees) == 0 {
			attendees = []byte("[]")
		}
		args = append(args,
			userID, connection.ID, event.CalendarID, event.ProviderID, event.Provider,
			nullString(event.AccountEmail), event.Title, event.Start, event.End, event.AllDay,
			nullString(event.Location), nullString(event.Description), nullString(event.MeetingLink),
			nullString(event.EventLink), nullString(event.CalendarName), nullString(event.Color), nullString(event.Organizer),
			attendees,
		)
	}

	query := `INSERT INTO calendar_events (
		user_id, connection_id, calendar_id, provider_event_id, provider, account_email,
		title, start_at, end_at, all_day, location, description, meeting_link, event_link, calendar_name,
		color, organizer, attendees, synced_at, created_at, updated_at
	) VALUES ` + strings.Join(placeholders, ",") + `
	ON CONFLICT (user_id, connection_id, calendar_id, provider_event_id) DO UPDATE SET
		provider = EXCLUDED.provider, account_email = EXCLUDED.account_email,
		title = EXCLUDED.title, start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at,
		all_day = EXCLUDED.all_day,
		location = EXCLUDED.location, description = EXCLUDED.description,
		meeting_link = EXCLUDED.meeting_link, event_link = EXCLUDED.event_link, calendar_name = EXCLUDED.calendar_name,
		color = EXCLUDED.color, organizer = EXCLUDED.organizer,
		attendees = EXCLUDED.attendees,
		synced_at = EXCLUDED.synced_at, updated_at = EXCLUDED.updated_at`

	_, err := r.db.ExecContext(ctx, query, args...)
	return err
}

func (r *calendarCacheRepository) DeleteEventsNotSeen(ctx context.Context, userID, connectionID, calendarID string, windowStart, windowEnd time.Time, seenProviderIDs []string) error {
	args := []interface{}{userID, connectionID, calendarID, windowStart, windowEnd}
	query := `
		DELETE FROM calendar_events
		WHERE user_id = $1 AND connection_id = $2 AND calendar_id = $3
			AND start_at < $5 AND end_at > $4
	`
	if len(seenProviderIDs) > 0 {
		placeholders := make([]string, 0, len(seenProviderIDs))
		for _, id := range seenProviderIDs {
			args = append(args, id)
			placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
		}
		query += " AND provider_event_id NOT IN (" + strings.Join(placeholders, ",") + ")"
	}
	_, err := r.db.ExecContext(ctx, query, args...)
	return err
}

func (r *calendarCacheRepository) SaveCalendarSyncToken(ctx context.Context, userID, connectionID, calendarID, token string, windowStart, windowEnd time.Time) error {
	query := `
		UPDATE calendar_sources
		SET sync_token = $4, sync_window_start = $5, sync_window_end = $6, updated_at = now()
		WHERE user_id = $1 AND connection_id = $2 AND calendar_id = $3
	`
	_, err := r.db.ExecContext(ctx, query, userID, connectionID, calendarID, token, windowStart, windowEnd)
	return err
}

func (r *calendarCacheRepository) ClearCalendarSyncToken(ctx context.Context, userID, connectionID, calendarID string) error {
	query := `
		UPDATE calendar_sources
		SET sync_token = NULL, sync_window_start = NULL, sync_window_end = NULL, updated_at = now()
		WHERE user_id = $1 AND connection_id = $2 AND calendar_id = $3
	`
	_, err := r.db.ExecContext(ctx, query, userID, connectionID, calendarID)
	return err
}

func (r *calendarCacheRepository) DeleteCalendarEventsByProviderID(ctx context.Context, userID, connectionID, calendarID string, providerIDs []string) error {
	if len(providerIDs) == 0 {
		return nil
	}
	query := `
		DELETE FROM calendar_events
		WHERE user_id = $1 AND connection_id = $2 AND calendar_id = $3
			AND provider_event_id = ANY($4)
	`
	_, err := r.db.ExecContext(ctx, query, userID, connectionID, calendarID, pq.Array(providerIDs))
	return err
}

func (r *calendarCacheRepository) MarkSyncStarted(ctx context.Context, userID, connectionID string) error {
	query := `
		INSERT INTO calendar_sync_state (user_id, connection_id, status, sync_started_at, created_at, updated_at)
		VALUES ($1, $2, 'syncing', now(), now(), now())
		ON CONFLICT (user_id, connection_id)
		DO UPDATE SET status = 'syncing', sync_started_at = now(), updated_at = now()
	`
	_, err := r.db.ExecContext(ctx, query, userID, connectionID)
	return err
}

func (r *calendarCacheRepository) MarkSyncSuccess(ctx context.Context, userID, connectionID, scope string, windowStart, windowEnd *time.Time) error {
	setParts := []string{"status = 'success'", "last_error = NULL", "updated_at = now()"}
	args := []interface{}{userID, connectionID}
	if scope == "all" || scope == "calendars" {
		setParts = append(setParts, "calendar_last_synced_at = now()")
	}
	if scope == "all" || scope == "events" {
		setParts = append(setParts, "events_last_synced_at = now()")
		if windowStart != nil && windowEnd != nil {
			args = append(args, *windowStart, *windowEnd)
			setParts = append(setParts, fmt.Sprintf("events_window_start = $%d", len(args)-1))
			setParts = append(setParts, fmt.Sprintf("events_window_end = $%d", len(args)))
		}
	}
	query := `
		INSERT INTO calendar_sync_state (user_id, connection_id, status, created_at, updated_at)
		VALUES ($1, $2, 'success', now(), now())
		ON CONFLICT (user_id, connection_id)
		DO UPDATE SET ` + strings.Join(setParts, ", ")
	_, err := r.db.ExecContext(ctx, query, args...)
	return err
}

func (r *calendarCacheRepository) MarkSyncError(ctx context.Context, userID, connectionID string, syncErr error) error {
	message := ""
	if syncErr != nil {
		message = syncErr.Error()
		if len(message) > 1000 {
			message = message[:1000]
		}
	}
	query := `
		INSERT INTO calendar_sync_state (user_id, connection_id, status, last_error, created_at, updated_at)
		VALUES ($1, $2, 'error', $3, now(), now())
		ON CONFLICT (user_id, connection_id)
		DO UPDATE SET status = 'error', last_error = EXCLUDED.last_error, updated_at = now()
	`
	_, err := r.db.ExecContext(ctx, query, userID, connectionID, message)
	return err
}

func nullString(value string) sql.NullString {
	return sql.NullString{String: value, Valid: value != ""}
}
