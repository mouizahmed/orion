package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

var ErrPersonExists = errors.New("person already exists")

type PersonRepository struct {
	db *database.DB
}

func NewPersonRepository(db *database.DB) *PersonRepository {
	return &PersonRepository{db: db}
}

func scanPerson(row interface {
	Scan(dest ...interface{}) error
}) (*models.Person, error) {
	var person models.Person
	if err := row.Scan(
		&person.ID,
		&person.UserID,
		&person.Name,
		&person.Email,
		&person.CreatedAt,
		&person.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &person, nil
}

func (r *PersonRepository) List(ctx context.Context, userID string) ([]models.Person, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("failed to begin people list: %w", err)
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx, `
		SELECT id, user_id, name, COALESCE(email, ''), created_at, updated_at
		FROM people
		WHERE user_id = $1
		ORDER BY lower(name), created_at, id
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list people: %w", err)
	}
	defer rows.Close()

	people := []models.Person{}
	for rows.Next() {
		person, err := scanPerson(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan person: %w", err)
		}
		people = append(people, *person)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate people: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit people list: %w", err)
	}
	return people, nil
}

func (r *PersonRepository) Create(ctx context.Context, userID, name, email string) (*models.Person, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin person creation: %w", err)
	}
	defer tx.Rollback()

	person, err := scanPerson(tx.QueryRowContext(ctx, `
		INSERT INTO people (user_id, name, email)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, lower(btrim(email))) WHERE btrim(email) <> ''
		DO NOTHING
		RETURNING id, user_id, name, email, created_at, updated_at
	`, userID, name, email))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrPersonExists
		}
		return nil, fmt.Errorf("failed to create person: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit person creation: %w", err)
	}
	return person, nil
}

func (r *PersonRepository) Delete(ctx context.Context, userID, personID string) (bool, error) {
	tx, err := r.db.BeginTenantTx(ctx, userID, nil)
	if err != nil {
		return false, fmt.Errorf("failed to begin person deletion: %w", err)
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `DELETE FROM people WHERE id = $1 AND user_id = $2`, personID, userID)
	if err != nil {
		return false, fmt.Errorf("failed to delete person: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("failed to inspect person deletion: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("failed to commit person deletion: %w", err)
	}
	return affected > 0, nil
}
