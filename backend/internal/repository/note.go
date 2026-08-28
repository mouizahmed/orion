package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/lib/pq"
	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

var (
	ErrNoteNotFound          = errors.New("note not found")
	ErrNoteRevisionConflict  = errors.New("note revision conflict")
	ErrCalendarEventNotFound = errors.New("calendar event not found")
	ErrCalendarEventLinked   = errors.New("calendar event already linked")
)

type NoteRepository struct {
	db *database.DB
}

type NoteActivityQuery struct {
	Sort            string
	Direction       string
	Limit           int
	CursorSortValue *string
	CursorID        *string
}

func NewNoteRepository(db *database.DB) *NoteRepository {
	return &NoteRepository{db: db}
}

func (r *NoteRepository) CreateNote(note *models.Note) (*models.Note, error) {
	tx, err := r.db.BeginTenantTx(context.Background(), note.UserID, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin note creation: %w", err)
	}
	defer tx.Rollback()

	query := `
		INSERT INTO notes (user_id, folder_id, title, note_markdown, calendar_event_id)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, user_id, folder_id, title, note_markdown, created_at, updated_at, deleted_at,
		          calendar_event_id::text, revision
	`

	folderID := toNullString(note.FolderID)
	calendarEventID := toNullString(note.CalendarEventID)

	var created models.Note
	var folder, calEvID sql.NullString
	var deleted sql.NullTime
	err = tx.QueryRow(
		query,
		note.UserID,
		folderID,
		note.Title,
		note.NoteMarkdown,
		calendarEventID,
	).Scan(
		&created.ID,
		&created.UserID,
		&folder,
		&created.Title,
		&created.NoteMarkdown,
		&created.CreatedAt,
		&created.UpdatedAt,
		&deleted,
		&calEvID,
		&created.Revision,
	)
	if err != nil {
		if isConstraintViolation(err, "notes_one_per_event_idx") {
			return nil, ErrCalendarEventLinked
		}
		return nil, fmt.Errorf("failed to create note: %w", err)
	}

	creator, err := scanNoteAttendee(tx.QueryRow(`
		INSERT INTO note_attendees (note_id, email, display_name, source)
		SELECT $1, u.email, COALESCE(u.name, ''), 'manual'
		FROM users u
		WHERE u.id = $2
		ON CONFLICT (note_id, lower(btrim(email))) DO UPDATE SET
			display_name = CASE
				WHEN btrim(EXCLUDED.display_name) <> '' THEN EXCLUDED.display_name
				ELSE note_attendees.display_name
			END,
			source = 'manual'
		RETURNING id, note_id, email, display_name, source, created_at
	`, created.ID, note.UserID))
	if err != nil {
		return nil, fmt.Errorf("failed to add note creator: %w", err)
	}
	created.Attendees = []models.NoteAttendee{*creator}

	if created.CalendarEventID != nil {
		if err := upsertNoteCalendarSnapshot(tx, created.ID, note.UserID, *created.CalendarEventID); err != nil {
			return nil, err
		}
		if err := reconcileCalendarAttendeesTx(tx, created.ID, note.UserID, *created.CalendarEventID); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit note creation: %w", err)
	}

	created.FolderID = fromNullString(folder)
	created.DeletedAt = fromNullTime(deleted)
	created.CalendarEventID = fromNullString(calEvID)
	return &created, nil
}

func (r *NoteRepository) ListNotesByUserCursor(userID string, folderID *string, unfiled bool, limit int, cursorUpdatedAt *time.Time, cursorID *string) ([]models.NoteSummary, error) {
	baseQuery := `
		SELECT id, folder_id, title, created_at, updated_at, calendar_event_id::text
		FROM notes
		WHERE user_id = $1 AND deleted_at IS NULL
	`

	var rows *sql.Rows
	var err error
	args := []interface{}{userID}
	argPos := 2
	if unfiled {
		baseQuery += " AND folder_id IS NULL"
	} else if folderID != nil {
		baseQuery += fmt.Sprintf(" AND folder_id = $%d", argPos)
		args = append(args, *folderID)
		argPos++
	}
	if cursorUpdatedAt != nil && cursorID != nil && *cursorID != "" {
		baseQuery += fmt.Sprintf(" AND (updated_at, id) < ($%d, $%d)", argPos, argPos+1)
		args = append(args, *cursorUpdatedAt, *cursorID)
		argPos += 2
	}
	baseQuery += fmt.Sprintf(" ORDER BY updated_at DESC, id DESC LIMIT $%d", argPos)
	args = append(args, limit)

	rows, err = r.db.Query(baseQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list notes: %w", err)
	}
	defer rows.Close()

	notes := []models.NoteSummary{}
	for rows.Next() {
		var note models.NoteSummary
		var folder, calEvID sql.NullString
		if err := rows.Scan(
			&note.ID,
			&folder,
			&note.Title,
			&note.CreatedAt,
			&note.UpdatedAt,
			&calEvID,
		); err != nil {
			return nil, fmt.Errorf("failed to scan note: %w", err)
		}
		note.FolderID = fromNullString(folder)
		note.CalendarEventID = fromNullString(calEvID)
		notes = append(notes, note)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to list notes: %w", err)
	}

	return notes, nil
}

