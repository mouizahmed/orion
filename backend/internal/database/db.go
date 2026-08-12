package database

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/lib/pq"
)

type DB struct {
	*sql.DB
}

var postgresIdentifier = regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)

type roleConnector struct {
	base driver.Connector
	role string
}

func (c *roleConnector) Connect(ctx context.Context) (driver.Conn, error) {
	connection, err := c.base.Connect(ctx)
	if err != nil {
		return nil, err
	}
	statement, err := connection.Prepare("SET ROLE " + c.role)
	if err != nil {
		connection.Close()
		return nil, err
	}
	defer statement.Close()
	if _, err := statement.Exec(nil); err != nil {
		connection.Close()
		return nil, err
	}
	return connection, nil
}

func (c *roleConnector) Driver() driver.Driver { return c.base.Driver() }

func connectionString(rawURL, role string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("DATABASE_URL must be a valid PostgreSQL URL")
	}
	if role == "" || !postgresIdentifier.MatchString(role) {
		return "", fmt.Errorf("DATABASE_ROLE must be a valid PostgreSQL identifier")
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

	role := strings.TrimSpace(os.Getenv("DATABASE_ROLE"))
	if role == "" {
		role = "orion_backend"
	}
	dbURL, err := connectionString(dbURL, role)
	if err != nil {
		return nil, err
	}

	baseConnector, err := pq.NewConnector(dbURL)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}
	db := sql.OpenDB(&roleConnector{base: baseConnector, role: role})

	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	var currentRole string
	if err := db.QueryRow("select current_user").Scan(&currentRole); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to verify database role: %w", err)
	}
	if currentRole != role {
		db.Close()
		return nil, fmt.Errorf("database role mismatch: expected %q, got %q", role, currentRole)
	}

	return &DB{db}, nil
}
