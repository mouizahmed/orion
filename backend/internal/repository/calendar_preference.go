package repository

import (
	"context"
	"database/sql"

	"github.com/mouizahmed/justscribe-backend/internal/database"
)

type CalendarPreferenceRepository interface {
	GetVisibleCalendarIDs(userID string, connectionID string) (map[string]bool, error)
	UpsertVisibility(userID string, connectionID string, calendarID string, visible bool) error
}

type calendarPreferenceRepository struct {
	db *database.DB
}

func NewCalendarPreferenceRepository(db *database.DB) CalendarPreferenceRepository {
	return &calendarPreferenceRepository{db: db}
}

func (r *calendarPreferenceRepository) GetVisibleCalendarIDs(userID string, connectionID string) (map[string]bool, error) {
	query := `
		SELECT calendar_id, visible
		FROM calendar_preferences
		WHERE user_id = $1 AND connection_id = $2
	`

	tx, err := r.db.BeginTenantTx(context.Background(), userID, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.Query(query, userID, connectionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	visibility := map[string]bool{}
	for rows.Next() {
		var calendarID string
		var visible bool
		if err := rows.Scan(&calendarID, &visible); err != nil {
			return nil, err
		}
		visibility[calendarID] = visible
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return visibility, nil
}

func (r *calendarPreferenceRepository) UpsertVisibility(userID string, connectionID string, calendarID string, visible bool) error {
	query := `
		INSERT INTO calendar_preferences (user_id, connection_id, calendar_id, visible, created_at, updated_at)
		VALUES ($1, $2, $3, $4, now(), now())
		ON CONFLICT (user_id, connection_id, calendar_id)
		DO UPDATE SET
			visible = EXCLUDED.visible,
			updated_at = EXCLUDED.updated_at
	`

	tx, err := r.db.BeginTenantTx(context.Background(), userID, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(query, userID, connectionID, calendarID, visible); err != nil {
		return err
	}
	return tx.Commit()
}
