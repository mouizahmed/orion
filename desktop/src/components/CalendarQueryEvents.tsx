import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useAuth } from '@/contexts/AuthContext'
import {
  calendarEventsQueryOptions,
} from '@/hooks/useCalendarEvents'
import type { CalendarEventsSnapshot } from '@/lib/calendar-events-client'
import { queryKeys } from '@/lib/query-keys'
import { wsClient } from '@/lib/ws-client'

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

export default function CalendarQueryEvents() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const accountID = user?.id

  useEffect(() => {
    if (!accountID) return

    const idleWindow = window as IdleWindow
    let idleHandle: number | null = null
    let timeoutHandle: number | null = null
    const prefetch = () => {
      void queryClient.prefetchQuery(calendarEventsQueryOptions(accountID))
    }

    if (idleWindow.requestIdleCallback) {
      idleHandle = idleWindow.requestIdleCallback(prefetch, { timeout: 1_500 })
    } else {
      timeoutHandle = window.setTimeout(prefetch, 250)
    }

    return () => {
      if (idleHandle !== null) idleWindow.cancelIdleCallback?.(idleHandle)
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle)
    }
  }, [accountID, queryClient])

  useEffect(() => {
    if (!accountID) return
    const eventsKey = queryKeys.calendarEvents(accountID)
    const unsubscribeSync = wsClient.subscribe('calendar.sync_status', (data) => {
      queryClient.setQueryData<CalendarEventsSnapshot>(eventsKey, (current) => current
        ? {
            ...current,
            syncing: data.syncing,
            stale: data.stale,
            lastSyncedAt: data.last_synced_at,
          }
        : current)

    })

    return () => {
      unsubscribeSync()
    }
  }, [accountID, queryClient])

  return null
}
