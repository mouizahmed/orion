package repository

import (
	"database/sql"
	"fmt"

	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type NoteShareRepository struct {
	db *database.DB
}

func NewNoteShareRepository(db *database.DB) *NoteShareRepository {
	return &NoteShareRepository{db: db}
}

func scanNoteShare(row interface {
	Scan(dest ...interface{}) error
}) (*models.NoteShare, error) {
	var share models.NoteShare
	var userID sql.NullString
	if err := row.Scan(
		&share.ID,
		&share.NoteID,
		&share.SharedBy,
		&share.Email,
		&userID,
		&share.Role,
		&share.Status,
		&share.CreatedAt,
		&share.UpdatedAt,
	); err != nil {
		return nil, err
	}
	share.UserID = fromNullString(userID)
	return &share, nil
}

// ListSharesByNote returns all shares for a given note.
func (r *NoteShareRepository) ListSharesByNote(noteID string) ([]models.NoteShare, error) {
	query := `
		SELECT id, note_id, shared_by, email, user_id, role, status, created_at, updated_at
		FROM note_shares
		WHERE note_id = $1
		ORDER BY created_at ASC
	`

	rows, err := r.db.Query(query, noteID)
	if err != nil {
		return nil, fmt.Errorf("failed to list note shares: %w", err)
	}
	defer rows.Close()

	shares := []models.NoteShare{}
	for rows.Next() {
		share, err := scanNoteShare(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan note share: %w", err)
		}
		shares = append(shares, *share)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate note shares: %w", err)
	}

	return shares, nil
}

// UpsertShare inserts a new share or updates the role if a share for that email already exists.
func (r *NoteShareRepository) UpsertShare(noteID, sharedBy, email, role string) (*models.NoteShare, error) {
	query := `
		INSERT INTO note_shares (note_id, shared_by, email, role, status)
		VALUES ($1, $2, $3, $4, 'pending')
		ON CONFLICT (note_id, lower(btrim(email)))
		DO UPDATE SET
			role       = EXCLUDED.role,
			updated_at = NOW()
		RETURNING id, note_id, shared_by, email, user_id, role, status, created_at, updated_at
	`

	row := r.db.QueryRow(query, noteID, sharedBy, email, role)
	share, err := scanNoteShare(row)
	if err != nil {
		return nil, fmt.Errorf("failed to upsert note share: %w", err)
	}

	return share, nil
}

// UpdateShareRole updates the role of an existing share identified by (noteID, email).
func (r *NoteShareRepository) UpdateShareRole(noteID, email, role string) (*models.NoteShare, error) {
	query := `
		UPDATE note_shares
		SET role = $3, updated_at = NOW()
		WHERE note_id = $1 AND lower(btrim(email)) = lower(btrim($2))
		RETURNING id, note_id, shared_by, email, user_id, role, status, created_at, updated_at
	`

	row := r.db.QueryRow(query, noteID, email, role)
	share, err := scanNoteShare(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("share not found")
		}
		return nil, fmt.Errorf("failed to update note share: %w", err)
	}

	return share, nil
}

// DeleteShare removes a share identified by (noteID, email).
// Returns true if a row was deleted, false if not found.
func (r *NoteShareRepository) DeleteShare(noteID, email string) (bool, error) {
	query := `
		DELETE FROM note_shares
		WHERE note_id = $1 AND lower(btrim(email)) = lower(btrim($2))
	`

	res, err := r.db.Exec(query, noteID, email)
	if err != nil {
		return false, fmt.Errorf("failed to delete note share: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("failed to delete note share: %w", err)
	}

	return affected > 0, nil
}
