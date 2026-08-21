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
	ErrExtractFieldNotFound          = errors.New("extract field not found")
	ErrExtractFieldFolderUnavailable = errors.New("extract field folder unavailable")
	ErrExtractFieldNameConflict      = errors.New("extract field name conflict")
	ErrExtractFieldLimitReached      = errors.New("extract field limit reached")
)

const MaxExtractFieldsPerAccount = 100

type ExtractFieldInput struct {
	Name               string
	Prompt             string
	InsightCardinality string
	ScopeType          string
	FolderIDs          []string
}

type ExtractFieldRepository struct {
	db *database.DB
}

func NewExtractFieldRepository(db *database.DB) *ExtractFieldRepository {
	return &ExtractFieldRepository{db: db}
}

type extractFieldQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func newExtractFieldScope() models.ExtractFieldScope {
	return models.ExtractFieldScope{Type: models.ExtractScopeAllMeetings, Folders: []models.ExtractFieldFolder{}}
}

func scanExtractField(row interface{ Scan(...any) error }) (*models.ExtractField, error) {
	field := &models.ExtractField{Scope: newExtractFieldScope()}
	if err := row.Scan(
		&field.ID,
		&field.AccountID,
		&field.Name,
		&field.Prompt,
		&field.InsightCardinality,
		&field.CreatedAt,
		&field.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return field, nil
}

func loadExtractFieldFolders(ctx context.Context, queryer extractFieldQuerier, accountID string, fields []*models.ExtractField) error {
	if len(fields) == 0 {
		return nil
	}
	byID := make(map[string]*models.ExtractField, len(fields))
	fieldIDs := make([]string, 0, len(fields))
	for _, field := range fields {
		byID[field.ID] = field
		fieldIDs = append(fieldIDs, field.ID)
	}
	rows, err := queryer.QueryContext(ctx, `
		SELECT target.extract_field_id, target.folder_id, folder.name, folder.id IS NOT NULL
		FROM public.account_extract_field_folders AS target
		LEFT JOIN public.folders AS folder
		  ON folder.id = target.folder_id
		 AND folder.user_id = target.account_id
		 AND folder.deleted_at IS NULL
		WHERE target.account_id = $1 AND target.extract_field_id = ANY($2::uuid[])
		ORDER BY target.created_at, target.folder_id
	`, accountID, pq.Array(fieldIDs))
	if err != nil {
		return fmt.Errorf("list extract field folders: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var fieldID, folderID string
		var name sql.NullString
		var available bool
		if err := rows.Scan(&fieldID, &folderID, &name, &available); err != nil {
			return fmt.Errorf("scan extract field folder: %w", err)
		}
		field := byID[fieldID]
		if field == nil {
			continue
		}
		var folderName *string
		if name.Valid {
			value := name.String
			folderName = &value
		}
		field.Scope.Type = models.ExtractScopeFolders
		field.Scope.Folders = append(field.Scope.Folders, models.ExtractFieldFolder{
			ID: folderID, Name: folderName, Available: available,
		})
	}
	return rows.Err()
}

func (r *ExtractFieldRepository) List(ctx context.Context, accountID string) ([]models.ExtractField, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, account_id, name, prompt, insight_cardinality, created_at, updated_at
		FROM public.account_extract_fields
		WHERE account_id = $1
		ORDER BY created_at, id
	`, accountID)
	if err != nil {
		return nil, fmt.Errorf("list extract fields: %w", err)
	}
	defer rows.Close()
	fieldPointers := []*models.ExtractField{}
	for rows.Next() {
		field, err := scanExtractField(rows)
		if err != nil {
			return nil, fmt.Errorf("scan extract field: %w", err)
		}
		fieldPointers = append(fieldPointers, field)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate extract fields: %w", err)
	}
	if err := loadExtractFieldFolders(ctx, r.db, accountID, fieldPointers); err != nil {
		return nil, err
	}
	fields := make([]models.ExtractField, 0, len(fieldPointers))
	for _, field := range fieldPointers {
		fields = append(fields, *field)
	}
	return fields, nil
}

func lockExtractFolders(ctx context.Context, tx *sql.Tx, accountID string, folderIDs []string) error {
	if len(folderIDs) == 0 {
		return nil
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT id
		FROM public.folders
		WHERE user_id = $1 AND deleted_at IS NULL AND id = ANY($2::uuid[])
		ORDER BY id
		FOR KEY SHARE
	`, accountID, pq.Array(folderIDs))
	if err != nil {
		return fmt.Errorf("validate extract folders: %w", err)
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		count++
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("validate extract folders: %w", err)
	}
	if count != len(folderIDs) {
		return ErrExtractFieldFolderUnavailable
	}
	return nil
}

func insertExtractFieldFolders(ctx context.Context, tx *sql.Tx, accountID, fieldID string, folderIDs []string) error {
	if len(folderIDs) == 0 {
		return nil
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO public.account_extract_field_folders (extract_field_id, account_id, folder_id)
		SELECT $1, $2, folder_id
		FROM unnest($3::uuid[]) AS folder_id
	`, fieldID, accountID, pq.Array(folderIDs))
	if err != nil {
		return fmt.Errorf("insert extract field folders: %w", err)
	}
	return nil
}

func translateExtractFieldError(err error) error {
	var pqErr *pq.Error
	if errors.As(err, &pqErr) && pqErr.Code == "23505" && pqErr.Constraint == "account_extract_fields_account_name_idx" {
		return ErrExtractFieldNameConflict
	}
	return err
}

func loadExtractField(ctx context.Context, queryer extractFieldQuerier, accountID, fieldID string) (*models.ExtractField, error) {
	field, err := scanExtractField(queryer.QueryRowContext(ctx, `
		SELECT id, account_id, name, prompt, insight_cardinality, created_at, updated_at
		FROM public.account_extract_fields
		WHERE id = $1 AND account_id = $2
	`, fieldID, accountID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrExtractFieldNotFound
	}
	if err != nil {
		return nil, err
	}
	if err := loadExtractFieldFolders(ctx, queryer, accountID, []*models.ExtractField{field}); err != nil {
		return nil, err
	}
	return field, nil
}

func (r *ExtractFieldRepository) Create(ctx context.Context, accountID string, input ExtractFieldInput) (*models.ExtractField, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin create extract field: %w", err)
	}
	defer tx.Rollback()
	var accountMarker string
	if err := tx.QueryRowContext(ctx, `
		SELECT id FROM public.accounts WHERE id = $1 FOR UPDATE
	`, accountID).Scan(&accountMarker); err != nil {
		return nil, fmt.Errorf("lock account for extract field create: %w", err)
	}
	var fieldCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT count(*) FROM public.account_extract_fields WHERE account_id = $1
	`, accountID).Scan(&fieldCount); err != nil {
		return nil, fmt.Errorf("count extract fields: %w", err)
	}
	if fieldCount >= MaxExtractFieldsPerAccount {
		return nil, ErrExtractFieldLimitReached
	}
	if err := lockExtractFolders(ctx, tx, accountID, input.FolderIDs); err != nil {
		return nil, err
	}
	var fieldID string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO public.account_extract_fields (account_id, name, prompt, insight_cardinality)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, accountID, input.Name, input.Prompt, input.InsightCardinality).Scan(&fieldID)
	if err != nil {
		return nil, translateExtractFieldError(fmt.Errorf("insert extract field: %w", err))
	}
	if err := insertExtractFieldFolders(ctx, tx, accountID, fieldID, input.FolderIDs); err != nil {
		return nil, err
	}
	field, err := loadExtractField(ctx, tx, accountID, fieldID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit create extract field: %w", err)
	}
	return field, nil
}

