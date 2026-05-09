package repository

import (
	"database/sql"
	"fmt"
	"strings"

	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type FolderRepository struct {
	db *database.DB
}

func NewFolderRepository(db *database.DB) *FolderRepository {
	return &FolderRepository{db: db}
}

func (r *FolderRepository) ExistsForUser(folderID, userID string) (bool, error) {
	query := `
		SELECT 1
		FROM folders
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
		LIMIT 1
	`

	var marker int
	err := r.db.QueryRow(query, folderID, userID).Scan(&marker)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("failed to check folder: %w", err)
	}
	return true, nil
}

func (r *FolderRepository) ListFolders(userID string) ([]models.Folder, error) {
	query := `
		SELECT f.id, f.user_id, f.name, f.created_at, f.updated_at, f.deleted_at,
		       COUNT(n.id) AS note_count
		FROM folders f
		LEFT JOIN notes n ON n.folder_id = f.id AND n.deleted_at IS NULL
		WHERE f.user_id = $1 AND f.deleted_at IS NULL
		GROUP BY f.id
		ORDER BY f.name ASC
	`

	rows, err := r.db.Query(query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to list folders: %w", err)
	}
	defer rows.Close()

	folders := []models.Folder{}
	for rows.Next() {
		var folder models.Folder
		var deleted sql.NullTime
		if err := rows.Scan(
			&folder.ID,
			&folder.UserID,
			&folder.Name,
			&folder.CreatedAt,
			&folder.UpdatedAt,
			&deleted,
			&folder.NoteCount,
		); err != nil {
			return nil, fmt.Errorf("failed to scan folder: %w", err)
		}
		folder.DeletedAt = fromNullTime(deleted)
		folders = append(folders, folder)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to list folders: %w", err)
	}

	return folders, nil
}

func (r *FolderRepository) CreateFolder(userID, name string) (*models.Folder, error) {
	query := `
		INSERT INTO folders (user_id, name)
		VALUES ($1, $2)
		RETURNING id, user_id, name, created_at, updated_at, deleted_at
	`

	var folder models.Folder
	var deleted sql.NullTime
	err := r.db.QueryRow(query, userID, name).Scan(
		&folder.ID,
		&folder.UserID,
		&folder.Name,
		&folder.CreatedAt,
		&folder.UpdatedAt,
		&deleted,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create folder: %w", err)
	}
	folder.DeletedAt = fromNullTime(deleted)
	return &folder, nil
}

func (r *FolderRepository) RenameFolder(userID, folderID, name string) (*models.Folder, error) {
	query := `
		UPDATE folders
		SET name = $3, updated_at = NOW()
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
		RETURNING id, user_id, name, created_at, updated_at, deleted_at
	`

	var folder models.Folder
	var deleted sql.NullTime
	err := r.db.QueryRow(query, folderID, userID, name).Scan(
		&folder.ID,
		&folder.UserID,
		&folder.Name,
		&folder.CreatedAt,
		&folder.UpdatedAt,
		&deleted,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("folder not found")
		}
		return nil, fmt.Errorf("failed to rename folder: %w", err)
	}
	folder.DeletedAt = fromNullTime(deleted)
	return &folder, nil
}

func (r *FolderRepository) DeleteFolder(userID, folderID string) (bool, error) {
	query := `
		UPDATE folders
		SET deleted_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`

	res, err := r.db.Exec(query, folderID, userID)
	if err != nil {
		return false, fmt.Errorf("failed to delete folder: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("failed to delete folder: %w", err)
	}
	return affected > 0, nil
}

func (r *FolderRepository) SearchFolders(userID, query string, limit, offset int) ([]models.Folder, error) {
	search := strings.TrimSpace(query)
	if search == "" {
		return []models.Folder{}, nil
	}
	if limit <= 0 {
		limit = 10
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	pattern := "%" + search + "%"
	sqlQuery := `
		SELECT id, user_id, name, created_at, updated_at, deleted_at
		FROM folders
		WHERE user_id = $1
			AND deleted_at IS NULL
			AND name ILIKE $2
		ORDER BY name ASC, id ASC
		LIMIT $3
		OFFSET $4
	`

	rows, err := r.db.Query(sqlQuery, userID, pattern, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to search folders: %w", err)
	}
	defer rows.Close()

	folders := []models.Folder{}
	for rows.Next() {
		var folder models.Folder
		var deleted sql.NullTime
		if err := rows.Scan(
			&folder.ID,
			&folder.UserID,
			&folder.Name,
			&folder.CreatedAt,
			&folder.UpdatedAt,
			&deleted,
		); err != nil {
			return nil, fmt.Errorf("failed to scan folder search row: %w", err)
		}
		folder.DeletedAt = fromNullTime(deleted)
		folders = append(folders, folder)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate folder search rows: %w", err)
	}

	return folders, nil
}
