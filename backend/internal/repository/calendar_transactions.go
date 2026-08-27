package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/lib/pq"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

func (r *calendarCacheRepository) AcquireSyncLock(ctx context.Context, userID, connectionID string) (func(), error) {
	conn, err := r.db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to reserve calendar lock connection: %w", err)
	}
	key := "calendar-sync:" + userID + ":" + connectionID
	var acquired bool
	if err := conn.QueryRowContext(ctx, `SELECT pg_try_advisory_lock(hashtextextended($1, 0))`, key).Scan(&acquired); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to acquire calendar sync lock: %w", err)
	}
	if !acquired {
		conn.Close()
		return nil, ErrCalendarSyncInProgress
	}
	return func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = conn.ExecContext(releaseCtx, `SELECT pg_advisory_unlock(hashtextextended($1, 0))`, key)
		_ = conn.Close()
	}, nil
}

func (r *calendarCacheRepository) ReconcileCalendarSources(ctx context.Context, userID string, connection *models.IntegrationConnection, sources []*models.CachedCalendarSource) ([]string, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin calendar source reconciliation: %w", err)
	}
	defer tx.Rollback()

	ids := make([]string, 0, len(sources))
	for _, source := range sources {
		ids = append(ids, source.ID)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO calendar_sources (
				user_id, connection_id, calendar_id, provider, account_email, name,
				color, background_color, foreground_color, primary_calendar, selected,
				access_role, synced_at, created_at, updated_at
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),now(),now())
			ON CONFLICT (user_id, connection_id, calendar_id) DO UPDATE SET
				provider = EXCLUDED.provider,
				account_email = EXCLUDED.account_email,
				name = EXCLUDED.name,
				color = EXCLUDED.color,
				background_color = EXCLUDED.background_color,
				foreground_color = EXCLUDED.foreground_color,
				primary_calendar = EXCLUDED.primary_calendar,
				selected = EXCLUDED.selected,
				access_role = EXCLUDED.access_role,
				synced_at = now(),
				updated_at = now()
		`, userID, connection.ID, source.ID, source.Provider, nullString(source.AccountEmail), source.Name,
			nullString(source.Color), nullString(source.BackgroundColor), nullString(source.ForegroundColor),
			source.Primary, source.Selected, nullString(source.AccessRole)); err != nil {
			return nil, fmt.Errorf("failed to upsert calendar source %s: %w", source.ID, err)
		}
	}

	noteIDs, err := listAffectedNoteIDs(ctx, tx, `
		SELECT DISTINCT l.note_id::text
		FROM note_calendar_links l
		JOIN calendar_events e ON e.id = l.calendar_event_id AND e.user_id = l.user_id
		WHERE e.user_id = $1 AND e.connection_id = $2
		  AND NOT (e.calendar_id = ANY($3))
	`, userID, connection.ID, pq.Array(ids))
	if err != nil {
		return nil, err
	}
	if err := clearCalendarAttendeesForNotes(ctx, tx, noteIDs); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM calendar_preferences
		WHERE user_id = $1 AND connection_id = $2 AND NOT (calendar_id = ANY($3))
	`, userID, connection.ID, pq.Array(ids)); err != nil {
		return nil, fmt.Errorf("failed to remove stale calendar preferences: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM calendar_sources
		WHERE user_id = $1 AND connection_id = $2 AND NOT (calendar_id = ANY($3))
	`, userID, connection.ID, pq.Array(ids)); err != nil {
		return nil, fmt.Errorf("failed to remove stale calendar sources: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit calendar source reconciliation: %w", err)
	}
	return noteIDs, nil
}

func (r *calendarCacheRepository) ApplyCalendarEventSync(ctx context.Context, userID string, connection *models.IntegrationConnection, calendarID string, batch models.CalendarEventSyncBatch) ([]string, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin calendar event apply: %w", err)
	}
	defer tx.Rollback()

	noteIDs, err := listAffectedNoteIDs(ctx, tx, `
		SELECT DISTINCT l.note_id::text
		FROM note_calendar_links l
		JOIN calendar_events e ON e.id = l.calendar_event_id AND e.user_id = l.user_id
		WHERE e.user_id = $1 AND e.connection_id = $2 AND e.calendar_id = $3
	`, userID, connection.ID, calendarID)
	if err != nil {
		return nil, err
	}

	seen := make([]string, 0, len(batch.Events))
	for _, event := range batch.Events {
		seen = append(seen, event.ProviderID)
		eventID, err := upsertCalendarEventTx(ctx, tx, userID, connection, event)
		if err != nil {
			return nil, err
		}
		if err := replaceCalendarEventAttendeesTx(ctx, tx, userID, eventID, event.Attendees); err != nil {
			return nil, err
		}
		if err := refreshLinkedSnapshotsTx(ctx, tx, userID, eventID); err != nil {
			return nil, err
		}
	}

	if len(batch.Deleted) > 0 {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM calendar_events
			WHERE user_id = $1 AND connection_id = $2 AND calendar_id = $3
			  AND provider_event_id = ANY($4)
		`, userID, connection.ID, calendarID, pq.Array(batch.Deleted)); err != nil {
			return nil, fmt.Errorf("failed to delete removed calendar events: %w", err)
		}
	}
	if batch.WasFullSync {
		if _, err := tx.ExecContext(ctx, `
			DELETE FROM calendar_events
			WHERE user_id = $1 AND connection_id = $2 AND calendar_id = $3
			  AND start_at < $5 AND end_at > $4
			  AND NOT (provider_event_id = ANY($6))
		`, userID, connection.ID, calendarID, batch.WindowStart, batch.WindowEnd, pq.Array(seen)); err != nil {
			return nil, fmt.Errorf("failed to reconcile missing calendar events: %w", err)
		}
	}
	if batch.NextToken != "" {
		result, err := tx.ExecContext(ctx, `
			UPDATE calendar_sources
			SET sync_token = $4, sync_window_start = $5, sync_window_end = $6, updated_at = now()
			WHERE user_id = $1 AND connection_id = $2 AND calendar_id = $3
		`, userID, connection.ID, calendarID, batch.NextToken, batch.WindowStart, batch.WindowEnd)
		if err != nil {
			return nil, fmt.Errorf("failed to save calendar cursor: %w", err)
		}
		if rows, err := result.RowsAffected(); err != nil || rows != 1 {
			return nil, fmt.Errorf("calendar source disappeared while saving cursor")
		}
	}

	for _, noteID := range noteIDs {
		var eventID sql.NullString
		if err := tx.QueryRowContext(ctx, `SELECT calendar_event_id::text FROM notes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, noteID, userID).Scan(&eventID); err != nil {
			if err == sql.ErrNoRows {
				continue
			}
			return nil, fmt.Errorf("failed to load linked note %s: %w", noteID, err)
		}
		if !eventID.Valid {
			if err := clearCalendarAttendeesForNotes(ctx, tx, []string{noteID}); err != nil {
				return nil, err
			}
			continue
		}
		if err := reconcileCalendarAttendeesTx(tx, noteID, userID, eventID.String); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit calendar event apply: %w", err)
	}
	return noteIDs, nil
}

func (r *calendarCacheRepository) DeleteEventsBefore(ctx context.Context, userID, connectionID string, cutoff time.Time) ([]string, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin calendar retention cleanup: %w", err)
	}
	defer tx.Rollback()
	noteIDs, err := listAffectedNoteIDs(ctx, tx, `
		SELECT DISTINCT l.note_id::text
		FROM note_calendar_links l
		JOIN calendar_events e ON e.id = l.calendar_event_id AND e.user_id = l.user_id
		WHERE e.user_id = $1 AND e.connection_id = $2 AND e.end_at < $3
	`, userID, connectionID, cutoff)
	if err != nil {
		return nil, err
	}
	if err := clearCalendarAttendeesForNotes(ctx, tx, noteIDs); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM calendar_events WHERE user_id = $1 AND connection_id = $2 AND end_at < $3`, userID, connectionID, cutoff); err != nil {
		return nil, fmt.Errorf("failed to delete expired calendar events: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit calendar retention cleanup: %w", err)
	}
	return noteIDs, nil
}

