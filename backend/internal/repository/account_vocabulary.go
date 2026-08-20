package repository

import (
	"context"
	"database/sql"
	"time"

	"github.com/lib/pq"
	"github.com/mouizahmed/justscribe-backend/internal/database"
)

type AccountVocabulary struct {
	Terms     []string  `json:"terms"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type AccountVocabularyRepository struct {
	db *database.DB
}

func NewAccountVocabularyRepository(db *database.DB) *AccountVocabularyRepository {
	return &AccountVocabularyRepository{db: db}
}

func (r *AccountVocabularyRepository) Get(ctx context.Context, accountID string) (*AccountVocabulary, error) {
	vocabulary := &AccountVocabulary{Terms: []string{}}
	err := r.db.QueryRowContext(ctx, `
		SELECT terms, created_at, updated_at
		FROM public.account_vocabulary
		WHERE account_id = $1
	`, accountID).Scan(pq.Array(&vocabulary.Terms), &vocabulary.CreatedAt, &vocabulary.UpdatedAt)
	if err == sql.ErrNoRows {
		return vocabulary, nil
	}
	if err != nil {
		return nil, err
	}
	return vocabulary, nil
}

func (r *AccountVocabularyRepository) Put(ctx context.Context, accountID string, terms []string) (*AccountVocabulary, error) {
	vocabulary := &AccountVocabulary{Terms: terms}
	err := r.db.QueryRowContext(ctx, `
		INSERT INTO public.account_vocabulary (account_id, terms)
		VALUES ($1, $2)
		ON CONFLICT (account_id) DO UPDATE SET
			terms = EXCLUDED.terms,
			updated_at = now()
		RETURNING terms, created_at, updated_at
	`, accountID, pq.Array(terms)).Scan(
		pq.Array(&vocabulary.Terms),
		&vocabulary.CreatedAt,
		&vocabulary.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return vocabulary, nil
}
