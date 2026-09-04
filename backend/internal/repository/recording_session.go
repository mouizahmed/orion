package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/lib/pq"
	"github.com/mouizahmed/justscribe-backend/internal/database"
	"github.com/mouizahmed/justscribe-backend/internal/models"
)

var (
	ErrRecordingSessionNotFound       = errors.New("recording session not found")
	ErrRecordingSessionTransition     = errors.New("recording session transition rejected")
	ErrActiveRecordingSessionExists   = errors.New("active recording session already exists")
	ErrRecordingClientSessionConflict = errors.New("recording client session already exists")
)

const recordingSessionColumns = `
	id, note_id, user_id, client_session_id, status, started_at, stopped_at,
	last_activity_at, finalized_at, audio_stored
`

type RecordingSessionRepository struct {
	db *database.DB
}

func NewRecordingSessionRepository(db *database.DB) *RecordingSessionRepository {
	return &RecordingSessionRepository{db: db}
}

type recordingSessionScanner interface {
	Scan(...any) error
}

func scanRecordingSession(row recordingSessionScanner) (*models.RecordingSession, error) {
	var session models.RecordingSession
	var stoppedAt, finalizedAt sql.NullTime
	if err := row.Scan(
		&session.ID,
		&session.NoteID,
		&session.UserID,
		&session.ClientSessionID,
		&session.Status,
		&session.StartedAt,
		&stoppedAt,
		&session.LastActivityAt,
		&finalizedAt,
		&session.AudioStored,
	); err != nil {
		return nil, err
	}
	session.StoppedAt = fromNullTime(stoppedAt)
	session.FinalizedAt = fromNullTime(finalizedAt)
	return &session, nil
}

func translateRecordingSessionCreateError(err error) error {
	var pqErr *pq.Error
	if !errors.As(err, &pqErr) || pqErr.Code != "23505" {
		return err
	}
	switch pqErr.Constraint {
	case "one_active_recording_per_user":
		return ErrActiveRecordingSessionExists
	case "note_recording_sessions_client_session_id_key":
		return ErrRecordingClientSessionConflict
	default:
		return err
	}
}

func scanRecordingSessionResult(row recordingSessionScanner, operation string, noRows error) (*models.RecordingSession, error) {
	session, err := scanRecordingSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, noRows
	}
	if err != nil {
		return nil, fmt.Errorf("%s: %w", operation, err)
	}
	return session, nil
}

func (r *RecordingSessionRepository) GetActiveSessionForUser(ctx context.Context, userID string) (*models.RecordingSession, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT `+recordingSessionColumns+`
		FROM public.note_recording_sessions
		WHERE user_id = $1 AND status IN ('starting', 'recording', 'finalizing')
		ORDER BY started_at DESC, id DESC
		LIMIT 1
	`, userID)
	session, err := scanRecordingSession(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load active recording session: %w", err)
	}
	return session, nil
}

func (r *RecordingSessionRepository) GetSession(ctx context.Context, sessionID, userID string) (*models.RecordingSession, error) {
	return scanRecordingSessionResult(r.db.QueryRowContext(ctx, `
		SELECT `+recordingSessionColumns+`
		FROM public.note_recording_sessions
		WHERE id = $1 AND user_id = $2
	`, sessionID, userID), "load recording session", ErrRecordingSessionNotFound)
}

func (r *RecordingSessionRepository) GetSessionByClientID(ctx context.Context, clientSessionID, userID string) (*models.RecordingSession, error) {
	return scanRecordingSessionResult(r.db.QueryRowContext(ctx, `
		SELECT `+recordingSessionColumns+`
		FROM public.note_recording_sessions
		WHERE client_session_id = $1 AND user_id = $2
	`, clientSessionID, userID), "load recording session by client ID", ErrRecordingSessionNotFound)
}

func (r *RecordingSessionRepository) CreateForClient(ctx context.Context, noteID, userID, clientSessionID string) (*models.RecordingSession, error) {
	row := r.db.QueryRowContext(ctx, `
		INSERT INTO public.note_recording_sessions (
			note_id, user_id, client_session_id, status
		)
		VALUES ($1, $2, $3, 'starting')
		RETURNING `+recordingSessionColumns+`
	`, noteID, userID, clientSessionID)
	session, err := scanRecordingSession(row)
	if err != nil {
		return nil, translateRecordingSessionCreateError(fmt.Errorf("create recording session: %w", err))
	}
	return session, nil
}

func (r *RecordingSessionRepository) MarkRecording(ctx context.Context, sessionID, userID string) (*models.RecordingSession, error) {
	return scanRecordingSessionResult(r.db.QueryRowContext(ctx, `
		UPDATE public.note_recording_sessions
		SET status = 'recording', last_activity_at = now()
		WHERE id = $1 AND user_id = $2 AND status = 'starting'
		RETURNING `+recordingSessionColumns+`
	`, sessionID, userID), "mark recording session active", ErrRecordingSessionTransition)
}

func (r *RecordingSessionRepository) Heartbeat(ctx context.Context, sessionID, userID string) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE public.note_recording_sessions
		SET last_activity_at = now()
		WHERE id = $1
		  AND user_id = $2
		  AND status IN ('starting', 'recording', 'finalizing')
	`, sessionID, userID)
	if err != nil {
		return fmt.Errorf("heartbeat recording session: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("count heartbeat recording session rows: %w", err)
	}
	if count == 0 {
		return ErrRecordingSessionTransition
	}
	return nil
}