func (r *ExtractFieldRepository) Update(ctx context.Context, accountID, fieldID string, input ExtractFieldInput) (*models.ExtractField, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin update extract field: %w", err)
	}
	defer tx.Rollback()
	var marker string
	if err := tx.QueryRowContext(ctx, `
		SELECT id FROM public.account_extract_fields
		WHERE id = $1 AND account_id = $2
		FOR UPDATE
	`, fieldID, accountID).Scan(&marker); errors.Is(err, sql.ErrNoRows) {
		return nil, ErrExtractFieldNotFound
	} else if err != nil {
		return nil, fmt.Errorf("lock extract field: %w", err)
	}
	if err := lockExtractFolders(ctx, tx, accountID, input.FolderIDs); err != nil {
		return nil, err
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE public.account_extract_fields
		SET name = $3, prompt = $4, insight_cardinality = $5, updated_at = now()
		WHERE id = $1 AND account_id = $2
	`, fieldID, accountID, input.Name, input.Prompt, input.InsightCardinality)
	if err != nil {
		return nil, translateExtractFieldError(fmt.Errorf("update extract field: %w", err))
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM public.account_extract_field_folders
		WHERE extract_field_id = $1 AND account_id = $2
	`, fieldID, accountID); err != nil {
		return nil, fmt.Errorf("replace extract field folders: %w", err)
	}
	if err := insertExtractFieldFolders(ctx, tx, accountID, fieldID, input.FolderIDs); err != nil {
		return nil, err
	}
	field, err := loadExtractField(ctx, tx, accountID, fieldID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit update extract field: %w", err)
	}
	return field, nil
}

func (r *ExtractFieldRepository) Delete(ctx context.Context, accountID, fieldID string) error {
	result, err := r.db.ExecContext(ctx, `
		DELETE FROM public.account_extract_fields
		WHERE id = $1 AND account_id = $2
	`, fieldID, accountID)
	if err != nil {
		return fmt.Errorf("delete extract field: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete extract field: %w", err)
	}
	if affected == 0 {
		return ErrExtractFieldNotFound
	}
	return nil
}
