package models

import "time"

type TranscriptWord struct {
	Word       string  `json:"word"`
	Start      float64 `json:"start"`
	End        float64 `json:"end"`
	Confidence float64 `json:"confidence"`
}

type TranscriptSegment struct {
	ID                string           `json:"id"`
	NoteID            string           `json:"note_id"`
	SessionID         string           `json:"session_id,omitempty"`
	ClientSessionID   string           `json:"client_session_id,omitempty"`
	Channel           int              `json:"channel"`
	Text              string           `json:"text"`
	StartTime         *float64         `json:"start_time,omitempty"`
	EndTime           *float64         `json:"end_time,omitempty"`
	SegmentIndex      int              `json:"segment_index"`
	Words             []TranscriptWord `json:"words,omitempty"`
	Provider          string           `json:"provider,omitempty"`
	ProviderSegmentID string           `json:"provider_segment_id,omitempty"`
	CreatedAt         time.Time        `json:"created_at"`
}
