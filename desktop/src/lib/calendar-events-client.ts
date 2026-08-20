import { authenticatedFetch } from '@/lib/auth-session'
import { API_BASE_URL } from '@/lib/api-config'

const MAX_EVENTS = 100

export type CalendarAttendee = {
  name?: string
  email?: string
}

type ServerCalendarEvent = {
  id: string
  provider_id?: string
  connection_id?: string
  account_email?: string
  title: string
  start: string
  end: string
  all_day?: boolean
  location?: string
  description?: string
  meeting_link?: string
  event_link?: string
  calendar_id?: string
  calendar_name?: string
  color?: string
  organizer?: string
  provider: string
  attendees?: CalendarAttendee[]
}

export type CalendarEvent = {
  id: string
  providerId?: string
  connectionId?: string
  accountEmail?: string
  title: string
  start: string
  end: string
  allDay: boolean
  calendarId: string
  calendarName: string
  color: string
  attendees: CalendarAttendee[]
  meetingLink?: string
  eventLink?: string
  location?: string
  description?: string
  organizer?: string
  provider: string
}

export type CalendarEventsSnapshot = {
  events: CalendarEvent[]
  syncing: boolean
  stale: boolean
  lastSyncedAt?: string
}

function extractMeetingLink(event: ServerCalendarEvent) {
  const text = `${event.location ?? ''} ${event.description ?? ''}`
  return text.match(/https?:\/\/[^\s<>"')]+/i)?.[0]
}

function normalizeEvent(event: ServerCalendarEvent): CalendarEvent {
  const providerLabel = event.provider === 'google'
    ? 'Google Calendar'
    : event.provider === 'microsoft'
      ? 'Microsoft Outlook'
      : 'Calendar'

  return {
    id: event.id,
    providerId: event.provider_id,
    connectionId: event.connection_id,
    accountEmail: event.account_email,
    title: event.title || 'Untitled event',
    start: event.start,
    end: event.end,
    allDay: event.all_day ?? false,
    calendarId: event.calendar_id || event.provider,
    calendarName: event.calendar_name || providerLabel,
    color: event.color || (event.provider === 'microsoft' ? '#38bdf8' : '#9f73f2'),
    attendees: event.attendees ?? [],
    meetingLink: event.meeting_link ?? extractMeetingLink(event),
    eventLink: event.event_link,
    location: event.location,
    description: event.description,
    organizer: event.organizer,
    provider: event.provider,
  }
}

export async function getCalendarEvents(signal?: AbortSignal): Promise<CalendarEventsSnapshot> {
  const response = await authenticatedFetch(`${API_BASE_URL}/calendar/upcoming?limit=${MAX_EVENTS}`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error(`Failed to fetch calendar events: ${response.status}`)

  const data = await response.json()
  return {
    events: data.status === 'success' && Array.isArray(data.events)
      ? data.events.map((event: ServerCalendarEvent) => normalizeEvent(event))
      : [],
    syncing: Boolean(data.syncing),
    stale: Boolean(data.stale),
    lastSyncedAt: typeof data.last_synced_at === 'string' ? data.last_synced_at : undefined,
  }
}