func (r *NoteRepository) GetNoteDetailByID(userID, noteID string) (*models.NoteDetail, error) {
	tx, err := r.db.BeginTenantTx(context.Background(), userID, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, fmt.Errorf("failed to begin note detail read: %w", err)
	}
	defer tx.Rollback()
	query := `
		SELECT
			n.id, n.folder_id, n.title, n.note_markdown, n.created_at, n.updated_at,
			n.calendar_event_id::text, n.revision,
			l.snapshot_event_id::text, l.provider, l.connection_id::text, l.calendar_id, l.provider_event_id,
			l.title, l.start_at, l.end_at, l.all_day,
			COALESCE(l.color, ''), COALESCE(l.calendar_name, ''),
			COALESCE(l.meeting_link, ''), COALESCE(l.event_link, ''),
			COALESCE(l.location, ''), COALESCE(l.organizer_name, ''), COALESCE(l.organizer_email, ''),
			l.calendar_event_id IS NULL,
			COALESCE(l.attendees_snapshot, '[]'::jsonb)
		FROM notes n
		LEFT JOIN note_calendar_links l ON l.note_id = n.id AND l.user_id = n.user_id
		WHERE n.id = $1 AND n.user_id = $2 AND n.deleted_at IS NULL
		LIMIT 1
	`

	var detail models.NoteDetail
	var folder, calEvID sql.NullString
	var evID, evProvider, evConnID, evCalID, evProvEventID sql.NullString
	var evTitle sql.NullString
	var evStart, evEnd sql.NullTime
	var evAllDay sql.NullBool
	var evColor, evCalName, evMeetingLink, evEventLink, evLocation, evOrganizerName, evOrganizerEmail sql.NullString
	var evHistorical sql.NullBool
	var evAttendeesJSON []byte

	err = tx.QueryRow(query, noteID, userID).Scan(
		&detail.ID, &folder, &detail.Title, &detail.NoteMarkdown, &detail.CreatedAt, &detail.UpdatedAt,
		&calEvID, &detail.Revision,
		&evID, &evProvider, &evConnID, &evCalID, &evProvEventID,
		&evTitle, &evStart, &evEnd, &evAllDay,
		&evColor, &evCalName, &evMeetingLink, &evEventLink, &evLocation, &evOrganizerName, &evOrganizerEmail,
		&evHistorical,
		&evAttendeesJSON,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("note not found")
		}
		return nil, fmt.Errorf("failed to get note: %w", err)
	}

	detail.FolderID = fromNullString(folder)
	detail.CalendarEventID = fromNullString(calEvID)

	if evID.Valid {
		attendees := []models.CalendarAttendee{}
		_ = json.Unmarshal(evAttendeesJSON, &attendees)
		detail.LinkedEvent = &models.LinkedEventDetail{
			ID:              evID.String,
			Provider:        evProvider.String,
			ConnectionID:    evConnID.String,
			CalendarID:      evCalID.String,
			ProviderEventID: evProvEventID.String,
			Title:           evTitle.String,
			Start:           evStart.Time,
			End:             evEnd.Time,
			AllDay:          evAllDay.Bool,
			Color:           evColor.String,
			CalendarName:    evCalName.String,
			MeetingLink:     evMeetingLink.String,
			EventLink:       evEventLink.String,
			Location:        evLocation.String,
			OrganizerName:   evOrganizerName.String,
			OrganizerEmail:  evOrganizerEmail.String,
			Historical:      evHistorical.Bool,
			Attendees:       attendees,
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to finish note detail read: %w", err)
	}
	return &detail, nil
}