func upsertCalendarEventTx(ctx context.Context, tx *sql.Tx, userID string, connection *models.IntegrationConnection, event *models.CachedCalendarEvent) (string, error) {
	attendees, err := json.Marshal(event.Attendees)
	if err != nil {
		return "", fmt.Errorf("failed to encode calendar attendees: %w", err)
	}
	var eventID string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO calendar_events (
			user_id, connection_id, calendar_id, provider_event_id, provider, account_email,
			title, start_at, end_at, all_day, location, description, meeting_link, event_link,
			calendar_name, color, organizer_name, organizer_email, attendees, synced_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now(),now(),now())
		ON CONFLICT (user_id, connection_id, calendar_id, provider_event_id) DO UPDATE SET
			provider = EXCLUDED.provider,
			account_email = EXCLUDED.account_email,
			title = EXCLUDED.title,
			start_at = EXCLUDED.start_at,
			end_at = EXCLUDED.end_at,
			all_day = EXCLUDED.all_day,
			location = EXCLUDED.location,
			description = EXCLUDED.description,
			meeting_link = EXCLUDED.meeting_link,
			event_link = EXCLUDED.event_link,
			calendar_name = EXCLUDED.calendar_name,
			color = EXCLUDED.color,
			organizer_name = EXCLUDED.organizer_name,
			organizer_email = EXCLUDED.organizer_email,
			attendees = EXCLUDED.attendees,
			synced_at = now(),
			updated_at = now()
		RETURNING id::text
	`, userID, connection.ID, event.CalendarID, event.ProviderID, event.Provider, nullString(event.AccountEmail),
		event.Title, event.Start, event.End, event.AllDay, nullString(event.Location), nullString(event.Description),
		nullString(event.MeetingLink), nullString(event.EventLink), nullString(event.CalendarName), nullString(event.Color),
		nullString(event.OrganizerName), nullString(event.OrganizerEmail), attendees).Scan(&eventID)
	if err != nil {
		return "", fmt.Errorf("failed to upsert calendar event %s: %w", event.ProviderID, err)
	}
	return eventID, nil
}

func replaceCalendarEventAttendeesTx(ctx context.Context, tx *sql.Tx, userID, eventID string, attendees []models.CalendarEventAttendee) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM calendar_event_attendees WHERE user_id = $1 AND calendar_event_id = $2`, userID, eventID); err != nil {
		return fmt.Errorf("failed to replace calendar event attendees: %w", err)
	}
	for _, attendee := range attendees {
		email := strings.ToLower(strings.TrimSpace(attendee.Email))
		if email == "" {
			continue
		}
		raw, _ := json.Marshal(attendee)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO calendar_event_attendees (
				user_id, calendar_event_id, provider_attendee_id, email, display_name,
				response_status, attendee_type, optional, organizer, self_attendee, resource, raw
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
			ON CONFLICT (calendar_event_id, lower(btrim(email))) DO UPDATE SET
				provider_attendee_id = EXCLUDED.provider_attendee_id,
				display_name = EXCLUDED.display_name,
				response_status = EXCLUDED.response_status,
				attendee_type = EXCLUDED.attendee_type,
				optional = EXCLUDED.optional,
				organizer = EXCLUDED.organizer,
				self_attendee = EXCLUDED.self_attendee,
				resource = EXCLUDED.resource,
				raw = EXCLUDED.raw,
				updated_at = now()
		`, userID, eventID, nullString(attendee.ProviderID), email, attendee.Name,
			firstNonBlank(attendee.ResponseStatus, "unknown"), firstNonBlank(attendee.AttendeeType, "required"),
			attendee.Optional, attendee.Organizer, attendee.Self, attendee.Resource, raw); err != nil {
			return fmt.Errorf("failed to insert calendar attendee %s: %w", email, err)
		}
	}
	return nil
}

func refreshLinkedSnapshotsTx(ctx context.Context, tx *sql.Tx, userID, eventID string) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE note_calendar_links l SET
			provider_event_id = e.provider_event_id,
			connection_id = e.connection_id,
			calendar_id = e.calendar_id,
			provider = e.provider,
			account_email = e.account_email,
			title = e.title,
			start_at = e.start_at,
			end_at = e.end_at,
			all_day = e.all_day,
			location = e.location,
			meeting_link = e.meeting_link,
			event_link = e.event_link,
			calendar_name = e.calendar_name,
			color = e.color,
			organizer_name = e.organizer_name,
			organizer_email = e.organizer_email,
			attendees_snapshot = e.attendees,
			updated_at = now()
		FROM calendar_events e
		WHERE l.user_id = $1 AND l.calendar_event_id = e.id AND e.id = $2
	`, userID, eventID)
	if err != nil {
		return fmt.Errorf("failed to refresh linked note snapshots: %w", err)
	}
	return nil
}

func listAffectedNoteIDs(ctx context.Context, tx *sql.Tx, query string, args ...interface{}) ([]string, error) {
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list affected notes: %w", err)
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var noteID string
		if err := rows.Scan(&noteID); err != nil {
			return nil, fmt.Errorf("failed to scan affected note: %w", err)
		}
		result = append(result, noteID)
	}
	return result, rows.Err()
}

func clearCalendarAttendeesForNotes(ctx context.Context, tx *sql.Tx, noteIDs []string) error {
	if len(noteIDs) == 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM note_attendees WHERE source = 'calendar' AND note_id = ANY($1)`, pq.Array(noteIDs)); err != nil {
		return fmt.Errorf("failed to remove calendar attendees: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM note_attendee_suppressions WHERE note_id = ANY($1)`, pq.Array(noteIDs)); err != nil {
		return fmt.Errorf("failed to remove calendar attendee suppressions: %w", err)
	}
	return nil
}

func firstNonBlank(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
