package models

import "time"

type RecordingSession struct {
	ID              string     `json:"id"`
	NoteID          string     `json:"note_id"`
	UserID          string     `json:"user_id"`
	ClientSessionID string     `json:"client_session_id"`
	Status          string     `json:"status"`
	StartedAt       time.Time  `json:"started_at"`
	StoppedAt       *time.Time `json:"stopped_at,omitempty"`
	LastActivityAt  time.Time  `json:"last_activity_at"`
	FinalizedAt     *time.Time `json:"finalized_at,omitempty"`
	AudioStored     string     `json:"audio_stored"`
}

type RecordingSessionIdentity struct {
	ID     string
	UserID string
}

const (
	RecordingSessionStarting   = "starting"
	RecordingSessionRecording  = "recording"
	RecordingSessionFinalizing = "finalizing"
	RecordingSessionComplete   = "complete"
	RecordingSessionFailed     = "failed"
	RecordingSessionAbandoned  = "abandoned"
)

const (
	RecordingAudioStoredNone  = "none"
	RecordingAudioStoredLocal = "local"
	RecordingAudioStoredCloud = "cloud"
)
