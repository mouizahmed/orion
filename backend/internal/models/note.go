package models

import "time"

type Note struct {
	ID              string         `json:"id"`
	UserID          string         `json:"user_id"`
	FolderID        *string        `json:"folder_id,omitempty"`
	Title           string         `json:"title"`
	NoteMarkdown    string         `json:"note_markdown"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	Revision        int64          `json:"revision"`
	DeletedAt       *time.Time     `json:"deleted_at,omitempty"`
	CalendarEventID *string        `json:"calendar_event_id,omitempty"`
	Attendees       []NoteAttendee `json:"attendees,omitempty"`
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
	Name           string `json:"name,omitempty"`
	Email          string `json:"email,omitempty"`
	ResponseStatus string `json:"response_status,omitempty"`
	AttendeeType   string `json:"attendee_type,omitempty"`
	Optional       bool   `json:"optional,omitempty"`
	Organizer      bool   `json:"organizer,omitempty"`
	Self           bool   `json:"self,omitempty"`
	Resource       bool   `json:"resource,omitempty"`
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
	OrganizerName   string             `json:"organizer_name,omitempty"`
	OrganizerEmail  string             `json:"organizer_email,omitempty"`
	Historical      bool               `json:"historical"`
	Attendees       []CalendarAttendee `json:"attendees"`
}

type NoteDetail struct {
	ID              string             `json:"id"`
	FolderID        *string            `json:"folder_id,omitempty"`
	Title           string             `json:"title"`
	NoteMarkdown    string             `json:"note_markdown"`
	CreatedAt       time.Time          `json:"created_at"`
	UpdatedAt       time.Time          `json:"updated_at"`
	Revision        int64              `json:"revision"`
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
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Source    string    `json:"source"`
	CreatedAt time.Time `json:"created_at"`
}
