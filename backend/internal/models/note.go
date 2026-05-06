package models

import "time"

type Note struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	FolderID        *string    `json:"folder_id,omitempty"`
	Title           string     `json:"title"`
	NoteMarkdown    string     `json:"note_markdown"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	DeletedAt       *time.Time `json:"deleted_at,omitempty"`
	ProviderEventID *string    `json:"provider_event_id,omitempty"`
	ConnectionID    *string    `json:"connection_id,omitempty"`
	CalendarID      *string    `json:"calendar_id,omitempty"`
}

type NoteVersion struct {
	ID           string    `json:"id"`
	NoteID       string    `json:"note_id"`
	NoteMarkdown string    `json:"note_markdown"`
	CreatedAt    time.Time `json:"created_at"`
}
