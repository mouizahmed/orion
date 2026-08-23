import { useQuery } from '@tanstack/react-query'

import { useAuth } from '@/features/auth/AuthContext'
import {
  getCalendarEvents,
  type CalendarEventsSnapshot,
} from '@/features/calendar/api/calendar-events-client'
import { queryKeys } from '@/lib/query-keys'

export type { CalendarAttendee, CalendarEvent } from '@/features/calendar/api/calendar-events-client'

export const CALENDAR_EVENTS_STALE_TIME_MS = 30_000
const EMPTY_EVENTS: CalendarEventsSnapshot['events'] = []

export function calendarEventsQueryOptions(accountID: string) {
  return {
    queryKey: queryKeys.calendarEvents(accountID),
    queryFn: ({ signal }: { signal: AbortSignal }) => getCalendarEvents(signal),
    staleTime: CALENDAR_EVENTS_STALE_TIME_MS,
    gcTime: 30 * 60_000,
  }
}

export function useCalendarEvents() {
  const { user } = useAuth()
  const accountID = user?.id
  const query = useQuery({
    ...calendarEventsQueryOptions(accountID ?? 'anonymous'),
    enabled: Boolean(accountID),
  })

  return {
    events: query.data?.events ?? EMPTY_EVENTS,
    loading: query.isPending,
    error: query.error instanceof Error ? query.error.message : null,
    syncing: query.data?.syncing ?? false,
    stale: query.data?.stale ?? false,
    lastSyncedAt: query.data?.lastSyncedAt,
    lastError: query.data?.lastError,
    partial: query.data?.partial ?? false,
    refresh: query.refetch,
  }
}
