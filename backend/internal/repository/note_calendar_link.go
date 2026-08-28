package repository

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/mouizahmed/justscribe-backend/internal/models"
)

func (r *NoteRepository) SetCalendarLink(ctx context.Context, userID, noteID, calendarEventID string, expectedRevision *int64) (*models.Note, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin calendar link update: %w", err)
	}
	defer tx.Rollback()

	note, err := lockNoteForCalendarLink(tx, userID, noteID, expectedRevision)
	if err != nil {
		return nil, err
	}

	var eventOwner string
	if err := tx.QueryRow(`SELECT user_id::text FROM calendar_events WHERE id = $1`, calendarEventID).Scan(&eventOwner); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrCalendarEventNotFound
		}
		return nil, fmt.Errorf("failed to validate calendar event: %w", err)
	}
	if eventOwner != userID {
		return nil, ErrCalendarEventNotFound
	}

	if _, err := tx.Exec(`
		UPDATE notes
		SET calendar_event_id = $3, updated_at = now(), revision = revision + 1
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, noteID, userID, calendarEventID); err != nil {
		if isConstraintViolation(err, "notes_one_per_event_idx") {
			return nil, ErrCalendarEventLinked
		}
		return nil, fmt.Errorf("failed to link calendar event: %w", err)
	}

	if _, err := tx.Exec(`DELETE FROM note_attendees WHERE note_id = $1 AND source = 'calendar'`, noteID); err != nil {
		return nil, fmt.Errorf("failed to clear previous calendar attendees: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM note_attendee_suppressions WHERE note_id = $1`, noteID); err != nil {
		return nil, fmt.Errorf("failed to clear previous attendee suppressions: %w", err)
	}
	if err := upsertNoteCalendarSnapshot(tx, noteID, userID, calendarEventID); err != nil {
		return nil, err
	}
	if err := reconcileCalendarAttendeesTx(tx, noteID, userID, calendarEventID); err != nil {
		return nil, err
	}

	if err := scanUpdatedNote(tx, noteID, userID, note); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit calendar link: %w", err)
	}
	return note, nil
}

func (r *NoteRepository) ClearCalendarLink(ctx context.Context, userID, noteID string, expectedRevision *int64) (*models.Note, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin calendar unlink: %w", err)
	}
	defer tx.Rollback()

	note, err := lockNoteForCalendarLink(tx, userID, noteID, expectedRevision)
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`
		UPDATE notes
		SET calendar_event_id = NULL, updated_at = now(), revision = revision + 1
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, noteID, userID); err != nil {
		return nil, fmt.Errorf("failed to unlink calendar event: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM note_calendar_links WHERE note_id = $1 AND user_id = $2`, noteID, userID); err != nil {
		return nil, fmt.Errorf("failed to remove calendar snapshot: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM note_attendees WHERE note_id = $1 AND source = 'calendar'`, noteID); err != nil {
		return nil, fmt.Errorf("failed to remove calendar attendees: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM note_attendee_suppressions WHERE note_id = $1`, noteID); err != nil {
		return nil, fmt.Errorf("failed to remove attendee suppressions: %w", err)
	}

	if err := scanUpdatedNote(tx, noteID, userID, note); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit calendar unlink: %w", err)
	}
	return note, nil
}

func lockNoteForCalendarLink(tx *sql.Tx, userID, noteID string, expectedRevision *int64) (*models.Note, error) {
	var note models.Note
	var folderID, calendarEventID sql.NullString
	var deletedAt sql.NullTime
	if err := tx.QueryRow(`
		SELECT id, user_id, folder_id, title, note_markdown, created_at, updated_at, deleted_at,
		       calendar_event_id::text, revision
		FROM notes
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
		FOR UPDATE
	`, noteID, userID).Scan(
		&note.ID, &note.UserID, &folderID, &note.Title, &note.NoteMarkdown,
		&note.CreatedAt, &note.UpdatedAt, &deletedAt, &calendarEventID, &note.Revision,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNoteNotFound
		}
		return nil, fmt.Errorf("failed to lock note: %w", err)
	}
	if expectedRevision != nil && note.Revision != *expectedRevision {
		return nil, ErrNoteRevisionConflict
	}
	note.FolderID = fromNullString(folderID)
	note.CalendarEventID = fromNullString(calendarEventID)
	note.DeletedAt = fromNullTime(deletedAt)
	return &note, nil
}

