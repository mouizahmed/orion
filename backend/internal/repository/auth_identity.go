package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

var (
	ErrIdentityConflict      = errors.New("auth identity conflict")
	ErrAccountInactive       = errors.New("account is not active")
	ErrExternalPrincipalSync = errors.New("external auth principal synchronization failed")
)

type UserAuthIdentityRepository struct {
	db *database.DB
}

func NewUserAuthIdentityRepository(db *database.DB) *UserAuthIdentityRepository {
	return &UserAuthIdentityRepository{db: db}
}

// ResolveOrCreateUser atomically resolves a provider subject, updates its
// mutable profile metadata, and creates or links the application user. The
// immutable provider subject can never move between users.
func (r *UserAuthIdentityRepository) ResolveOrCreateUser(
	ctx context.Context,
	identity *models.UserAuthIdentity,
	email, name string,
	avatarURL *string,
	allowVerifiedEmailLink bool,
	beforeCommit func(*models.User) error,
) (*models.User, bool, error) {
	// Reuse one candidate ID across serialization retries. If the external auth
	// hook succeeds but the transaction must retry, Firebase sees the same UID
	// and the operation remains idempotent.
	candidateUserID := uuid.NewString()
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		user, created, err := r.resolveOrCreateUserOnce(
			ctx, identity, email, name, avatarURL, allowVerifiedEmailLink,
			candidateUserID, beforeCommit,
		)
		if err == nil || !isRetryableIdentityTransactionError(err) {
			return user, created, err
		}
		lastErr = err
		select {
		case <-ctx.Done():
			return nil, false, ctx.Err()
		case <-time.After(time.Duration(attempt+1) * 10 * time.Millisecond):
		}
	}
	return nil, false, fmt.Errorf("identity transaction retries exhausted: %w", lastErr)
}

