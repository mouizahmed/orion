package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	orionauth "github.com/mouizahmed/justscribe-backend/internal/auth"
	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type UserRepository struct {
	db *database.DB
}

func NewUserRepository(db *database.DB) *UserRepository {
	return &UserRepository{db: db}
}

// IsAuthSessionActive gives the backend an immediate logout guarantee without
// granting its database role general access to the managed Auth schema.
func (r *UserRepository) IsAuthSessionActive(ctx context.Context, userID, sessionID string) (bool, error) {
	var active bool
	if err := r.db.QueryRowContext(ctx, `
		SELECT orion_internal.is_auth_session_active($1::uuid, $2::uuid)
	`, userID, sessionID).Scan(&active); err != nil {
		return false, fmt.Errorf("check Supabase Auth session: %w", err)
	}
	return active, nil
}

// EnsureUserFromAuth idempotently provisions the application profile for an
// authoritative Supabase Auth UUID. Existing lifecycle state is never reset.
func (r *UserRepository) EnsureUserFromAuth(ctx context.Context, authUser *orionauth.SupabaseUser) (*models.User, bool, error) {
	if authUser == nil || strings.TrimSpace(authUser.ID) == "" || strings.TrimSpace(authUser.Email) == "" {
		return nil, false, fmt.Errorf("invalid Supabase Auth user")
	}
	email := strings.ToLower(strings.TrimSpace(authUser.Email))
	metadataName := metadataString(authUser.UserMetadata, "full_name", "name", "user_name", "preferred_username")
	name := metadataName
	if name == "" {
		name = strings.Split(email, "@")[0]
	}
	avatar := metadataString(authUser.UserMetadata, "avatar_url", "picture")
	var avatarURL *string
	if avatar != "" {
		avatarURL = &avatar
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, fmt.Errorf("begin user provisioning: %w", err)
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
		INSERT INTO users (id,email,name,avatar_url,email_verified)
		VALUES ($1,$2,$3,$4,$5)
		ON CONFLICT (id) DO NOTHING
	`, authUser.ID, email, name, avatarURL, authUser.EmailConfirmedAt != nil)
	if err != nil {
		return nil, false, fmt.Errorf("create application user: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return nil, false, fmt.Errorf("confirm application user: %w", err)
	}
	created := rows == 1

	if !created {
		if _, err := tx.ExecContext(ctx, `
			UPDATE users SET
				email=CASE WHEN $3 THEN $2 ELSE email END,
				email_verified=(email_verified OR $3),
				name=CASE
					WHEN $4 <> '' AND name=split_part(email, '@', 1) THEN $4
					ELSE name
				END,
				avatar_url=COALESCE(avatar_url, $5),
				updated_at=now()
			WHERE id=$1 AND status='active' AND deleted_at IS NULL
		`, authUser.ID, email, authUser.EmailConfirmedAt != nil, metadataName, avatarURL); err != nil {
			return nil, false, fmt.Errorf("refresh application user identity data: %w", err)
		}
	}
	user, err := scanUser(tx.QueryRowContext(ctx, `
		SELECT id,email,name,avatar_url,plan,status,created_at,updated_at,deleted_at
		FROM users WHERE id=$1 FOR UPDATE
	`, authUser.ID))
	if err != nil {
		return nil, false, fmt.Errorf("load provisioned user: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, false, fmt.Errorf("commit user provisioning: %w", err)
	}
	return user, created, nil
}

func metadataString(metadata map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := metadata[key].(string)
		if ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func (r *UserRepository) UpdateName(id, name string) error {
	result, err := r.db.Exec(`
		UPDATE users SET name=$2, updated_at=$3
		WHERE id=$1 AND status='active' AND deleted_at IS NULL
	`, id, name, time.Now().UTC())
	return requireOneUser(result, err, "name")
}

func (r *UserRepository) UpdateAvatarURL(id, avatarURL string) error {
	result, err := r.db.Exec(`
		UPDATE users SET avatar_url=$2, updated_at=$3
		WHERE id=$1 AND status='active' AND deleted_at IS NULL
	`, id, avatarURL, time.Now().UTC())
	return requireOneUser(result, err, "avatar")
}

// SetAvatarURLIfEmpty imports a provider avatar without replacing an avatar
// the user has already selected in Orion.
func (r *UserRepository) SetAvatarURLIfEmpty(id, avatarURL string) (bool, error) {
	result, err := r.db.Exec(`
		UPDATE users SET avatar_url=$2, updated_at=$3
		WHERE id=$1 AND status='active' AND deleted_at IS NULL
			AND (avatar_url IS NULL OR btrim(avatar_url)='')
	`, id, avatarURL, time.Now().UTC())
	if err != nil {
		return false, fmt.Errorf("failed to import user avatar: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("failed to confirm user avatar import: %w", err)
	}
	return rows == 1, nil
}

func requireOneUser(result sql.Result, err error, operation string) error {
	if err != nil {
		return fmt.Errorf("failed to update user %s: %w", operation, err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to confirm user %s update: %w", operation, err)
	}
	if rows != 1 {
		return fmt.Errorf("user not found or inactive")
	}
	return nil
}

func (r *UserRepository) GetUserByID(id string) (*models.User, error) {
	user, err := scanUser(r.db.QueryRow(`
		SELECT id,email,name,avatar_url,plan,status,created_at,updated_at,deleted_at
		FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL LIMIT 1
	`, id))
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	return user, nil
}

// GetUserByIDForAuthentication includes soft-deleted rows so authentication
// can distinguish a deleted account from a missing application identity.
func (r *UserRepository) GetUserByIDForAuthentication(id string) (*models.User, error) {
	user, err := scanUser(r.db.QueryRow(`
		SELECT id,email,name,avatar_url,plan,status,created_at,updated_at,deleted_at
		FROM users WHERE id=$1 LIMIT 1
	`, id))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user for authentication: %w", err)
	}
	return user, nil
}

func scanUser(row interface{ Scan(...interface{}) error }) (*models.User, error) {
	var user models.User
	err := row.Scan(&user.ID, &user.Email, &user.Name, &user.AvatarURL, &user.Plan,
		&user.Status, &user.CreatedAt, &user.UpdatedAt, &user.DeletedAt)
	return &user, err
}