func scanUpdatedNote(tx *sql.Tx, noteID, userID string, note *models.Note) error {
	var folderID, calendarEventID sql.NullString
	var deletedAt sql.NullTime
	if err := tx.QueryRow(`
		SELECT id, user_id, folder_id, title, note_markdown, created_at, updated_at, deleted_at,
		       calendar_event_id::text, revision
		FROM notes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`, noteID, userID).Scan(
		&note.ID, &note.UserID, &folderID, &note.Title, &note.NoteMarkdown,
		&note.CreatedAt, &note.UpdatedAt, &deletedAt, &calendarEventID, &note.Revision,
	); err != nil {
		return fmt.Errorf("failed to load updated note: %w", err)
	}
	note.FolderID = fromNullString(folderID)
	note.CalendarEventID = fromNullString(calendarEventID)
	note.DeletedAt = fromNullTime(deletedAt)
	return nil
}

func upsertNoteCalendarSnapshot(tx *sql.Tx, noteID, userID, calendarEventID string) error {
	result, err := tx.Exec(`
		INSERT INTO note_calendar_links (
			note_id, user_id, calendar_event_id, snapshot_event_id, provider_event_id,
			connection_id, calendar_id, provider, account_email, title, start_at, end_at,
			all_day, location, meeting_link, event_link, calendar_name, color,
			organizer_name, organizer_email, attendees_snapshot, created_at, updated_at
		)
		SELECT $1, $2, e.id, e.id, e.provider_event_id,
			e.connection_id, e.calendar_id, e.provider, e.account_email, e.title, e.start_at, e.end_at,
			e.all_day, e.location, e.meeting_link, e.event_link, e.calendar_name, e.color,
			e.organizer_name, e.organizer_email, e.attendees, now(), now()
		FROM calendar_events e
		WHERE e.id = $3 AND e.user_id = $2
		ON CONFLICT (note_id) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			calendar_event_id = EXCLUDED.calendar_event_id,
			snapshot_event_id = EXCLUDED.snapshot_event_id,
			provider_event_id = EXCLUDED.provider_event_id,
			connection_id = EXCLUDED.connection_id,
			calendar_id = EXCLUDED.calendar_id,
			provider = EXCLUDED.provider,
			account_email = EXCLUDED.account_email,
			title = EXCLUDED.title,
			start_at = EXCLUDED.start_at,
			end_at = EXCLUDED.end_at,
			all_day = EXCLUDED.all_day,
			location = EXCLUDED.location,
			meeting_link = EXCLUDED.meeting_link,
			event_link = EXCLUDED.event_link,
			calendar_name = EXCLUDED.calendar_name,
			color = EXCLUDED.color,
			organizer_name = EXCLUDED.organizer_name,
			organizer_email = EXCLUDED.organizer_email,
			attendees_snapshot = EXCLUDED.attendees_snapshot,
			updated_at = now()
	`, noteID, userID, calendarEventID)
	if err != nil {
		return fmt.Errorf("failed to save calendar snapshot: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to verify calendar snapshot: %w", err)
	}
	if rows != 1 {
		return ErrCalendarEventNotFound
	}
	return nil
}

func reconcileCalendarAttendeesTx(tx *sql.Tx, noteID, userID, calendarEventID string) error {
	if _, err := tx.Exec(`
		DELETE FROM note_attendees na
		WHERE na.note_id = $1
		  AND na.source = 'calendar'
		  AND NOT EXISTS (
			SELECT 1
			FROM calendar_event_attendees cea
			WHERE cea.calendar_event_id = $3
			  AND cea.user_id = $2
			  AND lower(btrim(cea.email)) = lower(btrim(na.email))
			  AND cea.resource = false
			  AND cea.self_attendee = false
			  AND cea.organizer = false
			  AND cea.response_status <> 'declined'
		  )
	`, noteID, userID, calendarEventID); err != nil {
		return fmt.Errorf("failed to remove stale calendar attendees: %w", err)
	}

	if _, err := tx.Exec(`
		INSERT INTO note_attendees (note_id, email, display_name, source)
		SELECT $1, cea.email, cea.display_name, 'calendar'
		FROM calendar_event_attendees cea
		WHERE cea.calendar_event_id = $3
		  AND cea.user_id = $2
		  AND cea.resource = false
		  AND cea.self_attendee = false
		  AND cea.organizer = false
		  AND cea.response_status <> 'declined'
		  AND NOT EXISTS (
			SELECT 1 FROM note_attendee_suppressions nas
			WHERE nas.note_id = $1
			  AND lower(btrim(nas.email)) = lower(btrim(cea.email))
		  )
		ON CONFLICT (note_id, lower(btrim(email))) DO UPDATE SET
			display_name = CASE
				WHEN btrim(EXCLUDED.display_name) = '' THEN note_attendees.display_name
				WHEN note_attendees.source = 'calendar'
					OR btrim(note_attendees.display_name) = '' THEN EXCLUDED.display_name
				ELSE note_attendees.display_name
			END
	`, noteID, userID, calendarEventID); err != nil {
		return fmt.Errorf("failed to add calendar attendees: %w", err)
	}
	return nil
}
