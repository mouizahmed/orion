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

func (r *UserRepository) CreateUser(user *models.User) error {
	if user.ID == "" {
		query := `
			INSERT INTO users (email, name, avatar_url, plan, status, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id
		`

		err := r.db.QueryRow(query,
			user.Email,
			user.Name,
			user.AvatarURL,
			user.Plan,
			user.Status,
			user.CreatedAt,
			user.UpdatedAt,
		).Scan(&user.ID)
		if err != nil {
			return fmt.Errorf("failed to create user: %w", err)
		}

		return nil
	}

	query := `
		INSERT INTO users (id, email, name, avatar_url, plan, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`

	_, err := r.db.Exec(query,
		user.ID,
		user.Email,
		user.Name,
		user.AvatarURL,
		user.Plan,
		user.Status,
		user.CreatedAt,
		user.UpdatedAt,
	)

	if err != nil {
		return fmt.Errorf("failed to create user: %w", err)
	}

	return nil
}

func (r *UserRepository) UpdateUser(id string, user *models.User) error {
	query := `
		UPDATE users 
		SET email = $2, name = $3, avatar_url = $4, plan = $5, status = $6, updated_at = $7
		WHERE id = $1
	`

	_, err := r.db.Exec(query,
		id,
		user.Email,
		user.Name,
		user.AvatarURL,
		user.Plan,
		user.Status,
		time.Now(),
	)

	if err != nil {
		return fmt.Errorf("failed to update user: %w", err)
	}

	return nil
}

func (r *UserRepository) UpdateName(id string, name string) error {
	query := `UPDATE users SET name = $2, updated_at = $3 WHERE id = $1 AND deleted_at IS NULL`

	result, err := r.db.Exec(query, id, name, time.Now())
	if err != nil {
		return fmt.Errorf("failed to update user name: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to confirm user name update: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("user not found")
	}

	return nil
}

func (r *UserRepository) UpdateAvatarURL(id string, avatarURL string) error {
	query := `UPDATE users SET avatar_url = $2, updated_at = $3 WHERE id = $1 AND deleted_at IS NULL`

	result, err := r.db.Exec(query, id, avatarURL, time.Now())
	if err != nil {
		return fmt.Errorf("failed to update user avatar: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to confirm user avatar update: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("user not found")
	}

	return nil
}

// GetUserByEmail finds a user by email address
func (r *UserRepository) GetUserByEmail(email string) (*models.User, error) {
	query := `SELECT u.id, u.email, u.name, u.avatar_url, u.plan, u.status, u.created_at, u.updated_at, u.deleted_at FROM users u WHERE lower(u.email) = lower($1) AND u.deleted_at IS NULL LIMIT 1`

	var user models.User
	err := r.db.QueryRow(query, email).Scan(
		&user.ID,
		&user.Email,
		&user.Name,
		&user.AvatarURL,
		&user.Plan,
		&user.Status,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.DeletedAt,
	)

	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("user not found")
	}

	if err != nil {
		return nil, fmt.Errorf("failed to get user by email: %w", err)
	}

	return &user, nil
}

func (r *UserRepository) DeleteUser(id string) error {
	query := `UPDATE users SET deleted_at = $2 WHERE id = $1`

	_, err := r.db.Exec(query, id, time.Now())
	if err != nil {
		return fmt.Errorf("failed to delete user: %w", err)
	}

	return nil
}

func (r *UserRepository) GetUserByID(id string) (*models.User, error) {
	// Use a completely different query structure to avoid prepared statement cache issues
	query := `SELECT u.id, u.email, u.name, u.avatar_url, u.plan, u.status, u.created_at, u.updated_at, u.deleted_at FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL LIMIT 1`

	var user models.User
	err := r.db.QueryRow(query, id).Scan(
		&user.ID,
		&user.Email,
		&user.Name,
		&user.AvatarURL,
		&user.Plan,
		&user.Status,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.DeletedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("user not found")
		}
		return nil, fmt.Errorf("failed to get user: %w", err)
	}

	return &user, nil
}