func (r *NoteRepository) ListActivityNotesByUser(userID string, query NoteActivityQuery) ([]models.Note, error) {
	sortColumn := "updated_at"
	sortExpression := "updated_at"
	switch query.Sort {
	case "created":
		sortColumn = "created_at"
		sortExpression = "created_at"
	case "title":
		sortColumn = "LOWER(title)"
		sortExpression = "LOWER(title)"
	}

	direction := "DESC"
	comparison := "<"
	if query.Direction == "asc" {
		direction = "ASC"
		comparison = ">"
	}

	sqlQuery := `
		SELECT id, user_id, folder_id, title, note_markdown, created_at, updated_at, deleted_at,
		       calendar_event_id::text, revision
		FROM notes
		WHERE user_id = $1 AND deleted_at IS NULL
	`
	args := []interface{}{userID}
	argPos := 2

	if query.CursorSortValue != nil && query.CursorID != nil && *query.CursorID != "" {
		if query.Sort == "title" {
			sqlQuery += fmt.Sprintf(" AND (%s, id) %s ($%d, $%d)", sortColumn, comparison, argPos, argPos+1)
			args = append(args, strings.ToLower(*query.CursorSortValue), *query.CursorID)
		} else {
			cursorTime, err := time.Parse(time.RFC3339Nano, *query.CursorSortValue)
			if err != nil {
				return nil, fmt.Errorf("invalid activity cursor time: %w", err)
			}
			sqlQuery += fmt.Sprintf(" AND (%s, id) %s ($%d, $%d)", sortColumn, comparison, argPos, argPos+1)
			args = append(args, cursorTime, *query.CursorID)
		}
		argPos += 2
	}

	sqlQuery += fmt.Sprintf(" ORDER BY %s %s, id %s LIMIT $%d", sortExpression, direction, direction, argPos)
	args = append(args, query.Limit)

	rows, err := r.db.Query(sqlQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list activity notes: %w", err)
	}
	defer rows.Close()

	notes := []models.Note{}
	for rows.Next() {
		var note models.Note
		var folder, calEvID sql.NullString
		var deleted sql.NullTime
		if err := rows.Scan(
			&note.ID,
			&note.UserID,
			&folder,
			&note.Title,
			&note.NoteMarkdown,
			&note.CreatedAt,
			&note.UpdatedAt,
			&deleted,
			&calEvID,
			&note.Revision,
		); err != nil {
			return nil, fmt.Errorf("failed to scan activity note: %w", err)
		}
		note.FolderID = fromNullString(folder)
		note.DeletedAt = fromNullTime(deleted)
		note.CalendarEventID = fromNullString(calEvID)
		notes = append(notes, note)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to list activity notes: %w", err)
	}

	return notes, nil
}

func (r *NoteRepository) GetNoteByID(userID, noteID string) (*models.Note, error) {
	query := `
		SELECT id, user_id, folder_id, title, note_markdown, created_at, updated_at, deleted_at,
		       calendar_event_id::text, revision
		FROM notes
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
		LIMIT 1
	`

	var note models.Note
	var folder, calEvID sql.NullString
	var deleted sql.NullTime
	err := r.db.QueryRow(query, noteID, userID).Scan(
		&note.ID,
		&note.UserID,
		&folder,
		&note.Title,
		&note.NoteMarkdown,
		&note.CreatedAt,
		&note.UpdatedAt,
		&deleted,
		&calEvID,
		&note.Revision,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("note not found")
		}
		return nil, fmt.Errorf("failed to get note: %w", err)
	}

	note.FolderID = fromNullString(folder)
	note.DeletedAt = fromNullTime(deleted)
	note.CalendarEventID = fromNullString(calEvID)
	return &note, nil
}

func (r *NoteRepository) CountNotesByUser(userID string, folderID *string) (int, error) {
	baseQuery := `
		SELECT COUNT(1)
		FROM notes
		WHERE user_id = $1 AND deleted_at IS NULL
	`

	var count int
	var err error
	if folderID != nil {
		err = r.db.QueryRow(baseQuery+" AND folder_id = $2", userID, *folderID).Scan(&count)
	} else {
		err = r.db.QueryRow(baseQuery, userID).Scan(&count)
	}
	if err != nil {
		return 0, fmt.Errorf("failed to count notes: %w", err)
	}

	return count, nil
}

func (r *NoteRepository) UpdateNote(note *models.Note) (*models.Note, error) {
	return r.UpdateNoteWithRevision(note, nil)
}

