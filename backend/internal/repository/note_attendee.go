package repository

import (
	"database/sql"
	"fmt"

	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type NoteAttendeeRepository struct {
	db *database.DB
}

func NewNoteAttendeeRepository(db *database.DB) *NoteAttendeeRepository {
	return &NoteAttendeeRepository{db: db}
}

func scanNoteAttendee(row interface {
	Scan(dest ...interface{}) error
}) (*models.NoteAttendee, error) {
	var a models.NoteAttendee
	var userID sql.NullString
	var name sql.NullString
	var avatarURL sql.NullString
	if err := row.Scan(&a.ID, &a.NoteID, &a.Email, &userID, &name, &avatarURL, &a.Source, &a.CreatedAt); err != nil {
		return nil, err
	}
	a.UserID = fromNullString(userID)
	a.Name = name.String
	a.AvatarURL = avatarURL.String
	return &a, nil
}

func (r *NoteAttendeeRepository) ListByNote(noteID string) ([]models.NoteAttendee, error) {
	query := `
		SELECT na.id, na.note_id, na.email, na.user_id, COALESCE(u.name, '') AS name, COALESCE(u.avatar_url, '') AS avatar_url, na.source, na.created_at
		FROM note_attendees na
		LEFT JOIN users u ON u.id = na.user_id
		WHERE na.note_id = $1
		ORDER BY na.created_at ASC
	`

	rows, err := r.db.Query(query, noteID)
	if err != nil {
		return nil, fmt.Errorf("failed to list note attendees: %w", err)
	}
	defer rows.Close()

	attendees := []models.NoteAttendee{}
	for rows.Next() {
		a, err := scanNoteAttendee(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan note attendee: %w", err)
		}
		attendees = append(attendees, *a)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate note attendees: %w", err)
	}

	return attendees, nil
}

func (r *NoteAttendeeRepository) Add(noteID, email string) (*models.NoteAttendee, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("failed to begin attendee add: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM note_attendee_suppressions WHERE note_id = $1 AND lower(btrim(email)) = lower(btrim($2))`, noteID, email); err != nil {
		return nil, fmt.Errorf("failed to clear attendee suppression: %w", err)
	}
	query := `
		WITH inserted AS (
			INSERT INTO note_attendees (note_id, email, user_id, source)
			VALUES ($1, $2, (
				SELECT candidate.id
				FROM users candidate
				WHERE lower(btrim(candidate.email)) = lower(btrim($2))
				  AND candidate.status = 'active' AND candidate.deleted_at IS NULL
				  AND NOT EXISTS (
					SELECT 1 FROM users other
					WHERE lower(btrim(other.email)) = lower(btrim(candidate.email))
					  AND other.status = 'active' AND other.deleted_at IS NULL
					  AND other.id <> candidate.id
				  )
				LIMIT 1
			), 'manual')
			ON CONFLICT (note_id, lower(btrim(email))) DO UPDATE SET
				user_id = COALESCE(EXCLUDED.user_id, note_attendees.user_id),
				source = 'manual'
			RETURNING id, note_id, email, user_id, source, created_at
		)
		SELECT i.id, i.note_id, i.email, i.user_id, COALESCE(u.name, '') AS name, COALESCE(u.avatar_url, '') AS avatar_url, i.source, i.created_at
		FROM inserted i
		LEFT JOIN users u ON u.id = i.user_id
	`

	row := tx.QueryRow(query, noteID, email)
	a, err := scanNoteAttendee(row)
	if err != nil {
		return nil, fmt.Errorf("failed to add note attendee: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit attendee add: %w", err)
	}
	return a, nil
}

func (r *NoteAttendeeRepository) AddByUserID(noteID, userID string) error {
	query := `
		INSERT INTO note_attendees (note_id, email, user_id)
		SELECT $1, u.email, u.id FROM users u WHERE u.id = $2
		ON CONFLICT (note_id, lower(btrim(email))) DO UPDATE SET user_id = COALESCE(EXCLUDED.user_id, note_attendees.user_id)
	`
	_, err := r.db.Exec(query, noteID, userID)
	if err != nil {
		return fmt.Errorf("failed to add creator attendee: %w", err)
	}
	return nil
}

// SyncNoteFromEvent adds calendar event attendees to the note and removes any
// calendar-sourced attendees that are no longer in the event. Manual attendees are never removed.
func (r *NoteAttendeeRepository) SyncNoteFromEvent(noteID, calendarEventID string) error {
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin attendee sync: %w", err)
	}
	defer tx.Rollback()
	var userID string
	if err := tx.QueryRow(`SELECT user_id::text FROM notes WHERE id = $1 AND deleted_at IS NULL`, noteID).Scan(&userID); err != nil {
		return fmt.Errorf("failed to load note owner: %w", err)
	}
	if err := reconcileCalendarAttendeesTx(tx, noteID, userID, calendarEventID); err != nil {
		return err
	}
	return tx.Commit()
}

// SyncAllFromCalendarEvents syncs attendees from all linked calendar events to their notes for
// the given user. Adds new calendar attendees and removes stale ones; manual attendees are never removed.
func (r *NoteAttendeeRepository) SyncAllFromCalendarEvents(userID string) error {
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin attendee reconciliation: %w", err)
	}
	defer tx.Rollback()
	rows, err := tx.Query(`
		SELECT n.id::text, n.calendar_event_id::text
		FROM notes n
		WHERE n.user_id = $1 AND n.deleted_at IS NULL AND n.calendar_event_id IS NOT NULL
	`, userID)
	if err != nil {
		return fmt.Errorf("failed to list linked notes: %w", err)
	}
	type link struct{ noteID, eventID string }
	var links []link
	for rows.Next() {
		var item link
		if err := rows.Scan(&item.noteID, &item.eventID); err != nil {
			rows.Close()
			return fmt.Errorf("failed to scan linked note: %w", err)
		}
		links = append(links, item)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("failed to close linked notes: %w", err)
	}
	for _, item := range links {
		if err := reconcileCalendarAttendeesTx(tx, item.noteID, userID, item.eventID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (r *NoteAttendeeRepository) Remove(noteID, email string) (bool, error) {
	tx, err := r.db.Begin()
	if err != nil {
		return false, fmt.Errorf("failed to begin attendee removal: %w", err)
	}
	defer tx.Rollback()
	var source, userID string
	if err := tx.QueryRow(`
		SELECT na.source, n.user_id::text
		FROM note_attendees na
		JOIN notes n ON n.id = na.note_id
		WHERE na.note_id = $1 AND lower(btrim(na.email)) = lower(btrim($2))
	`, noteID, email).Scan(&source, &userID); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("failed to load attendee: %w", err)
	}
	if source == "calendar" {
		if _, err := tx.Exec(`
			INSERT INTO note_attendee_suppressions (note_id, user_id, email)
			VALUES ($1, $2, lower(btrim($3)))
			ON CONFLICT (note_id, lower(btrim(email))) DO NOTHING
		`, noteID, userID, email); err != nil {
			return false, fmt.Errorf("failed to suppress calendar attendee: %w", err)
		}
	}
	res, err := tx.Exec(`DELETE FROM note_attendees WHERE note_id = $1 AND lower(btrim(email)) = lower(btrim($2))`, noteID, email)
	if err != nil {
		return false, fmt.Errorf("failed to remove note attendee: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("failed to remove note attendee: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("failed to commit attendee removal: %w", err)
	}
	return affected > 0, nil
}
