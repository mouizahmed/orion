package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

var ErrCalendarSyncInProgress = errors.New("calendar sync already in progress")

type CalendarCacheRepository interface {
	ListCalendarSources(ctx context.Context, userID string) ([]*models.CachedCalendarSource, error)
	ListUpcomingEvents(ctx context.Context, userID string, now time.Time, limit int) ([]*models.CachedCalendarEvent, error)
	GetEventByProviderID(ctx context.Context, userID, connectionID, calendarID, providerEventID string) (*models.CachedCalendarEvent, error)
	SearchEvents(ctx context.Context, userID, query string, limit int, excludeLinkedExceptNoteID *string) ([]*models.CachedCalendarEvent, error)
	ListConnectionSyncStates(ctx context.Context, userID string) ([]*models.CalendarSyncState, error)
	ClearCalendarSyncToken(ctx context.Context, userID, connectionID, calendarID string) error
	MarkSyncStarted(ctx context.Context, userID, connectionID, scope string) error
	MarkSyncSuccess(ctx context.Context, userID, connectionID, scope string, windowStart, windowEnd *time.Time) error
	MarkSyncPartial(ctx context.Context, userID, connectionID, scope string, syncErr error) error
	MarkSyncError(ctx context.Context, userID, connectionID, scope string, syncErr error) error
	ReconcileCalendarSources(ctx context.Context, userID string, connection *models.IntegrationConnection, sources []*models.CachedCalendarSource) ([]string, error)
	ApplyCalendarEventSync(ctx context.Context, userID string, connection *models.IntegrationConnection, calendarID string, batch models.CalendarEventSyncBatch) ([]string, error)
	DeleteEventsBefore(ctx context.Context, userID, connectionID string, cutoff time.Time) ([]string, error)
	AcquireSyncLock(ctx context.Context, userID, connectionID string) (func(), error)
}

type calendarCacheRepository struct {
	db *database.DB
}

func NewCalendarCacheRepository(db *database.DB) CalendarCacheRepository {
	return &calendarCacheRepository{db: db}
}

func (r *calendarCacheRepository) ListCalendarSources(ctx context.Context, userID string) ([]*models.CachedCalendarSource, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
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
	rows, err := tx.QueryContext(ctx, query, userID)
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
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return calendars, tx.Commit()
}