func (r *UserAuthIdentityRepository) resolveOrCreateUserOnce(
	ctx context.Context,
	identity *models.UserAuthIdentity,
	email, name string,
	avatarURL *string,
	allowVerifiedEmailLink bool,
	candidateUserID string,
	beforeCommit func(*models.User) error,
) (*models.User, bool, error) {
	if identity == nil || identity.ProviderUserID == "" || email == "" || name == "" {
		return nil, false, fmt.Errorf("invalid OAuth identity")
	}
	email = strings.ToLower(strings.TrimSpace(email))

	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, false, fmt.Errorf("begin identity transaction: %w", err)
	}
	defer tx.Rollback()

	user, err := getUserForProviderSubjectTx(tx, identity)
	if err != nil {
		return nil, false, err
	}
	created := false
	if user == nil {
		user, err = getUserByNormalizedEmailTx(tx, email)
		if err != nil {
			return nil, false, err
		}
		if user != nil && !allowVerifiedEmailLink {
			return nil, false, ErrIdentityConflict
		}
	}

	if user == nil {
		user = &models.User{
			Email: email, Name: name, AvatarURL: avatarURL,
			Plan: models.UserPlanFree, Status: models.UserStatusActive,
			CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
		}
		user.ID = candidateUserID
		_, err = tx.ExecContext(ctx, `
			INSERT INTO users (id,email,name,avatar_url,plan,status,email_verified,created_at,updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		`, user.ID, user.Email, user.Name, user.AvatarURL, user.Plan, user.Status,
			identity.EmailVerified, user.CreatedAt, user.UpdatedAt)
		if err != nil {
			return nil, false, fmt.Errorf("create OAuth user: %w", err)
		}
		created = true
	} else {
		if user.DeletedAt != nil || user.Status != models.UserStatusActive {
			return nil, false, ErrAccountInactive
		}
		if identity.EmailVerified {
			user.Email = email
		}
		if user.Name == "" {
			user.Name = name
		}
		if avatarURL != nil {
			user.AvatarURL = avatarURL
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE users SET email=$2,name=$3,avatar_url=$4,email_verified=(email_verified OR $5),updated_at=now()
			WHERE id=$1
		`, user.ID, user.Email, user.Name, user.AvatarURL, identity.EmailVerified)
		if err != nil {
			return nil, false, fmt.Errorf("update OAuth user: %w", err)
		}
	}

	identity.UserID = user.ID
	result, err := tx.ExecContext(ctx, `
		INSERT INTO user_auth_identities (
			user_id,provider,provider_tenant_id,provider_user_id,provider_email,
			email_verified,display_name,avatar_url,created_at,updated_at,last_login_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now(),now(),now())
		ON CONFLICT (provider,provider_tenant_id,provider_user_id) DO UPDATE SET
			provider_email=EXCLUDED.provider_email,
			email_verified=EXCLUDED.email_verified,
			display_name=EXCLUDED.display_name,
			avatar_url=EXCLUDED.avatar_url,
			updated_at=now(),last_login_at=now()
		WHERE user_auth_identities.user_id=EXCLUDED.user_id
	`, identity.UserID, identity.Provider, identity.ProviderTenantID,
		identity.ProviderUserID, identity.ProviderEmail, identity.EmailVerified,
		identity.DisplayName, identity.AvatarURL)
	if err != nil {
		return nil, false, fmt.Errorf("persist OAuth identity: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil || rows != 1 {
		return nil, false, ErrIdentityConflict
	}
	// Firebase synchronization is part of provisioning, not a post-commit side
	// effect. A failure here rolls back both a newly created user and a newly
	// linked identity, so the database cannot advertise an unusable account.
	if beforeCommit != nil {
		if err := beforeCommit(user); err != nil {
			return nil, false, fmt.Errorf("%w: %w", ErrExternalPrincipalSync, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, false, fmt.Errorf("commit identity transaction: %w", err)
	}
	return user, created, nil
}

func isRetryableIdentityTransactionError(err error) bool {
	var postgresErr *pq.Error
	if !errors.As(err, &postgresErr) {
		return false
	}
	return postgresErr.Code == "40001" || postgresErr.Code == "40P01" || postgresErr.Code == "23505"
}

func getUserForProviderSubjectTx(tx *sql.Tx, identity *models.UserAuthIdentity) (*models.User, error) {
	row := tx.QueryRow(`
		SELECT u.id,u.email,u.name,u.avatar_url,u.plan,u.status,u.created_at,u.updated_at,u.deleted_at
		FROM user_auth_identities i JOIN users u ON u.id=i.user_id
		WHERE i.provider=$1 AND i.provider_tenant_id=$2 AND i.provider_user_id=$3
		FOR UPDATE OF i,u
	`, identity.Provider, identity.ProviderTenantID, identity.ProviderUserID)
	return scanOptionalAuthUser(row)
}

func getUserByNormalizedEmailTx(tx *sql.Tx, email string) (*models.User, error) {
	row := tx.QueryRow(`
		SELECT id,email,name,avatar_url,plan,status,created_at,updated_at,deleted_at
		FROM users WHERE lower(btrim(email))=$1 FOR UPDATE
	`, email)
	return scanOptionalAuthUser(row)
}

func scanOptionalAuthUser(row *sql.Row) (*models.User, error) {
	var user models.User
	err := row.Scan(&user.ID, &user.Email, &user.Name, &user.AvatarURL, &user.Plan,
		&user.Status, &user.CreatedAt, &user.UpdatedAt, &user.DeletedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load OAuth user: %w", err)
	}
	return &user, nil
}

func (r *UserAuthIdentityRepository) SetResolvedAvatar(ctx context.Context, userID string, identity *models.UserAuthIdentity, avatarURL string) error {
	if identity == nil || userID == "" || avatarURL == "" {
		return fmt.Errorf("invalid resolved avatar update")
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
		UPDATE users SET avatar_url=$2,updated_at=now()
		WHERE id=$1 AND status='active' AND deleted_at IS NULL
	`, userID, avatarURL); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE user_auth_identities SET avatar_url=$5,updated_at=now()
		WHERE user_id=$1 AND provider=$2 AND provider_tenant_id=$3 AND provider_user_id=$4
	`, userID, identity.Provider, identity.ProviderTenantID, identity.ProviderUserID, avatarURL); err != nil {
		return err
	}
	return tx.Commit()
}
