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
	if err := row.Scan(&a.ID, &a.NoteID, &a.Email, &userID, &name, &avatarURL, &a.CreatedAt); err != nil {
		return nil, err
	}
	a.UserID = fromNullString(userID)
	a.Name = name.String
	a.AvatarURL = avatarURL.String
	return &a, nil
}

func (r *NoteAttendeeRepository) ListByNote(noteID string) ([]models.NoteAttendee, error) {
	query := `
		SELECT na.id, na.note_id, na.email, na.user_id, COALESCE(u.name, '') AS name, COALESCE(u.avatar_url, '') AS avatar_url, na.created_at
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
	query := `
		WITH inserted AS (
			INSERT INTO note_attendees (note_id, email, user_id)
			VALUES ($1, $2, (SELECT id FROM users WHERE email = $2 LIMIT 1))
			ON CONFLICT (note_id, email) DO UPDATE SET
				user_id = COALESCE(EXCLUDED.user_id, note_attendees.user_id)
			RETURNING id, note_id, email, user_id, created_at
		)
		SELECT i.id, i.note_id, i.email, i.user_id, COALESCE(u.name, '') AS name, COALESCE(u.avatar_url, '') AS avatar_url, i.created_at
		FROM inserted i
		LEFT JOIN users u ON u.id = i.user_id
	`

	row := r.db.QueryRow(query, noteID, email)
	a, err := scanNoteAttendee(row)
	if err != nil {
		return nil, fmt.Errorf("failed to add note attendee: %w", err)
	}

	return a, nil
}

func (r *NoteAttendeeRepository) AddByUserID(noteID, userID string) error {
	query := `
		INSERT INTO note_attendees (note_id, email, user_id)
		SELECT $1, u.email, u.id FROM users u WHERE u.id = $2
		ON CONFLICT (note_id, email) DO UPDATE SET user_id = COALESCE(EXCLUDED.user_id, note_attendees.user_id)
	`
	_, err := r.db.Exec(query, noteID, userID)
	if err != nil {
		return fmt.Errorf("failed to add creator attendee: %w", err)
	}
	return nil
}

func (r *NoteAttendeeRepository) Remove(noteID, email string) (bool, error) {
	query := `DELETE FROM note_attendees WHERE note_id = $1 AND email = $2`

	res, err := r.db.Exec(query, noteID, email)
	if err != nil {
		return false, fmt.Errorf("failed to remove note attendee: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("failed to remove note attendee: %w", err)
	}

	return affected > 0, nil
}
