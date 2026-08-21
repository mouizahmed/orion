package repository

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/database"
)

var ErrEmailDraftSettingsNotFound = errors.New("email draft settings not found")

type EmailDraftSettings struct {
	Enabled            bool       `json:"enabled"`
	IncludeSharingLink bool       `json:"include_sharing_link"`
	DraftPrompt        string     `json:"draft_prompt"`
	CreatedAt          *time.Time `json:"created_at"`
	UpdatedAt          *time.Time `json:"updated_at"`
}

type EmailDraftSettingsPatch struct {
	Enabled            *bool
	IncludeSharingLink *bool
	DraftPrompt        *string
}

type EmailDraftSettingsRepository struct {
	db *database.DB
}

func NewEmailDraftSettingsRepository(db *database.DB) *EmailDraftSettingsRepository {
	return &EmailDraftSettingsRepository{db: db}
}

func scanEmailDraftSettings(row *sql.Row) (*EmailDraftSettings, error) {
	settings := &EmailDraftSettings{}
	var createdAt, updatedAt time.Time
	if err := row.Scan(
		&settings.Enabled,
		&settings.IncludeSharingLink,
		&settings.DraftPrompt,
		&createdAt,
		&updatedAt,
	); err != nil {
		return nil, err
	}
	settings.CreatedAt = &createdAt
	settings.UpdatedAt = &updatedAt
	return settings, nil
}

func (r *EmailDraftSettingsRepository) Get(ctx context.Context, accountID string) (*EmailDraftSettings, error) {
	settings, err := scanEmailDraftSettings(r.db.QueryRowContext(ctx, `
		SELECT enabled, include_sharing_link, draft_prompt, created_at, updated_at
		FROM public.account_email_draft_settings
		WHERE account_id = $1
	`, accountID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrEmailDraftSettingsNotFound
	}
	return settings, err
}

func (r *EmailDraftSettingsRepository) Patch(
	ctx context.Context,
	accountID string,
	patch EmailDraftSettingsPatch,
	defaultPrompt string,
) (*EmailDraftSettings, error) {
	return scanEmailDraftSettings(r.db.QueryRowContext(ctx, `
		INSERT INTO public.account_email_draft_settings (
			account_id,
			enabled,
			include_sharing_link,
			draft_prompt
		)
		VALUES (
			$1,
			COALESCE($2::boolean, true),
			COALESCE($3::boolean, true),
			COALESCE($4::text, $5)
		)
		ON CONFLICT (account_id) DO UPDATE SET
			enabled = COALESCE($2::boolean, account_email_draft_settings.enabled),
			include_sharing_link = COALESCE($3::boolean, account_email_draft_settings.include_sharing_link),
			draft_prompt = COALESCE($4::text, account_email_draft_settings.draft_prompt),
			updated_at = now()
		RETURNING enabled, include_sharing_link, draft_prompt, created_at, updated_at
	`, accountID, patch.Enabled, patch.IncludeSharingLink, patch.DraftPrompt, defaultPrompt))
}
