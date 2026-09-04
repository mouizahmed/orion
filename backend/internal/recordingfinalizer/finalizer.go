package recordingfinalizer

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/mouizahmed/justscribe-backend/internal/models"
	"github.com/mouizahmed/justscribe-backend/internal/queue"
	"github.com/mouizahmed/justscribe-backend/internal/repository"
	"github.com/mouizahmed/justscribe-backend/internal/resourceevents"
)

// Finalizer owns the authoritative post-capture recording transition.
type Finalizer struct {
	recordings *repository.RecordingSessionRepository
	indexQueue *queue.Queue
	events     resourceevents.Publisher
	audio      AudioFinalizer
}

type AudioFinalizer interface {
	Finalize(context.Context, *models.RecordingSession, string) (string, error)
	CleanupFinalized(*models.RecordingSession) error
}

const audioFinalizationHeartbeatInterval = 25 * time.Second

func New(
	recordings *repository.RecordingSessionRepository,
	indexQueue *queue.Queue,
	events resourceevents.Publisher,
	audio AudioFinalizer,
) *Finalizer {
	return &Finalizer{recordings: recordings, indexQueue: indexQueue, events: events, audio: audio}
}

// Finalize transitions a recording through finalizing, schedules transcript
// indexing, publishes note invalidation, and returns only after it is complete.
// Replays against an already-complete recording are safe.
func (f *Finalizer) Finalize(
	ctx context.Context,
	sessionID string,
	userID string,
	audioStored string,
) (*models.RecordingSession, error) {
	if f == nil || f.recordings == nil || f.indexQueue == nil {
		return nil, fmt.Errorf("recording finalizer unavailable")
	}

	session, err := f.recordings.GetSession(ctx, sessionID, userID)
	if err != nil {
		return nil, err
	}
	if session.Status == models.RecordingSessionComplete {
		if !audioStorageReplayMatches(audioStored, session.AudioStored) {
			return nil, repository.ErrRecordingSessionTransition
		}
		f.cleanupAudioBestEffort(session)
		resourceevents.PublishBestEffort(ctx, f.events, userID, resourceevents.ResourceNotes, &session.NoteID)
		return session, nil
	}

	switch session.Status {
	case models.RecordingSessionStarting, models.RecordingSessionRecording:
		session, err = f.recordings.BeginFinalizing(ctx, sessionID, userID)
		if err != nil {
			return nil, err
		}
	case models.RecordingSessionFinalizing:
	default:
		return nil, repository.ErrRecordingSessionTransition
	}
	if f.audio != nil {
		audioStored, err = f.finalizeAudioWithHeartbeat(ctx, session, audioStored)
		if err != nil {
			failureContext, cancelFailure := context.WithTimeout(context.Background(), 5*time.Second)
			_, failureErr := f.recordings.MarkFailed(failureContext, sessionID, userID)
			cancelFailure()
			return nil, fmt.Errorf("finalize recording audio: %w", errors.Join(err, failureErr))
		}
	}

	if err := f.indexQueue.Enqueue(ctx, queue.Job{
		Type:    queue.JobIndexTranscript,
		UserID:  userID,
		ID:      session.NoteID,
		DedupID: session.ID,
	}); err != nil {
		return nil, fmt.Errorf("enqueue transcript indexing: %w", err)
	}

	completed, err := f.recordings.MarkComplete(ctx, sessionID, userID, audioStored)
	if err != nil {
		if !errors.Is(err, repository.ErrRecordingSessionTransition) {
			return nil, err
		}
		completed, err = f.recordings.GetSession(ctx, sessionID, userID)
		if err != nil {
			return nil, err
		}
		if completed.Status != models.RecordingSessionComplete || !audioStorageReplayMatches(audioStored, completed.AudioStored) {
			return nil, repository.ErrRecordingSessionTransition
		}
	}

	f.cleanupAudioBestEffort(completed)
	resourceevents.PublishBestEffort(ctx, f.events, userID, resourceevents.ResourceNotes, &completed.NoteID)
	return completed, nil
}

func audioStorageReplayMatches(requested, stored string) bool {
	return requested == stored ||
		(requested == models.RecordingAudioStoredCloud && stored == models.RecordingAudioStoredNone)
}

func (f *Finalizer) cleanupAudioBestEffort(session *models.RecordingSession) {
	if f.audio != nil {
		_ = f.audio.CleanupFinalized(session)
	}
}

func (f *Finalizer) finalizeAudioWithHeartbeat(
	ctx context.Context,
	session *models.RecordingSession,
	requested string,
) (string, error) {
	audioContext, cancelAudio := context.WithCancel(ctx)
	defer cancelAudio()
	stopHeartbeat := make(chan struct{})
	heartbeatDone := make(chan error, 1)
	go func() {
		ticker := time.NewTicker(audioFinalizationHeartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stopHeartbeat:
				heartbeatDone <- nil
				return
			case <-audioContext.Done():
				heartbeatDone <- nil
				return
			case <-ticker.C:
				heartbeatContext, cancelHeartbeat := context.WithTimeout(context.Background(), 5*time.Second)
				err := f.recordings.Heartbeat(heartbeatContext, session.ID, session.UserID)
				cancelHeartbeat()
				if err != nil {
					heartbeatDone <- fmt.Errorf("heartbeat recording finalization: %w", err)
					cancelAudio()
					return
				}
			}
		}
	}()
	stored, finalizeErr := f.audio.Finalize(audioContext, session, requested)
	close(stopHeartbeat)
	heartbeatErr := <-heartbeatDone
	if err := errors.Join(finalizeErr, heartbeatErr); err != nil {
		return "", err
	}
	return stored, nil
}
