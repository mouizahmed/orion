import { useCallback, useEffect, useState } from 'react'

import { auth } from '@/config/firebase'
import { authenticatedFetch, getAuthenticatedIdToken } from '@/lib/auth-session'
import { useAuth } from '@/contexts/AuthContext'
import { wsClient } from '@/lib/ws-client'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'
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

type CalendarEventsSnapshot = {
  events: CalendarEvent[]
  loading: boolean
  error: string | null
  syncing: boolean
  stale: boolean
  lastSyncedAt?: string
  lastFetchedAt?: number
}

const emptySnapshot: CalendarEventsSnapshot = {
  events: [],
  loading: false,
  error: null,
  syncing: false,
  stale: false,
}

let activeUserId: string | null = null
let snapshot: CalendarEventsSnapshot = emptySnapshot
let inFlight: Promise<void> | null = null
let wsUnsubscribe: (() => void) | null = null

const subscribers = new Set<(next: CalendarEventsSnapshot) => void>()

function emit() {
  subscribers.forEach((subscriber) => subscriber(snapshot))
}

function setSnapshot(next: Partial<CalendarEventsSnapshot>) {
  snapshot = { ...snapshot, ...next }
  emit()
}

function resetSnapshot() {
  snapshot = emptySnapshot
  emit()
}

function extractMeetingLink(event: ServerCalendarEvent) {
  const text = `${event.location ?? ''} ${event.description ?? ''}`
  return text.match(/https?:\/\/[^\s<>"')]+/i)?.[0]
}

function normalizeEvent(event: ServerCalendarEvent): CalendarEvent {
  const providerLabel = event.provider === 'google' ? 'Google Calendar' : event.provider === 'microsoft' ? 'Microsoft Outlook' : 'Calendar'

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

async function fetchCalendarEvents(silent = false) {
  const requestUserId = activeUserId
  if (!requestUserId) return

  if (!silent) {
    setSnapshot({ loading: true, error: null })
  }

  if (inFlight) {
    return inFlight
  }

  inFlight = (async () => {
    try {
      const currentUser = auth.currentUser
      if (!currentUser || currentUser.uid !== requestUserId) {
        throw new Error('Not authenticated')
      }

      const idToken = await getAuthenticatedIdToken()
      const response = await authenticatedFetch(`${API_BASE_URL}/calendar/upcoming?limit=${MAX_EVENTS}`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch calendar events: ${response.status}`)
      }

      const data = await response.json()
      if (activeUserId !== requestUserId) return

      const events = data.status === 'success' && Array.isArray(data.events)
        ? data.events.map((event: ServerCalendarEvent) => normalizeEvent(event))
        : []

      setSnapshot({
        events,
        loading: false,
        error: null,
        syncing: Boolean(data.syncing),
        stale: Boolean(data.stale),
        lastSyncedAt: data.last_synced_at,
        lastFetchedAt: Date.now(),
      })
    } catch (error) {
      if (activeUserId !== requestUserId) return
      if (!silent) {
        setSnapshot({
          events: [],
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load calendar',
          syncing: false,
          stale: false,
        })
      }
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

let wsStatusUnsubscribe: (() => void) | null = null

function startSharedWS() {
  if (wsUnsubscribe !== null) return
  wsUnsubscribe = wsClient.subscribe('calendar.sync_status', (data) => {
    const wasSyncing = snapshot.syncing
    const wasStale = snapshot.stale
    setSnapshot({ syncing: data.syncing, stale: data.stale, lastSyncedAt: data.last_synced_at })
    // Re-fetch only when the backend reports fresh data after local state was syncing/stale.
    // Failed or still-stale syncs should not create a refetch loop.
    if (!data.syncing && !data.stale && (wasSyncing || wasStale)) {
      void fetchCalendarEvents(true)
    }
  })

  // On reconnect, re-fetch to clear any stale syncing/stale UI state that
  // accumulated while the server was unreachable.
  wsStatusUnsubscribe = wsClient.onStatusChange((status) => {
    if (status === 'connected') void fetchCalendarEvents(true)
  })
}

function stopSharedWS() {
  wsUnsubscribe?.()
  wsUnsubscribe = null
  wsStatusUnsubscribe?.()
  wsStatusUnsubscribe = null
}

export function triggerCalendarSync() {
  setSnapshot({ syncing: true, error: null })
}

export function resetCalendarSync() {
  setSnapshot({ syncing: false })
}

export function refreshCalendarEvents() {
  void fetchCalendarEvents(true)
}

export function useCalendarEvents() {
  const { user } = useAuth()
  const [localSnapshot, setLocalSnapshot] = useState(snapshot)

  const userId = user?.id ?? null

  useEffect(() => {
    if (!userId) {
      activeUserId = null
      resetSnapshot()
      setLocalSnapshot(snapshot)
      return
    }

    const userChanged = activeUserId !== userId
    if (userChanged) {
      activeUserId = userId
      snapshot = { ...emptySnapshot, loading: true }
    }

    subscribers.add(setLocalSnapshot)
    setLocalSnapshot(snapshot)
    startSharedWS()

    // SWR: always revalidate on subscribe unless a fetch is already in progress.
    // Silent (no loading spinner) when we have cached data; non-silent on first load or error.
    if (!snapshot.loading || userChanged) {
      const silent = !userChanged && Boolean(snapshot.lastFetchedAt) && !snapshot.error
      void fetchCalendarEvents(silent)
    }

    return () => {
      subscribers.delete(setLocalSnapshot)
      if (subscribers.size === 0) {
        stopSharedWS()
      }
    }
  }, [userId])

  const refresh = useCallback(() => fetchCalendarEvents(false), [])

  return {
    ...localSnapshot,
    refresh,
  }
}
