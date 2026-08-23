package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/lib/pq"
	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/utils"
)

type IntegrationConnectionRepository interface {
	CreateOrUpdate(connection *models.IntegrationConnection) error
	GetByID(userID, connectionID string) (*models.IntegrationConnection, error)
	GetActiveByUser(userID string) ([]*models.IntegrationConnection, error)
	GetActiveByUserAndProvider(userID, provider string) ([]*models.IntegrationConnection, error)
	DeleteCredentials(userID, connectionID string) error
	DisconnectLocal(ctx context.Context, userID, connectionID string) ([]string, error)
	MarkNeedsReconnect(userID, connectionID string) error
	UpdateTokens(userID, connectionID string, updates *models.UpdateIntegrationConnectionTokensRequest) error
}

func (r *integrationConnectionRepository) DisconnectLocal(ctx context.Context, userID, connectionID string) ([]string, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin local disconnect: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO note_calendar_links (
			note_id, user_id, calendar_event_id, snapshot_event_id, provider_event_id,
			connection_id, calendar_id, provider, account_email, title, start_at, end_at,
			all_day, location, meeting_link, event_link, calendar_name, color,
			organizer_name, organizer_email, attendees_snapshot, created_at, updated_at
		)
		SELECT n.id, n.user_id, e.id, e.id, e.provider_event_id,
			e.connection_id, e.calendar_id, e.provider, e.account_email, e.title, e.start_at, e.end_at,
			e.all_day, e.location, e.meeting_link, e.event_link, e.calendar_name, e.color,
			e.organizer_name, e.organizer_email, e.attendees, now(), now()
		FROM notes n
		JOIN calendar_events e ON e.id = n.calendar_event_id AND e.user_id = n.user_id
		WHERE n.user_id = $1 AND e.connection_id = $2 AND n.deleted_at IS NULL
		ON CONFLICT (note_id) DO UPDATE SET
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
	`, userID, connectionID); err != nil {
		return nil, fmt.Errorf("failed to preserve linked event snapshots: %w", err)
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT note_id::text
		FROM note_calendar_links
		WHERE user_id = $1 AND connection_id = $2
		ORDER BY note_id
	`, userID, connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to list affected notes: %w", err)
	}
	var noteIDs []string
	for rows.Next() {
		var noteID string
		if err := rows.Scan(&noteID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("failed to scan affected note: %w", err)
		}
		noteIDs = append(noteIDs, noteID)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("failed to close affected notes: %w", err)
	}

	if len(noteIDs) > 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM note_attendees WHERE source = 'calendar' AND note_id = ANY($1)`, pq.Array(noteIDs)); err != nil {
			return nil, fmt.Errorf("failed to remove disconnected calendar attendees: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM note_attendee_suppressions WHERE note_id = ANY($1)`, pq.Array(noteIDs)); err != nil {
			return nil, fmt.Errorf("failed to remove disconnected attendee suppressions: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE notes SET calendar_event_id = NULL, updated_at = now() WHERE user_id = $1 AND calendar_event_id IN (SELECT id FROM calendar_events WHERE user_id = $1 AND connection_id = $2)`, userID, connectionID); err != nil {
		return nil, fmt.Errorf("failed to detach notes: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE note_calendar_links SET calendar_event_id = NULL, updated_at = now() WHERE user_id = $1 AND connection_id = $2`, userID, connectionID); err != nil {
		return nil, fmt.Errorf("failed to detach calendar snapshots: %w", err)
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM integration_connections WHERE user_id = $1 AND id = $2`, userID, connectionID)
	if err != nil {
		return nil, fmt.Errorf("failed to remove integration connection: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("failed to verify integration removal: %w", err)
	}
	if count != 1 {
		return nil, sql.ErrNoRows
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit local disconnect: %w", err)
	}
	return noteIDs, nil
}

type integrationConnectionRepository struct {
	db *database.DB
}

func NewIntegrationConnectionRepository(db *database.DB) IntegrationConnectionRepository {
	return &integrationConnectionRepository{db: db}
}

func (r *integrationConnectionRepository) CreateOrUpdate(connection *models.IntegrationConnection) error {
	encryptedAccessToken, err := utils.EncryptToken(connection.AccessToken)
	if err != nil {
		return err
	}

	var encryptedRefreshToken *string
	if connection.RefreshToken != nil {
		encrypted, err := utils.EncryptToken(*connection.RefreshToken)
		if err != nil {
			return err
		}
		encryptedRefreshToken = &encrypted
	}

	now := time.Now()
	if connection.ConnectedAt.IsZero() {
		connection.ConnectedAt = now
	}
	connection.UpdatedAt = now
	connection.EncryptionKeyVersion = utils.ActiveEncryptionKeyVersion()
	connection.Status = models.IntegrationConnectionStatusActive
	connection.DisconnectedAt = nil

	query := `
		INSERT INTO integration_connections (
			user_id, provider, provider_account_id, provider_email, display_name,
			access_token, refresh_token, encryption_key_version, expires_at, scopes, metadata, status,
			connected_at, updated_at, disconnected_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
		ON CONFLICT (user_id, provider, provider_account_id)
		DO UPDATE SET
			provider_email = EXCLUDED.provider_email,
			display_name = EXCLUDED.display_name,
			access_token = EXCLUDED.access_token,
			refresh_token = COALESCE(EXCLUDED.refresh_token, integration_connections.refresh_token),
			encryption_key_version = EXCLUDED.encryption_key_version,
			expires_at = EXCLUDED.expires_at,
			scopes = EXCLUDED.scopes,
			metadata = EXCLUDED.metadata,
			status = EXCLUDED.status,
			updated_at = EXCLUDED.updated_at,
			disconnected_at = NULL
		RETURNING id, connected_at, updated_at
	`

	return r.db.QueryRow(
		query,
		connection.UserID,
		connection.Provider,
		connection.ProviderAccountID,
		connection.ProviderEmail,
		connection.DisplayName,
		encryptedAccessToken,
		encryptedRefreshToken,
		connection.EncryptionKeyVersion,
		connection.ExpiresAt,
		connection.Scopes,
		connection.Metadata,
		connection.Status,
		connection.ConnectedAt,
		connection.UpdatedAt,
		connection.DisconnectedAt,
	).Scan(&connection.ID, &connection.ConnectedAt, &connection.UpdatedAt)
}

func (r *integrationConnectionRepository) GetByID(userID, connectionID string) (*models.IntegrationConnection, error) {
	query := `
		SELECT id, user_id, provider, provider_account_id, provider_email, display_name,
			access_token, refresh_token, encryption_key_version, expires_at, scopes, metadata, status,
			connected_at, updated_at, disconnected_at
		FROM integration_connections
		WHERE user_id = $1 AND id = $2
	`

	return r.scanConnection(r.db.QueryRow(query, userID, connectionID))
}

func (r *integrationConnectionRepository) GetActiveByUser(userID string) ([]*models.IntegrationConnection, error) {
	query := `
		SELECT id, user_id, provider, provider_account_id, provider_email, display_name,
			access_token, refresh_token, encryption_key_version, expires_at, scopes, metadata, status,
			connected_at, updated_at, disconnected_at
		FROM integration_connections
		WHERE user_id = $1 AND status = 'active'
		ORDER BY provider, provider_email, connected_at
	`

	return r.listConnections(query, userID)
}

func (r *integrationConnectionRepository) GetActiveByUserAndProvider(userID, provider string) ([]*models.IntegrationConnection, error) {
	query := `
		SELECT id, user_id, provider, provider_account_id, provider_email, display_name,
			access_token, refresh_token, encryption_key_version, expires_at, scopes, metadata, status,
			connected_at, updated_at, disconnected_at
		FROM integration_connections
		WHERE user_id = $1 AND provider = $2 AND status = 'active'
		ORDER BY provider_email, connected_at
	`

	return r.listConnections(query, userID, provider)
}

func (r *integrationConnectionRepository) DeleteCredentials(userID, connectionID string) error {
	result, err := r.db.Exec(`DELETE FROM integration_connections WHERE user_id = $1 AND id = $2`, userID, connectionID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows != 1 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *integrationConnectionRepository) MarkNeedsReconnect(userID, connectionID string) error {
	query := `
		UPDATE integration_connections
		SET status = 'needs_reconnect',
			disconnected_at = NULL,
			updated_at = $3
		WHERE user_id = $1 AND id = $2
	`

	_, err := r.db.Exec(query, userID, connectionID, time.Now())
	return err
}

func (r *integrationConnectionRepository) UpdateTokens(userID, connectionID string, updates *models.UpdateIntegrationConnectionTokensRequest) error {
	setParts := []string{}
	args := []interface{}{}
	argIndex := 1
	tokenUpdated := false

	if updates.AccessToken != nil {
		encryptedAccessToken, err := utils.EncryptToken(*updates.AccessToken)
		if err != nil {
			return err
		}
		setParts = append(setParts, fmt.Sprintf("access_token = $%d", argIndex))
		args = append(args, encryptedAccessToken)
		argIndex++
		tokenUpdated = true
	}

	if updates.RefreshToken != nil {
		encryptedRefreshToken, err := utils.EncryptToken(*updates.RefreshToken)
		if err != nil {
			return err
		}
		setParts = append(setParts, fmt.Sprintf("refresh_token = $%d", argIndex))
		args = append(args, encryptedRefreshToken)
		argIndex++
		tokenUpdated = true
	}

	if updates.ExpiresAt != nil {
		setParts = append(setParts, fmt.Sprintf("expires_at = $%d", argIndex))
		args = append(args, *updates.ExpiresAt)
		argIndex++
	}

	if updates.Scopes != nil {
		setParts = append(setParts, fmt.Sprintf("scopes = $%d", argIndex))
		args = append(args, *updates.Scopes)
		argIndex++
	}

	if len(setParts) == 0 {
		return nil
	}
	if tokenUpdated {
		setParts = append(setParts, fmt.Sprintf("encryption_key_version = $%d", argIndex))
		args = append(args, utils.ActiveEncryptionKeyVersion())
		argIndex++
	}

	setParts = append(setParts, "status = 'active'", "disconnected_at = NULL")
	setParts = append(setParts, fmt.Sprintf("updated_at = $%d", argIndex))
	args = append(args, time.Now())
	argIndex++

	args = append(args, userID, connectionID)

	query := "UPDATE integration_connections SET " + strings.Join(setParts, ", ") +
		fmt.Sprintf(" WHERE user_id = $%d AND id = $%d", argIndex, argIndex+1)

	_, err := r.db.Exec(query, args...)
	return err
}

func (r *integrationConnectionRepository) listConnections(query string, args ...interface{}) ([]*models.IntegrationConnection, error) {
	rows, err := r.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	connections := []*models.IntegrationConnection{}
	for rows.Next() {
		connection, err := scanIntegrationConnection(rows)
		if err != nil {
			return nil, err
		}
		connections = append(connections, connection)
	}

	return connections, rows.Err()
}

func (r *integrationConnectionRepository) scanConnection(row interface {
	Scan(dest ...interface{}) error
}) (*models.IntegrationConnection, error) {
	connection, err := scanIntegrationConnection(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return connection, nil
}

func scanIntegrationConnection(row interface {
	Scan(dest ...interface{}) error
}) (*models.IntegrationConnection, error) {
	var connection models.IntegrationConnection
	var encryptedAccessToken string
	var encryptedRefreshToken *string
	var metadata []byte

	err := row.Scan(
		&connection.ID,
		&connection.UserID,
		&connection.Provider,
		&connection.ProviderAccountID,
		&connection.ProviderEmail,
		&connection.DisplayName,
		&encryptedAccessToken,
		&encryptedRefreshToken,
		&connection.EncryptionKeyVersion,
		&connection.ExpiresAt,
		&connection.Scopes,
		&metadata,
		&connection.Status,
		&connection.ConnectedAt,
		&connection.UpdatedAt,
		&connection.DisconnectedAt,
	)
	if err != nil {
		return nil, err
	}

	decryptedAccessToken, err := utils.DecryptTokenAtVersion(encryptedAccessToken, connection.EncryptionKeyVersion)
	if err != nil {
		return nil, err
	}
	connection.AccessToken = decryptedAccessToken

	if encryptedRefreshToken != nil {
		decryptedRefreshToken, err := utils.DecryptTokenAtVersion(*encryptedRefreshToken, connection.EncryptionKeyVersion)
		if err != nil {
			return nil, err
		}
		connection.RefreshToken = &decryptedRefreshToken
	}

	if len(metadata) > 0 {
		raw := json.RawMessage(metadata)
		connection.Metadata = &raw
	}

	return &connection, nil
}
