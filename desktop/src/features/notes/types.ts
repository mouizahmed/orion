export type NoteSummary = {
  id: string
  title: string
  folderId?: string
  createdAt: number
  updatedAt: number
  calendarEventId?: string
}

export type NoteRecord = NoteSummary & {
  noteMarkdown: string
  revision: number
}

export type CalendarAttendee = {
  name?: string
  email: string
  responseStatus?: string
  attendeeType?: string
  optional?: boolean
  organizer?: boolean
  self?: boolean
  resource?: boolean
}

export type LinkedEventDetail = {
  id: string
  providerEventId: string
  connectionId: string
  calendarId: string
  provider: string
  title: string
  start: string
  end?: string
  allDay?: boolean
  color: string
  calendarName?: string
  meetingLink?: string
  eventLink?: string
  location?: string
  organizerName?: string
  organizerEmail?: string
  historical: boolean
  attendees: CalendarAttendee[]
}

export type NoteDetail = NoteRecord & {
  linkedEvent: LinkedEventDetail | null
  attendees: NoteAttendee[]
}

export type NoteAttendee = {
  id: string
  noteId: string
  email: string
  name: string
  source: 'manual' | 'calendar'
  createdAt: string
}

export type NoteVersion = {
  id: string
  note_id: string
  note_markdown: string
  created_at: string
}
