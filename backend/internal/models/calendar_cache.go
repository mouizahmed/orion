package models

import "time"

type CachedCalendarSource struct {
	ID              string
	ConnectionID    string
	AccountEmail    string
	Name            string
	Provider        string
	Color           string
	BackgroundColor string
	ForegroundColor string
	Primary         bool
	Selected        bool
	Visible         bool
	AccessRole      string
	SyncedAt        *time.Time
	SyncToken       string
	SyncWindowStart *time.Time
	SyncWindowEnd   *time.Time
}

type CachedCalendarEvent struct {
	ID             string
	ProviderID     string
	ConnectionID   string
	AccountEmail   string
	Title          string
	Start          time.Time
	End            time.Time
	AllDay         bool
	Location       string
	Description    string
	MeetingLink    string
	EventLink      string
	CalendarID     string
	CalendarName   string
	Color          string
	OrganizerName  string
	OrganizerEmail string
	Provider       string
	Attendees      []CalendarEventAttendee
	AttendeesJSON  []byte
}

type CalendarEventAttendee struct {
	ProviderID     string `json:"provider_id,omitempty"`
	Name           string `json:"name,omitempty"`
	Email          string `json:"email,omitempty"`
	ResponseStatus string `json:"response_status,omitempty"`
	AttendeeType   string `json:"attendee_type,omitempty"`
	Optional       bool   `json:"optional,omitempty"`
	Organizer      bool   `json:"organizer,omitempty"`
	Self           bool   `json:"self,omitempty"`
	Resource       bool   `json:"resource,omitempty"`
}

func (a CalendarEventAttendee) EligibleForNote() bool {
	return a.Email != "" && !a.Resource && !a.Self && !a.Organizer && a.ResponseStatus != "declined"
}

type CalendarEventSyncBatch struct {
	Events      []*CachedCalendarEvent
	Deleted     []string
	NextToken   string
	WasFullSync bool
	WindowStart time.Time
	WindowEnd   time.Time
}

type CalendarSyncState struct {
	ConnectionID         string
	Status               string
	CalendarLastSyncedAt *time.Time
	EventsLastSyncedAt   *time.Time
	SyncStartedAt        *time.Time
	LastError            *string
	EventsWindowStart    *time.Time
	EventsWindowEnd      *time.Time
	UpdatedAt            time.Time
}