func (r *RecordingSessionRepository) BeginFinalizing(ctx context.Context, sessionID, userID string) (*models.RecordingSession, error) {
	return scanRecordingSessionResult(r.db.QueryRowContext(ctx, `
		UPDATE public.note_recording_sessions
		SET status = 'finalizing', stopped_at = COALESCE(stopped_at, now()), last_activity_at = now()
		WHERE id = $1
		  AND user_id = $2
		  AND status IN ('starting', 'recording')
		RETURNING `+recordingSessionColumns+`
	`, sessionID, userID), "begin recording finalization", ErrRecordingSessionTransition)
}

func (r *RecordingSessionRepository) MarkComplete(ctx context.Context, sessionID, userID, audioStored string) (*models.RecordingSession, error) {
	return scanRecordingSessionResult(r.db.QueryRowContext(ctx, `
		UPDATE public.note_recording_sessions
		SET status = 'complete',
		    stopped_at = COALESCE(stopped_at, now()),
		    finalized_at = now(),
		    last_activity_at = now(),
		    audio_stored = $3
		WHERE id = $1 AND user_id = $2 AND status = 'finalizing'
		RETURNING `+recordingSessionColumns+`
	`, sessionID, userID, audioStored), "complete recording session", ErrRecordingSessionTransition)
}

func (r *RecordingSessionRepository) MarkFailed(ctx context.Context, sessionID, userID string) (*models.RecordingSession, error) {
	return scanRecordingSessionResult(r.db.QueryRowContext(ctx, `
		UPDATE public.note_recording_sessions
		SET status = 'failed', stopped_at = COALESCE(stopped_at, now()), last_activity_at = now()
		WHERE id = $1
		  AND user_id = $2
		  AND status IN ('starting', 'recording', 'finalizing')
		RETURNING `+recordingSessionColumns+`
	`, sessionID, userID), "fail recording session", ErrRecordingSessionTransition)
}

func (r *RecordingSessionRepository) AbandonStale(ctx context.Context, cutoff time.Time, limit int) ([]models.RecordingSessionIdentity, error) {
	if limit <= 0 {
		return nil, fmt.Errorf("abandon stale recording sessions: limit must be positive")
	}
	rows, err := r.db.QueryContext(ctx, `
		WITH stale AS (
			SELECT id
			FROM public.note_recording_sessions
			WHERE status IN ('starting', 'recording', 'finalizing')
			  AND last_activity_at < $1
			ORDER BY last_activity_at, id
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		)
		UPDATE public.note_recording_sessions AS sessions
		SET status = 'abandoned', stopped_at = COALESCE(sessions.stopped_at, now())
		FROM stale
		WHERE sessions.id = stale.id
		RETURNING sessions.id, sessions.user_id
	`, cutoff, limit)
	if err != nil {
		return nil, fmt.Errorf("abandon stale recording sessions: %w", err)
	}
	defer rows.Close()

	abandoned := make([]models.RecordingSessionIdentity, 0)
	for rows.Next() {
		var identity models.RecordingSessionIdentity
		if err := rows.Scan(&identity.ID, &identity.UserID); err != nil {
			return nil, fmt.Errorf("scan abandoned recording session: %w", err)
		}
		abandoned = append(abandoned, identity)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read abandoned recording sessions: %w", err)
	}
	return abandoned, nil
}

func (r *RecordingSessionRepository) FindNonTerminal(
	ctx context.Context,
	candidates []models.RecordingSessionIdentity,
) ([]models.RecordingSessionIdentity, error) {
	if len(candidates) == 0 {
		return nil, nil
	}
	sessionIDs := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		sessionIDs = append(sessionIDs, candidate.ID)
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, user_id
		FROM public.note_recording_sessions
		WHERE id = ANY($1::uuid[])
		  AND status IN ('starting', 'recording', 'finalizing')
	`, pq.Array(sessionIDs))
	if err != nil {
		return nil, fmt.Errorf("find nonterminal recording sessions: %w", err)
	}
	defer rows.Close()

	active := make([]models.RecordingSessionIdentity, 0)
	for rows.Next() {
		var identity models.RecordingSessionIdentity
		if err := rows.Scan(&identity.ID, &identity.UserID); err != nil {
			return nil, fmt.Errorf("scan nonterminal recording session: %w", err)
		}
		active = append(active, identity)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read nonterminal recording sessions: %w", err)
	}
	return active, nil
}

func (r *RecordingSessionRepository) FindCompleted(
	ctx context.Context,
	candidates []models.RecordingSessionIdentity,
) ([]models.RecordingSessionIdentity, error) {
	if len(candidates) == 0 {
		return nil, nil
	}
	sessionIDs := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		sessionIDs = append(sessionIDs, candidate.ID)
	}
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, user_id
		FROM public.note_recording_sessions
		WHERE id = ANY($1::uuid[])
		  AND status = 'complete'
	`, pq.Array(sessionIDs))
	if err != nil {
		return nil, fmt.Errorf("find completed recording sessions: %w", err)
	}
	defer rows.Close()

	completed := make([]models.RecordingSessionIdentity, 0)
	for rows.Next() {
		var identity models.RecordingSessionIdentity
		if err := rows.Scan(&identity.ID, &identity.UserID); err != nil {
			return nil, fmt.Errorf("scan completed recording session: %w", err)
		}
		completed = append(completed, identity)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read completed recording sessions: %w", err)
	}
	return completed, nil
}
