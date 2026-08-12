package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type UserRepository struct {
	db *database.DB
}

func NewUserRepository(db *database.DB) *UserRepository {
	return &UserRepository{db: db}
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
