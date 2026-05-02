package repository

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/utils"
)

type IntegrationConnectionRepository interface {
	CreateOrUpdate(connection *models.IntegrationConnection) error
	GetByID(userID, connectionID string) (*models.IntegrationConnection, error)
	GetActiveByUser(userID string) ([]*models.IntegrationConnection, error)
	GetActiveByUserAndProvider(userID, provider string) ([]*models.IntegrationConnection, error)
	SoftDisconnect(userID, connectionID string) error
	MarkNeedsReconnect(userID, connectionID string) error
	UpdateTokens(userID, connectionID string, updates *models.UpdateIntegrationConnectionTokensRequest) error
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
	connection.Status = models.IntegrationConnectionStatusActive
	connection.DisconnectedAt = nil

	query := `
		INSERT INTO integration_connections (
			user_id, provider, provider_account_id, provider_email, display_name,
			access_token, refresh_token, expires_at, scopes, metadata, status,
			connected_at, updated_at, disconnected_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		ON CONFLICT (user_id, provider, provider_account_id)
		DO UPDATE SET
			provider_email = EXCLUDED.provider_email,
			display_name = EXCLUDED.display_name,
			access_token = EXCLUDED.access_token,
			refresh_token = COALESCE(EXCLUDED.refresh_token, integration_connections.refresh_token),
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
			access_token, refresh_token, expires_at, scopes, metadata, status,
			connected_at, updated_at, disconnected_at
		FROM integration_connections
		WHERE user_id = $1 AND id = $2
	`

	return r.scanConnection(r.db.QueryRow(query, userID, connectionID))
}

func (r *integrationConnectionRepository) GetActiveByUser(userID string) ([]*models.IntegrationConnection, error) {
	query := `
		SELECT id, user_id, provider, provider_account_id, provider_email, display_name,
			access_token, refresh_token, expires_at, scopes, metadata, status,
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
			access_token, refresh_token, expires_at, scopes, metadata, status,
			connected_at, updated_at, disconnected_at
		FROM integration_connections
		WHERE user_id = $1 AND provider = $2 AND status = 'active'
		ORDER BY provider_email, connected_at
	`

	return r.listConnections(query, userID, provider)
}

func (r *integrationConnectionRepository) SoftDisconnect(userID, connectionID string) error {
	query := `
		UPDATE integration_connections
		SET status = 'disconnected',
			disconnected_at = $3,
			updated_at = $3
		WHERE user_id = $1 AND id = $2
	`

	_, err := r.db.Exec(query, userID, connectionID, time.Now())
	return err
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

	if updates.AccessToken != nil {
		encryptedAccessToken, err := utils.EncryptToken(*updates.AccessToken)
		if err != nil {
			return err
		}
		setParts = append(setParts, fmt.Sprintf("access_token = $%d", argIndex))
		args = append(args, encryptedAccessToken)
		argIndex++
	}

	if updates.RefreshToken != nil {
		encryptedRefreshToken, err := utils.EncryptToken(*updates.RefreshToken)
		if err != nil {
			return err
		}
		setParts = append(setParts, fmt.Sprintf("refresh_token = $%d", argIndex))
		args = append(args, encryptedRefreshToken)
		argIndex++
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

	decryptedAccessToken, err := utils.DecryptToken(encryptedAccessToken)
	if err != nil {
		return nil, err
	}
	connection.AccessToken = decryptedAccessToken

	if encryptedRefreshToken != nil {
		decryptedRefreshToken, err := utils.DecryptToken(*encryptedRefreshToken)
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
