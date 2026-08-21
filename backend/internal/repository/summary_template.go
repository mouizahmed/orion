package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/lib/pq"
	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

var (
	ErrSummaryTemplateNotFound          = errors.New("summary template not found")
	ErrSummaryTemplateFolderUnavailable = errors.New("summary template folder unavailable")
	ErrSummaryTemplateFolderConflict    = errors.New("summary template folder conflict")
	ErrSummaryTemplateNameConflict      = errors.New("summary template name conflict")
	ErrSummaryTemplateLimitReached      = errors.New("summary template limit reached")
)

const MaxSummaryTemplatesPerAccount = 100

type SummaryTemplateInput struct {
	Name      string
	Prompt    string
	FolderIDs []string
}

type SummaryTemplateRepository struct{ db *database.DB }

func NewSummaryTemplateRepository(db *database.DB) *SummaryTemplateRepository {
	return &SummaryTemplateRepository{db: db}
}

type summaryTemplateQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func scanSummaryTemplate(row interface{ Scan(...any) error }) (*models.SummaryTemplate, error) {
	template := &models.SummaryTemplate{Folders: []models.SummaryTemplateFolder{}}
	if err := row.Scan(&template.ID, &template.AccountID, &template.Name, &template.Prompt, &template.CreatedAt, &template.UpdatedAt); err != nil {
		return nil, err
	}
	return template, nil
}

func loadSummaryTemplateFolders(ctx context.Context, queryer summaryTemplateQuerier, accountID string, templates []*models.SummaryTemplate) error {
	if len(templates) == 0 {
		return nil
	}
	byID := make(map[string]*models.SummaryTemplate, len(templates))
	templateIDs := make([]string, 0, len(templates))
	for _, template := range templates {
		byID[template.ID] = template
		templateIDs = append(templateIDs, template.ID)
	}
	rows, err := queryer.QueryContext(ctx, `
		SELECT target.summary_template_id, target.folder_id, folder.name, folder.id IS NOT NULL
		FROM public.account_summary_template_folders AS target
		LEFT JOIN public.folders AS folder
		  ON folder.id = target.folder_id
		 AND folder.user_id = target.account_id
		 AND folder.deleted_at IS NULL
		WHERE target.account_id = $1 AND target.summary_template_id = ANY($2::uuid[])
		ORDER BY target.created_at, target.folder_id
	`, accountID, pq.Array(templateIDs))
	if err != nil {
		return fmt.Errorf("list summary template folders: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var templateID, folderID string
		var name sql.NullString
		var available bool
		if err := rows.Scan(&templateID, &folderID, &name, &available); err != nil {
			return fmt.Errorf("scan summary template folder: %w", err)
		}
		template := byID[templateID]
		if template == nil {
			continue
		}
		var folderName *string
		if name.Valid {
			value := name.String
			folderName = &value
		}
		template.Folders = append(template.Folders, models.SummaryTemplateFolder{ID: folderID, Name: folderName, Available: available})
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate summary template folders: %w", err)
	}
	return nil
}

func (r *SummaryTemplateRepository) List(ctx context.Context, accountID string) ([]models.SummaryTemplate, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, account_id, name, prompt, created_at, updated_at
		FROM public.account_summary_templates
		WHERE account_id = $1
		ORDER BY created_at, id
	`, accountID)
	if err != nil {
		return nil, fmt.Errorf("list summary templates: %w", err)
	}
	defer rows.Close()
	templatePointers := []*models.SummaryTemplate{}
	for rows.Next() {
		template, err := scanSummaryTemplate(rows)
		if err != nil {
			return nil, fmt.Errorf("scan summary template: %w", err)
		}
		templatePointers = append(templatePointers, template)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate summary templates: %w", err)
	}
	if err := loadSummaryTemplateFolders(ctx, r.db, accountID, templatePointers); err != nil {
		return nil, err
	}
	templates := make([]models.SummaryTemplate, 0, len(templatePointers))
	for _, template := range templatePointers {
		templates = append(templates, *template)
	}
	return templates, nil
}

func lockSummaryTemplateFolders(ctx context.Context, tx *sql.Tx, accountID string, folderIDs []string) error {
	rows, err := tx.QueryContext(ctx, `
		SELECT id
		FROM public.folders
		WHERE user_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])
		ORDER BY id
		FOR KEY SHARE
	`, accountID, pq.Array(folderIDs))
	if err != nil {
		return fmt.Errorf("validate summary template folders: %w", err)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		count++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("validate summary template folders: %w", err)
	}
	if count != len(folderIDs) {
		return ErrSummaryTemplateFolderUnavailable
	}
	return nil
}

func insertSummaryTemplateFolders(ctx context.Context, tx *sql.Tx, accountID, templateID string, folderIDs []string) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO public.account_summary_template_folders (summary_template_id, account_id, folder_id)
		SELECT $1, $2, folder_id FROM unnest($3::uuid[]) AS folder_id
	`, templateID, accountID, pq.Array(folderIDs))
	if err != nil {
		return translateSummaryTemplateError(fmt.Errorf("insert summary template folders: %w", err))
	}
	return nil
}