func (r *NoteRepository) UpdateNoteWithRevision(note *models.Note, expectedRevision *int64) (*models.Note, error) {
	query := `
		UPDATE notes
		SET folder_id = $3,
			title = $4,
			note_markdown = $5,
			calendar_event_id = $6,
			updated_at = NOW(),
			revision = revision + 1
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
		  AND ($7::bigint IS NULL OR revision = $7)
		RETURNING id, user_id, folder_id, title, note_markdown, created_at, updated_at, deleted_at,
		          calendar_event_id::text, revision
	`

	folderID := toNullString(note.FolderID)
	calendarEventID := toNullString(note.CalendarEventID)

	var updated models.Note
	var folder, calEvID sql.NullString
	var deleted sql.NullTime
	err := r.db.QueryRow(
		query,
		note.ID,
		note.UserID,
		folderID,
		note.Title,
		note.NoteMarkdown,
		calendarEventID,
		expectedRevision,
	).Scan(
		&updated.ID,
		&updated.UserID,
		&folder,
		&updated.Title,
		&updated.NoteMarkdown,
		&updated.CreatedAt,
		&updated.UpdatedAt,
		&deleted,
		&calEvID,
		&updated.Revision,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNoteNotFound
		}
		if isConstraintViolation(err, "notes_one_per_event_idx") {
			return nil, ErrCalendarEventLinked
		}
		return nil, fmt.Errorf("failed to update note: %w", err)
	}

	updated.FolderID = fromNullString(folder)
	updated.DeletedAt = fromNullTime(deleted)
	updated.CalendarEventID = fromNullString(calEvID)
	return &updated, nil
}

func isConstraintViolation(err error, constraint string) bool {
	var pqErr *pq.Error
	return errors.As(err, &pqErr) && pqErr.Constraint == constraint
}

func (r *NoteRepository) DeleteNote(userID, noteID string) (bool, error) {
	query := `
		UPDATE notes
		SET deleted_at = NOW(), updated_at = NOW()
		WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
	`

	res, err := r.db.Exec(query, noteID, userID)
	if err != nil {
		return false, fmt.Errorf("failed to delete note: %w", err)
	}

	affected, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("failed to delete note: %w", err)
	}

	return affected > 0, nil
}

