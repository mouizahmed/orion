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
	CalendarEventID *string    `json:"calendar_event_id,omitempty"`
}

type NoteSummary struct {
	ID              string    `json:"id"`
	FolderID        *string   `json:"folder_id,omitempty"`
	Title           string    `json:"title"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	CalendarEventID *string   `json:"calendar_event_id,omitempty"`
}

type CalendarAttendee struct {
	Name  string `json:"name,omitempty"`
	Email string `json:"email,omitempty"`
}

type LinkedEventDetail struct {
	ID              string             `json:"id"`
	ProviderEventID string             `json:"provider_event_id"`
	ConnectionID    string             `json:"connection_id"`
	CalendarID      string             `json:"calendar_id"`
	Title           string             `json:"title"`
	Start           time.Time          `json:"start"`
	End             time.Time          `json:"end"`
	AllDay          bool               `json:"all_day"`
	Color           string             `json:"color,omitempty"`
	CalendarName    string             `json:"calendar_name,omitempty"`
	Provider        string             `json:"provider"`
	MeetingLink     string             `json:"meeting_link,omitempty"`
	EventLink       string             `json:"event_link,omitempty"`
	Location        string             `json:"location,omitempty"`
	OrganizerEmail  string             `json:"organizer_email,omitempty"`
	Attendees       []CalendarAttendee `json:"attendees"`
}

type NoteDetail struct {
	ID              string             `json:"id"`
	FolderID        *string            `json:"folder_id,omitempty"`
	Title           string             `json:"title"`
	NoteMarkdown    string             `json:"note_markdown"`
	CreatedAt       time.Time          `json:"created_at"`
	UpdatedAt       time.Time          `json:"updated_at"`
	CalendarEventID *string            `json:"calendar_event_id,omitempty"`
	LinkedEvent     *LinkedEventDetail `json:"linked_event,omitempty"`
	Attendees       []NoteAttendee     `json:"attendees"`
}

type NoteVersion struct {
	ID           string    `json:"id"`
	NoteID       string    `json:"note_id"`
	NoteMarkdown string    `json:"note_markdown"`
	CreatedAt    time.Time `json:"created_at"`
}

type NoteAttendee struct {
	ID        string    `json:"id"`
	NoteID    string    `json:"note_id"`
	UserID    *string   `json:"user_id,omitempty"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	AvatarURL string    `json:"avatar_url,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type NoteShare struct {
	ID        string    `json:"id"`
	NoteID    string    `json:"note_id"`
	SharedBy  string    `json:"shared_by"`
	Email     string    `json:"email"`
	UserID    *string   `json:"user_id,omitempty"`
	Role      string    `json:"role"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
