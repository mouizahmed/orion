package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

var ErrTranscriptSegmentConflict = errors.New("transcript segment identity conflict")

type TranscriptRepository struct {
	db *database.DB
}

func NewTranscriptRepository(db *database.DB) *TranscriptRepository {
	return &TranscriptRepository{db: db}
}

func (r *TranscriptRepository) UpsertFinalSegment(
	ctx context.Context,
	userID string,
	segment *models.TranscriptSegment,
) error {
	if segment == nil {
		return fmt.Errorf("upsert final transcript segment: segment is required")
	}
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(segment.NoteID) == "" ||
		strings.TrimSpace(segment.SessionID) == "" || strings.TrimSpace(segment.Text) == "" ||
		strings.TrimSpace(segment.Provider) == "" || strings.TrimSpace(segment.ProviderSegmentID) == "" ||
		(segment.Channel != 0 && segment.Channel != 1) || segment.SegmentIndex < 0 || segment.CreatedAt.IsZero() {
		return fmt.Errorf("upsert final transcript segment: segment fields are invalid")
	}
	words := segment.Words
	if words == nil {
		words = []models.TranscriptWord{}
	}
	wordsJSON, err := json.Marshal(words)
	if err != nil {
		return fmt.Errorf("encode final transcript words: %w", err)
	}

	var id string
	err = r.db.QueryRowContext(ctx, `
		INSERT INTO public.transcript_segments (
			note_id, session_id, channel, text, start_time, end_time,
			segment_index, words, provider, provider_segment_id, created_at
		)
		SELECT
			$2, sessions.id, $4, $5, $6, $7,
			$8, $9::jsonb, $10, $11, $12
		FROM public.note_recording_sessions AS sessions
		WHERE sessions.id = $1
		  AND sessions.note_id = $2
		  AND sessions.user_id = $3
		ON CONFLICT (session_id, channel, segment_index) DO UPDATE SET
			text = EXCLUDED.text,
			start_time = EXCLUDED.start_time,
			end_time = EXCLUDED.end_time,
			words = EXCLUDED.words
		WHERE transcript_segments.note_id = EXCLUDED.note_id
		  AND transcript_segments.provider = EXCLUDED.provider
		  AND transcript_segments.provider_segment_id = EXCLUDED.provider_segment_id
		RETURNING id
	`,
		segment.SessionID,
		segment.NoteID,
		userID,
		segment.Channel,
		segment.Text,
		segment.StartTime,
		segment.EndTime,
		segment.SegmentIndex,
		string(wordsJSON),
		segment.Provider,
		segment.ProviderSegmentID,
		segment.CreatedAt,
	).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrTranscriptSegmentConflict
	}
	if err != nil {
		return fmt.Errorf("upsert final transcript segment: %w", err)
	}
	return nil
}

func (r *TranscriptRepository) GetNextSegmentIndexes(
	ctx context.Context,
	sessionID string,
	userID string,
) ([2]int, error) {
	var next [2]int
	err := r.db.QueryRowContext(ctx, `
		SELECT
			COALESCE(MAX(segments.segment_index) FILTER (WHERE segments.channel = 0), -1) + 1,
			COALESCE(MAX(segments.segment_index) FILTER (WHERE segments.channel = 1), -1) + 1
		FROM public.note_recording_sessions AS sessions
		LEFT JOIN public.transcript_segments AS segments
		  ON segments.session_id = sessions.id
		WHERE sessions.id = $1
		  AND sessions.user_id = $2
		GROUP BY sessions.id
	`, sessionID, userID).Scan(&next[0], &next[1])
	if errors.Is(err, sql.ErrNoRows) {
		return [2]int{}, ErrRecordingSessionNotFound
	}
	if err != nil {
		return [2]int{}, fmt.Errorf("get next transcript segment indexes: %w", err)
	}
	return next, nil
}