func (r *NoteRepository) SearchNotes(userID, query string, folderID *string, limit, offset int) ([]models.Note, error) {
	search := strings.TrimSpace(query)
	if search == "" {
		return []models.Note{}, nil
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
		SELECT id, user_id, folder_id, title, note_markdown, created_at, updated_at, deleted_at,
		       calendar_event_id::text, revision
		FROM notes
		WHERE user_id = $1
			AND deleted_at IS NULL
			AND (
				title ILIKE $2
				OR note_markdown ILIKE $2
				OR EXISTS (
					SELECT 1 FROM transcript_segments ts
					WHERE ts.note_id = notes.id AND ts.text ILIKE $2
				)
			)
	`

	args := []interface{}{userID, pattern}
	argPos := 3

	if folderID != nil {
		sqlQuery += fmt.Sprintf(" AND folder_id = $%d", argPos)
		args = append(args, *folderID)
		argPos++
	}

	sqlQuery += fmt.Sprintf(" ORDER BY updated_at DESC, id DESC LIMIT $%d OFFSET $%d", argPos, argPos+1)
	args = append(args, limit, offset)

	rows, err := r.db.Query(sqlQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to search notes: %w", err)
	}
	defer rows.Close()

	notes := []models.Note{}
	for rows.Next() {
		var note models.Note
		var folder, calEvID sql.NullString
		var deleted sql.NullTime
		if err := rows.Scan(
			&note.ID,
			&note.UserID,
			&folder,
			&note.Title,
			&note.NoteMarkdown,
			&note.CreatedAt,
			&note.UpdatedAt,
			&deleted,
			&calEvID,
			&note.Revision,
		); err != nil {
			return nil, fmt.Errorf("failed to scan note search row: %w", err)
		}
		note.FolderID = fromNullString(folder)
		note.DeletedAt = fromNullTime(deleted)
		note.CalendarEventID = fromNullString(calEvID)
		notes = append(notes, note)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate note search rows: %w", err)
	}

	return notes, nil
}

type FolderNoteCount struct {
	FolderID *string
	Name     string
	Count    int
}

func (r *NoteRepository) CountNotesByFolderGrouped(userID string) ([]FolderNoteCount, int, error) {
	query := `
		SELECT n.folder_id, COALESCE(f.name, 'Uncategorized'), COUNT(*)
		FROM notes n
		LEFT JOIN folders f ON f.id = n.folder_id AND f.deleted_at IS NULL
		WHERE n.user_id = $1 AND n.deleted_at IS NULL
		GROUP BY n.folder_id, f.name
		ORDER BY COUNT(*) DESC
	`

	rows, err := r.db.Query(query, userID)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to count notes by folder: %w", err)
	}
	defer rows.Close()

	var results []FolderNoteCount
	total := 0
	for rows.Next() {
		var fc FolderNoteCount
		var folderID sql.NullString
		if err := rows.Scan(&folderID, &fc.Name, &fc.Count); err != nil {
			return nil, 0, fmt.Errorf("failed to scan folder count: %w", err)
		}
		fc.FolderID = fromNullString(folderID)
		total += fc.Count
		results = append(results, fc)
	}

	return results, total, rows.Err()
}

func (r *NoteRepository) ListNotesByDateRange(userID string, startDate, endDate time.Time, limit int) ([]models.Note, error) {
	if limit <= 0 {
		limit = 50
	}

	query := `
		SELECT id, user_id, folder_id, title, note_markdown, created_at, updated_at, deleted_at,
		       calendar_event_id::text, revision
		FROM notes
		WHERE user_id = $1 AND deleted_at IS NULL
		AND created_at >= $2 AND created_at < $3
		ORDER BY created_at DESC
		LIMIT $4
	`

	rows, err := r.db.Query(query, userID, startDate, endDate, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list notes by date range: %w", err)
	}
	defer rows.Close()

	notes := []models.Note{}
	for rows.Next() {
		var note models.Note
		var folder, calEvID sql.NullString
		var deleted sql.NullTime
		if err := rows.Scan(
			&note.ID,
			&note.UserID,
			&folder,
			&note.Title,
			&note.NoteMarkdown,
			&note.CreatedAt,
			&note.UpdatedAt,
			&deleted,
			&calEvID,
			&note.Revision,
		); err != nil {
			return nil, fmt.Errorf("failed to scan note: %w", err)
		}
		note.FolderID = fromNullString(folder)
		note.DeletedAt = fromNullTime(deleted)
		note.CalendarEventID = fromNullString(calEvID)
		notes = append(notes, note)
	}

	return notes, rows.Err()
}

func (r *NoteRepository) ListNotesByEvent(userID, calendarEventID string, limit int, cursorCreatedAt *time.Time, cursorID *string) ([]models.Note, error) {
	q := `
		SELECT id, user_id, folder_id, title, note_markdown, created_at, updated_at, deleted_at,
		       calendar_event_id::text, revision
		FROM notes
		WHERE user_id = $1
		  AND calendar_event_id = $2
		  AND deleted_at IS NULL`

	args := []interface{}{userID, calendarEventID}
	argPos := 3
	if cursorCreatedAt != nil && cursorID != nil && *cursorID != "" {
		q += fmt.Sprintf(" AND (created_at, id) < ($%d, $%d)", argPos, argPos+1)
		args = append(args, *cursorCreatedAt, *cursorID)
		argPos += 2
	}
	q += fmt.Sprintf(" ORDER BY created_at DESC, id DESC LIMIT $%d", argPos)
	args = append(args, limit)

	rows, err := r.db.Query(q, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list notes by event: %w", err)
	}
	defer rows.Close()

	notes := []models.Note{}
	for rows.Next() {
		var note models.Note
		var folder, calEvID sql.NullString
		var deleted sql.NullTime
		if err := rows.Scan(
			&note.ID,
			&note.UserID,
			&folder,
			&note.Title,
			&note.NoteMarkdown,
			&note.CreatedAt,
			&note.UpdatedAt,
			&deleted,
			&calEvID,
			&note.Revision,
		); err != nil {
			return nil, fmt.Errorf("failed to scan note: %w", err)
		}
		note.FolderID = fromNullString(folder)
		note.DeletedAt = fromNullTime(deleted)
		note.CalendarEventID = fromNullString(calEvID)
		notes = append(notes, note)
	}

	return notes, rows.Err()
}

func toNullString(value *string) sql.NullString {
	if value == nil || *value == "" {
		return sql.NullString{Valid: false}
	}
	return sql.NullString{String: *value, Valid: true}
}

func fromNullString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	val := value.String
	return &val
}

func fromNullTime(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	val := value.Time
	return &val
}
