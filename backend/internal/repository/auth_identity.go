package repository

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type UserAuthIdentityRepository struct {
	db *database.DB
}

func NewUserAuthIdentityRepository(db *database.DB) *UserAuthIdentityRepository {
	return &UserAuthIdentityRepository{db: db}
}

func (r *UserAuthIdentityRepository) GetByProviderSubject(provider models.AuthProvider, providerUserID string) (*models.UserAuthIdentity, error) {
	query := `
		SELECT id, user_id, provider, provider_user_id, provider_email, email_verified,
			display_name, avatar_url, raw_claims, created_at, updated_at, last_login_at
		FROM user_auth_identities
		WHERE provider = $1 AND provider_user_id = $2
		LIMIT 1
	`

	var identity models.UserAuthIdentity
	var rawClaims sql.NullString
	err := r.db.QueryRow(query, provider, providerUserID).Scan(
		&identity.ID,
		&identity.UserID,
		&identity.Provider,
		&identity.ProviderUserID,
		&identity.ProviderEmail,
		&identity.EmailVerified,
		&identity.DisplayName,
		&identity.AvatarURL,
		&rawClaims,
		&identity.CreatedAt,
		&identity.UpdatedAt,
		&identity.LastLoginAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get auth identity: %w", err)
	}
	if rawClaims.Valid {
		identity.RawClaims = []byte(rawClaims.String)
	}

	return &identity, nil
}

func (r *UserAuthIdentityRepository) Upsert(identity *models.UserAuthIdentity) error {
	query := `
		INSERT INTO user_auth_identities (
			user_id, provider, provider_user_id, provider_email, email_verified,
			display_name, avatar_url, raw_claims, created_at, updated_at, last_login_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), now())
		ON CONFLICT (provider, provider_user_id)
		DO UPDATE SET
			user_id = EXCLUDED.user_id,
			provider_email = EXCLUDED.provider_email,
			email_verified = EXCLUDED.email_verified,
			display_name = EXCLUDED.display_name,
			avatar_url = EXCLUDED.avatar_url,
			raw_claims = EXCLUDED.raw_claims,
			updated_at = now(),
			last_login_at = now()
	`

	_, err := r.db.Exec(query,
		identity.UserID,
		identity.Provider,
		identity.ProviderUserID,
		identity.ProviderEmail,
		identity.EmailVerified,
		identity.DisplayName,
		identity.AvatarURL,
		identity.RawClaims,
	)
	if err != nil {
		return fmt.Errorf("failed to upsert auth identity: %w", err)
	}

	return nil
}

func (r *UserAuthIdentityRepository) UpsertForUserProvider(identity *models.UserAuthIdentity) error {
	query := `
		INSERT INTO user_auth_identities (
			user_id, provider, provider_user_id, provider_email, email_verified,
			display_name, avatar_url, raw_claims, created_at, updated_at, last_login_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now(), now())
		ON CONFLICT (user_id, provider)
		DO UPDATE SET
			provider_user_id = EXCLUDED.provider_user_id,
			provider_email = EXCLUDED.provider_email,
			email_verified = EXCLUDED.email_verified,
			display_name = EXCLUDED.display_name,
			avatar_url = EXCLUDED.avatar_url,
			raw_claims = EXCLUDED.raw_claims,
			updated_at = now(),
			last_login_at = now()
	`

	_, err := r.db.Exec(query,
		identity.UserID,
		identity.Provider,
		identity.ProviderUserID,
		identity.ProviderEmail,
		identity.EmailVerified,
		identity.DisplayName,
		identity.AvatarURL,
		identity.RawClaims,
	)
	if err != nil {
		return fmt.Errorf("failed to upsert auth identity for user provider: %w", err)
	}

	return nil
}