func translateSummaryTemplateError(err error) error {
	var pqErr *pq.Error
	if !errors.As(err, &pqErr) || pqErr.Code != "23505" {
		return err
	}
	switch pqErr.Constraint {
	case "account_summary_templates_account_name_idx":
		return ErrSummaryTemplateNameConflict
	case "account_summary_template_folders_one_template_per_folder":
		return ErrSummaryTemplateFolderConflict
	default:
		return err
	}
}

func loadSummaryTemplate(ctx context.Context, queryer summaryTemplateQuerier, accountID, templateID string) (*models.SummaryTemplate, error) {
	template, err := scanSummaryTemplate(queryer.QueryRowContext(ctx, `
		SELECT id, account_id, name, prompt, created_at, updated_at
		FROM public.account_summary_templates
		WHERE id = $1 AND account_id = $2
	`, templateID, accountID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSummaryTemplateNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := loadSummaryTemplateFolders(ctx, queryer, accountID, []*models.SummaryTemplate{template}); err != nil {
		return nil, err
	}
	return template, nil
}

func (r *SummaryTemplateRepository) Create(ctx context.Context, accountID string, input SummaryTemplateInput) (*models.SummaryTemplate, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin create summary template: %w", err)
	}
	defer tx.Rollback()
	var accountMarker string
	if err := tx.QueryRowContext(ctx, `
		SELECT id FROM public.accounts WHERE id = $1 FOR UPDATE
	`, accountID).Scan(&accountMarker); err != nil {
		return nil, fmt.Errorf("lock account for summary template create: %w", err)
	}
	var templateCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT count(*) FROM public.account_summary_templates WHERE account_id = $1
	`, accountID).Scan(&templateCount); err != nil {
		return nil, fmt.Errorf("count summary templates: %w", err)
	}
	if templateCount >= MaxSummaryTemplatesPerAccount {
		return nil, ErrSummaryTemplateLimitReached
	}
	if err := lockSummaryTemplateFolders(ctx, tx, accountID, input.FolderIDs); err != nil {
		return nil, err
	}
	var templateID string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO public.account_summary_templates (account_id, name, prompt)
		VALUES ($1, $2, $3)
		RETURNING id
	`, accountID, input.Name, input.Prompt).Scan(&templateID)
	if err != nil {
		return nil, translateSummaryTemplateError(fmt.Errorf("insert summary template: %w", err))
	}
	if err := insertSummaryTemplateFolders(ctx, tx, accountID, templateID, input.FolderIDs); err != nil {
		return nil, err
	}
	template, err := loadSummaryTemplate(ctx, tx, accountID, templateID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit create summary template: %w", err)
	}
	return template, nil
}

func (r *SummaryTemplateRepository) Update(ctx context.Context, accountID, templateID string, input SummaryTemplateInput) (*models.SummaryTemplate, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin update summary template: %w", err)
	}
	defer tx.Rollback()
	var marker string
	if err := tx.QueryRowContext(ctx, `
		SELECT id FROM public.account_summary_templates
		WHERE id = $1 AND account_id = $2
		FOR UPDATE
	`, templateID, accountID).Scan(&marker); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSummaryTemplateNotFound
	} else if err != nil {
		return nil, fmt.Errorf("lock summary template: %w", err)
	}
	if err := lockSummaryTemplateFolders(ctx, tx, accountID, input.FolderIDs); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE public.account_summary_templates
		SET name = $3, prompt = $4, updated_at = now()
		WHERE id = $1 AND account_id = $2
	`, templateID, accountID, input.Name, input.Prompt); err != nil {
		return nil, translateSummaryTemplateError(fmt.Errorf("update summary template: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM public.account_summary_template_folders
		WHERE summary_template_id = $1 AND account_id = $2
	`, templateID, accountID); err != nil {
		return nil, fmt.Errorf("replace summary template folders: %w", err)
	}
	if err := insertSummaryTemplateFolders(ctx, tx, accountID, templateID, input.FolderIDs); err != nil {
		return nil, err
	}
	template, err := loadSummaryTemplate(ctx, tx, accountID, templateID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit update summary template: %w", err)
	}
	return template, nil
}

func (r *SummaryTemplateRepository) Delete(ctx context.Context, accountID, templateID string) error {
	result, err := r.db.ExecContext(ctx, `
		DELETE FROM public.account_summary_templates WHERE id = $1 AND account_id = $2
	`, templateID, accountID)
	if err != nil {
		return fmt.Errorf("delete summary template: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete summary template: %w", err)
	}
	if affected == 0 {
		return ErrSummaryTemplateNotFound
	}
	return nil
}
