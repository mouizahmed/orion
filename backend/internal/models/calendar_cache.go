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
	ID            string
	ProviderID    string
	ConnectionID  string
	AccountEmail  string
	Title         string
	Start         time.Time
	End           time.Time
	AllDay        bool
	Location      string
	Description   string
	MeetingLink   string
	EventLink     string
	CalendarID    string
	CalendarName  string
	Color         string
	Organizer     string
	Provider      string
	IsMeeting     bool
	AttendeesJSON []byte
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
