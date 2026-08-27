package database

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

type DB struct {
	*sql.DB
}

func (db *DB) BeginTenantTx(ctx context.Context, userID string, options *sql.TxOptions) (*sql.Tx, error) {
	if _, err := uuid.Parse(userID); err != nil {
		return nil, fmt.Errorf("invalid tenant ID")
	}
	tx, err := db.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `SELECT set_config('app.current_user_id', $1, true)`, userID); err != nil {
		_ = tx.Rollback()
		return nil, fmt.Errorf("failed to bind database tenant: %w", err)
	}
	return tx, nil
}

const backendDatabaseRole = "orion_backend"

func connectionString(rawURL string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("DATABASE_URL must be a valid PostgreSQL URL")
	}

	query := parsed.Query()
	query.Set("application_name", "orion_backend")
	query.Set("options", "-c statement_timeout=5000")
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func New() (*DB, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	dbURL, err := connectionString(dbURL)
	if err != nil {
		return nil, err
	}

	baseConnector, err := pq.NewConnector(dbURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}
	db := sql.OpenDB(baseConnector)

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	var sessionRole, currentRole string
	if err := db.QueryRow("select session_user, current_user").Scan(&sessionRole, &currentRole); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to verify database role: %w", err)
	}
	if sessionRole != backendDatabaseRole || currentRole != backendDatabaseRole {
		db.Close()
		return nil, fmt.Errorf(
			"DATABASE_URL must authenticate directly as %q (session_user=%q, current_user=%q)",
			backendDatabaseRole,
			sessionRole,
			currentRole,
		)
	}

	return &DB{db}, nil
}
