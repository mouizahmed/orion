package repository

import (
	"database/sql"
	"fmt"

	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

type RecordingSessionRepository struct {
	db *database.DB
}

func NewRecordingSessionRepository(db *database.DB) *RecordingSessionRepository {
	return &RecordingSessionRepository{db: db}
}

func (r *RecordingSessionRepository) GetActiveSession(noteID, userID string) (*models.RecordingSession, error) {
	query := `
		SELECT id, note_id, user_id, status, started_at, paused_at, stopped_at, transcript_chunks, last_activity_at
		FROM note_recording_sessions
		WHERE note_id = $1 AND user_id = $2 AND status = 'active'
		LIMIT 1
	`

	var session models.RecordingSession
	var paused sql.NullTime
	var stopped sql.NullTime
	var transcript []byte
	err := r.db.QueryRow(query, noteID, userID).Scan(
		&session.ID,
		&session.NoteID,
		&session.UserID,
		&session.Status,
		&session.StartedAt,
		&paused,
		&stopped,
		&transcript,
		&session.LastActivityAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to load active session: %w", err)
	}

	session.PausedAt = fromNullTime(paused)
	session.StoppedAt = fromNullTime(stopped)
	session.TranscriptChunks = transcript
	return &session, nil
}

func (r *RecordingSessionRepository) CreateSession(noteID, userID string) (*models.RecordingSession, error) {
	query := `
		INSERT INTO note_recording_sessions (note_id, user_id)
		VALUES ($1, $2)
		RETURNING id, note_id, user_id, status, started_at, paused_at, stopped_at, transcript_chunks, last_activity_at
	`

	var session models.RecordingSession
	var paused sql.NullTime
	var stopped sql.NullTime
	var transcript []byte
	err := r.db.QueryRow(query, noteID, userID).Scan(
		&session.ID,
		&session.NoteID,
		&session.UserID,
		&session.Status,
		&session.StartedAt,
		&paused,
		&stopped,
		&transcript,
		&session.LastActivityAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to create recording session: %w", err)
	}

	session.PausedAt = fromNullTime(paused)
	session.StoppedAt = fromNullTime(stopped)
	session.TranscriptChunks = transcript
	return &session, nil
}

func (r *RecordingSessionRepository) StopSession(sessionID, noteID, userID string) (*models.RecordingSession, error) {
	query := `
		UPDATE note_recording_sessions
		SET status = 'stopped', stopped_at = NOW(), last_activity_at = NOW()
		WHERE id = $1 AND note_id = $2 AND user_id = $3 AND status IN ('active', 'paused')
		RETURNING id, note_id, user_id, status, started_at, paused_at, stopped_at, transcript_chunks, last_activity_at
	`

	var session models.RecordingSession
	var paused sql.NullTime
	var stopped sql.NullTime
	var transcript []byte
	err := r.db.QueryRow(query, sessionID, noteID, userID).Scan(
		&session.ID,
		&session.NoteID,
		&session.UserID,
		&session.Status,
		&session.StartedAt,
		&paused,
		&stopped,
		&transcript,
		&session.LastActivityAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("session not found")
		}
		return nil, fmt.Errorf("failed to stop session: %w", err)
	}

	session.PausedAt = fromNullTime(paused)
	session.StoppedAt = fromNullTime(stopped)
	session.TranscriptChunks = transcript
	return &session, nil
}