func (r *TranscriptRepository) BatchInsertSegments(segments []*models.TranscriptSegment) error {
	if len(segments) == 0 {
		return nil
	}

	valueStrings := make([]string, 0, len(segments))
	args := make([]interface{}, 0, len(segments)*6)

	for i, seg := range segments {
		base := i * 6
		valueStrings = append(valueStrings, fmt.Sprintf(
			"($%d, $%d, $%d, $%d, $%d, $%d)",
			base+1, base+2, base+3, base+4, base+5, base+6,
		))
		args = append(args, seg.NoteID, seg.Channel, seg.Text, seg.StartTime, seg.EndTime, seg.SegmentIndex)
	}

	query := fmt.Sprintf(
		`INSERT INTO transcript_segments (note_id, channel, text, start_time, end_time, segment_index) VALUES %s`,
		strings.Join(valueStrings, ", "),
	)

	_, err := r.db.Exec(query, args...)
	if err != nil {
		return fmt.Errorf("failed to batch insert segments: %w", err)
	}

	return nil
}

func (r *TranscriptRepository) GetSegmentsByNote(noteID, userID string) ([]*models.TranscriptSegment, error) {
	query := `
		SELECT
			s.id,
			s.note_id,
			COALESCE(s.session_id::text, ''),
			COALESCE(sessions.client_session_id, ''),
			s.channel,
			s.text,
			s.start_time,
			s.end_time,
			s.segment_index,
			COALESCE(s.words, '[]'::jsonb),
			COALESCE(s.provider, ''),
			COALESCE(s.provider_segment_id, ''),
			s.created_at
		FROM transcript_segments s
		JOIN notes n ON n.id = s.note_id
		LEFT JOIN note_recording_sessions sessions ON sessions.id = s.session_id
		WHERE s.note_id = $1 AND n.user_id = $2
		ORDER BY
			COALESCE(sessions.started_at, s.created_at),
			s.created_at,
			s.channel,
			s.segment_index,
			s.id
	`

	rows, err := r.db.Query(query, noteID, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get segments: %w", err)
	}
	defer rows.Close()

	var segments []*models.TranscriptSegment
	for rows.Next() {
		var seg models.TranscriptSegment
		var wordsJSON []byte
		if err := rows.Scan(
			&seg.ID,
			&seg.NoteID,
			&seg.SessionID,
			&seg.ClientSessionID,
			&seg.Channel,
			&seg.Text,
			&seg.StartTime,
			&seg.EndTime,
			&seg.SegmentIndex,
			&wordsJSON,
			&seg.Provider,
			&seg.ProviderSegmentID,
			&seg.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan segment: %w", err)
		}
		if err := json.Unmarshal(wordsJSON, &seg.Words); err != nil {
			return nil, fmt.Errorf("decode transcript segment words: %w", err)
		}
		segments = append(segments, &seg)
	}

	return segments, rows.Err()
}

func (r *TranscriptRepository) SearchSegments(userID, query string, limit int) ([]*models.TranscriptSegment, error) {
	search := strings.TrimSpace(query)
	if search == "" {
		return []*models.TranscriptSegment{}, nil
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	sqlQuery := `
		SELECT s.id, s.note_id, s.channel, s.text, s.start_time, s.end_time, s.segment_index, s.created_at
		FROM transcript_segments s
		JOIN notes n ON n.id = s.note_id
		WHERE n.user_id = $1
			AND to_tsvector('english', s.text) @@ plainto_tsquery('english', $2)
		ORDER BY s.created_at DESC
		LIMIT $3
	`

	rows, err := r.db.Query(sqlQuery, userID, search, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to search segments: %w", err)
	}
	defer rows.Close()

	var segments []*models.TranscriptSegment
	for rows.Next() {
		var seg models.TranscriptSegment
		if err := rows.Scan(
			&seg.ID, &seg.NoteID, &seg.Channel, &seg.Text,
			&seg.StartTime, &seg.EndTime, &seg.SegmentIndex, &seg.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan search segment: %w", err)
		}
		segments = append(segments, &seg)
	}

	return segments, rows.Err()
}

func (r *TranscriptRepository) GetMaxSegmentIndex(noteID string) (int, error) {
	query := `
		SELECT COALESCE(MAX(segment_index), -1)
		FROM transcript_segments
		WHERE note_id = $1
	`

	var maxIndex int
	err := r.db.QueryRow(query, noteID).Scan(&maxIndex)
	if err != nil {
		if err == sql.ErrNoRows {
			return -1, nil
		}
		return -1, fmt.Errorf("failed to get max segment index: %w", err)
	}

	return maxIndex, nil
}