func (r *calendarCacheRepository) ListUpcomingEvents(ctx context.Context, userID string, now time.Time, limit int) ([]*models.CachedCalendarEvent, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	query := `
		SELECT e.id::text, e.provider, e.connection_id::text, e.calendar_id, e.provider_event_id,
			COALESCE(e.account_email, ''), e.title, e.start_at, e.end_at, COALESCE(e.all_day, false),
			COALESCE(e.location, ''), COALESCE(e.description, ''), COALESCE(e.meeting_link, ''),
			COALESCE(e.event_link, ''), COALESCE(e.calendar_name, s.name), COALESCE(e.color, s.color, ''),
			COALESCE(e.organizer_name, ''), COALESCE(e.organizer_email, ''), e.attendees
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
	rows, err := tx.QueryContext(ctx, query, userID, now, limit)
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
			&event.EventLink, &event.CalendarName, &event.Color, &event.OrganizerName, &event.OrganizerEmail,
			&event.AttendeesJSON,
		); err != nil {
			return nil, err
		}
		events = append(events, &event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return events, tx.Commit()
}

func (r *calendarCacheRepository) GetEventByProviderID(ctx context.Context, userID, connectionID, calendarID, providerEventID string) (*models.CachedCalendarEvent, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	query := `
		SELECT e.id::text, e.provider, e.connection_id::text, e.calendar_id, e.provider_event_id,
			COALESCE(e.account_email, ''), e.title, e.start_at, e.end_at, COALESCE(e.all_day, false),
			COALESCE(e.location, ''), COALESCE(e.description, ''), COALESCE(e.meeting_link, ''),
			COALESCE(e.event_link, ''), COALESCE(e.calendar_name, s.name), COALESCE(e.color, s.color, ''),
			COALESCE(e.organizer_name, ''), COALESCE(e.organizer_email, ''), e.attendees
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
	if err := tx.QueryRowContext(ctx, query, userID, connectionID, calendarID, providerEventID).Scan(
		&event.ID, &event.Provider, &event.ConnectionID, &event.CalendarID, &event.ProviderID,
		&event.AccountEmail, &event.Title, &event.Start, &event.End, &event.AllDay,
		&event.Location, &event.Description, &event.MeetingLink,
		&event.EventLink, &event.CalendarName, &event.Color, &event.OrganizerName, &event.OrganizerEmail,
		&event.AttendeesJSON,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &event, tx.Commit()
}

func (r *calendarCacheRepository) SearchEvents(ctx context.Context, userID, query string, limit int, excludeLinkedExceptNoteID *string) ([]*models.CachedCalendarEvent, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	pattern := "%" + strings.ReplaceAll(strings.TrimSpace(query), "%", "\\%") + "%"
	sqlQuery := `
		SELECT e.id::text, e.provider, e.connection_id::text, e.calendar_id, e.provider_event_id,
			COALESCE(e.account_email, ''), e.title, e.start_at, e.end_at, COALESCE(e.all_day, false),
			COALESCE(e.location, ''), COALESCE(e.description, ''), COALESCE(e.meeting_link, ''),
			COALESCE(e.event_link, ''), COALESCE(e.calendar_name, s.name), COALESCE(e.color, s.color, ''),
			COALESCE(e.organizer_name, ''), COALESCE(e.organizer_email, ''), e.attendees
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

	rows, err := tx.QueryContext(ctx, sqlQuery, args...)
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
			&event.EventLink, &event.CalendarName, &event.Color, &event.OrganizerName, &event.OrganizerEmail,
			&event.AttendeesJSON,
		); err != nil {
			return nil, err
		}
		events = append(events, &event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return events, tx.Commit()
}

func (r *calendarCacheRepository) ListConnectionSyncStates(ctx context.Context, userID string) ([]*models.CalendarSyncState, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	query := `
		SELECT c.id,
			ss.calendar_status, ss.events_status,
			ss.calendar_last_synced_at, ss.events_last_synced_at,
			ss.calendar_sync_started_at, ss.events_sync_started_at,
			ss.calendar_last_error, ss.events_last_error,
			ss.events_window_start, ss.events_window_end,
			ss.updated_at
		FROM integration_connections c
		LEFT JOIN calendar_sync_state ss
			ON ss.user_id = c.user_id AND ss.connection_id = c.id
		WHERE c.user_id = $1
		  AND c.status = 'active'
		  AND c.provider IN ('google', 'microsoft')
	`
	rows, err := tx.QueryContext(ctx, query, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var states []*models.CalendarSyncState
	for rows.Next() {
		var connectionID string
		var calendarStatus, eventsStatus sql.NullString
		var calLastSynced, evtLastSynced, calendarStarted, eventsStarted *time.Time
		var calendarError, eventsError *string
		var evtWindowStart, evtWindowEnd *time.Time
		var updatedAt sql.NullTime

		if err := rows.Scan(
			&connectionID, &calendarStatus, &eventsStatus,
			&calLastSynced, &evtLastSynced, &calendarStarted, &eventsStarted,
			&calendarError, &eventsError, &evtWindowStart, &evtWindowEnd, &updatedAt,
		); err != nil {
			return nil, err
		}

		state := &models.CalendarSyncState{
			ConnectionID:          connectionID,
			CalendarStatus:        calendarStatus.String,
			EventsStatus:          eventsStatus.String,
			CalendarLastSyncedAt:  calLastSynced,
			EventsLastSyncedAt:    evtLastSynced,
			CalendarSyncStartedAt: calendarStarted,
			EventsSyncStartedAt:   eventsStarted,
			CalendarLastError:     calendarError,
			EventsLastError:       eventsError,
			EventsWindowStart:     evtWindowStart,
			EventsWindowEnd:       evtWindowEnd,
		}
		if updatedAt.Valid {
			state.UpdatedAt = updatedAt.Time
		}
		states = append(states, state)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	return states, tx.Commit()
}

func (r *calendarCacheRepository) ClearCalendarSyncToken(ctx context.Context, userID, connectionID, calendarID string) error {
	query := `
		UPDATE calendar_sources
		SET sync_token = NULL, sync_window_start = NULL, sync_window_end = NULL, updated_at = now()
		WHERE user_id = $1 AND connection_id = $2 AND calendar_id = $3
	`
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, query, userID, connectionID, calendarID); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *calendarCacheRepository) MarkSyncStarted(ctx context.Context, userID, connectionID, scope string) error {
	calendarScope, eventsScope := syncScopeFlags(scope)
	err := r.execTenant(ctx, userID, `
		INSERT INTO calendar_sync_state (
			user_id, connection_id, calendar_status, events_status,
			calendar_sync_started_at, events_sync_started_at, created_at, updated_at
		) VALUES (
			$1, $2,
			CASE WHEN $3 THEN 'syncing' ELSE 'idle' END,
			CASE WHEN $4 THEN 'syncing' ELSE 'idle' END,
			CASE WHEN $3 THEN now() END,
			CASE WHEN $4 THEN now() END,
			now(), now()
		)
		ON CONFLICT (user_id, connection_id) DO UPDATE SET
			calendar_status = CASE WHEN $3 THEN 'syncing' ELSE calendar_sync_state.calendar_status END,
			events_status = CASE WHEN $4 THEN 'syncing' ELSE calendar_sync_state.events_status END,
			calendar_sync_started_at = CASE WHEN $3 THEN now() ELSE calendar_sync_state.calendar_sync_started_at END,
			events_sync_started_at = CASE WHEN $4 THEN now() ELSE calendar_sync_state.events_sync_started_at END,
			updated_at = now()
	`, userID, connectionID, calendarScope, eventsScope)
	return err
}

func (r *calendarCacheRepository) MarkSyncSuccess(ctx context.Context, userID, connectionID, scope string, windowStart, windowEnd *time.Time) error {
	calendarScope, eventsScope := syncScopeFlags(scope)
	err := r.execTenantWithCapability(ctx, userID, connectionID, "active", "", true, `
		INSERT INTO calendar_sync_state (
			user_id, connection_id, calendar_status, events_status,
			calendar_last_synced_at, events_last_synced_at,
			events_window_start, events_window_end, created_at, updated_at
		) VALUES (
			$1, $2,
			CASE WHEN $3 THEN 'success' ELSE 'idle' END,
			CASE WHEN $4 THEN 'success' ELSE 'idle' END,
			CASE WHEN $3 THEN now() END,
			CASE WHEN $4 THEN now() END,
			CASE WHEN $4 THEN $5::timestamptz END,
			CASE WHEN $4 THEN $6::timestamptz END,
			now(), now()
		)
		ON CONFLICT (user_id, connection_id) DO UPDATE SET
			calendar_status = CASE WHEN $3 THEN 'success' ELSE calendar_sync_state.calendar_status END,
			events_status = CASE WHEN $4 THEN 'success' ELSE calendar_sync_state.events_status END,
			calendar_last_error = CASE WHEN $3 THEN NULL ELSE calendar_sync_state.calendar_last_error END,
			events_last_error = CASE WHEN $4 THEN NULL ELSE calendar_sync_state.events_last_error END,
			calendar_last_synced_at = CASE WHEN $3 THEN now() ELSE calendar_sync_state.calendar_last_synced_at END,
			events_last_synced_at = CASE WHEN $4 THEN now() ELSE calendar_sync_state.events_last_synced_at END,
			events_window_start = CASE WHEN $4 AND $5::timestamptz IS NOT NULL THEN $5::timestamptz ELSE calendar_sync_state.events_window_start END,
			events_window_end = CASE WHEN $4 AND $6::timestamptz IS NOT NULL THEN $6::timestamptz ELSE calendar_sync_state.events_window_end END,
			updated_at = now()
	`, userID, connectionID, calendarScope, eventsScope, windowStart, windowEnd)
	return err
}

func (r *calendarCacheRepository) MarkSyncError(ctx context.Context, userID, connectionID, scope string, syncErr error) error {
	return r.markSyncOutcome(ctx, userID, connectionID, scope, "error", syncErrorMessage(syncErr, "calendar synchronization failed"))
}

func (r *calendarCacheRepository) MarkSyncPartial(ctx context.Context, userID, connectionID, scope string, syncErr error) error {
	return r.markSyncOutcome(ctx, userID, connectionID, scope, "partial", syncErrorMessage(syncErr, "partial calendar synchronization"))
}

func (r *calendarCacheRepository) markSyncOutcome(ctx context.Context, userID, connectionID, scope, status, message string) error {
	calendarScope, eventsScope := syncScopeFlags(scope)
	capabilityError := "calendar_sync_failed"
	if status == "partial" {
		capabilityError = "calendar_sync_partial"
	}
	err := r.execTenantWithCapability(ctx, userID, connectionID, "error", capabilityError, false, `
		INSERT INTO calendar_sync_state (
			user_id, connection_id, calendar_status, events_status,
			calendar_last_error, events_last_error, created_at, updated_at
		) VALUES (
			$1, $2,
			CASE WHEN $3 THEN $5 ELSE 'idle' END,
			CASE WHEN $4 THEN $5 ELSE 'idle' END,
			CASE WHEN $3 THEN $6 END,
			CASE WHEN $4 THEN $6 END,
			now(), now()
		)
		ON CONFLICT (user_id, connection_id) DO UPDATE SET
			calendar_status = CASE WHEN $3 THEN $5 ELSE calendar_sync_state.calendar_status END,
			events_status = CASE WHEN $4 THEN $5 ELSE calendar_sync_state.events_status END,
			calendar_last_error = CASE WHEN $3 THEN $6 ELSE calendar_sync_state.calendar_last_error END,
			events_last_error = CASE WHEN $4 THEN $6 ELSE calendar_sync_state.events_last_error END,
			updated_at = now()
	`, userID, connectionID, calendarScope, eventsScope, status, message)
	return err
}

func (r *calendarCacheRepository) execTenant(ctx context.Context, userID, query string, args ...interface{}) error {
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, query, args...); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *calendarCacheRepository) execTenantWithCapability(ctx context.Context, userID, connectionID, capabilityStatus, errorCode string, succeeded bool, query string, args ...interface{}) error {
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, query, args...); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE integration_capabilities
		SET status = CASE WHEN status = 'needs_reconnect' THEN status ELSE $3 END,
			last_success_at = CASE WHEN $4 THEN now() ELSE last_success_at END,
			last_error_code = CASE
				WHEN status = 'needs_reconnect' THEN last_error_code
				WHEN $4 THEN NULL
				ELSE NULLIF($5, '')
			END,
			updated_at = now()
		WHERE user_id = $1 AND connection_id = $2 AND capability_key = 'calendar.read'
	`, userID, connectionID, capabilityStatus, succeeded, errorCode); err != nil {
		return err
	}
	return tx.Commit()
}

func syncScopeFlags(scope string) (calendarScope, eventsScope bool) {
	return scope == "all" || scope == "calendars", scope == "all" || scope == "events"
}

func syncErrorMessage(syncErr error, fallback string) string {
	message := fallback
	if syncErr != nil {
		message = syncErr.Error()
	}
	if len(message) > 1000 {
		message = message[:1000]
	}
	return message
}

func nullString(value string) sql.NullString {
	return sql.NullString{String: value, Valid: value != ""}
}
