import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { getCalendarSettings, updateCalendarVisibility } from '@/lib/calendar-settings-client'
import { invalidateSession, SessionExpiredError } from '@/lib/auth-session'
import { desktopApi, type IntegrationProvider, type IntegrationResult } from '@/lib/desktop-api'
import { queryKeys } from '@/lib/query-keys'
import { isActiveServerStateAccount } from '@/lib/query-client'
import { invalidateResource } from '@/lib/resource-invalidation'
import type { CalendarSettingsSnapshot, ConnectedCalendar } from '@/types/calendar-settings'

const CALENDAR_SETTINGS_STALE_TIME_MS = 60_000

export function useCalendarSettingsQuery(accountID: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.calendarSettings(accountID ?? 'anonymous'),
    queryFn: ({ signal }) => getCalendarSettings(signal),
    enabled: Boolean(accountID) && enabled,
    staleTime: CALENDAR_SETTINGS_STALE_TIME_MS,
  })
}

type CalendarVisibilityVariables = {
  calendar: ConnectedCalendar
  visible: boolean
}

type CalendarIntegrationProvider = Extract<IntegrationProvider, 'google' | 'microsoft'>

async function requireIntegrationSuccess(result: IntegrationResult) {
  if (result.success) return
  if (result.authInvalid) {
    await invalidateSession()
    throw new SessionExpiredError()
  }
  throw new Error(result.error)
}

export function useCalendarConnectionMutations(
  accountID: string | undefined,
  onConnectionError?: (message: string) => void,
) {
  const queryClient = useQueryClient()
  const connectionErrorRef = useRef(onConnectionError)
  connectionErrorRef.current = onConnectionError

  useEffect(() => desktopApi.integrations.onConnectionCompleted((event) => {
    if (event.provider && event.provider !== 'google' && event.provider !== 'microsoft') return
    if (event.feature && event.feature !== 'calendar') return
    if (!event.success) {
      connectionErrorRef.current?.(event.error || 'Calendar connection failed')
      return
    }
    if (!accountID || !isActiveServerStateAccount(accountID)) return
    void invalidateResource(queryClient, accountID, 'calendar_settings')
  }), [accountID, queryClient])

  const connect = useMutation({
    mutationFn: async (provider: CalendarIntegrationProvider) => {
      const result = await desktopApi.integrations.connect(provider, 'calendar')
      await requireIntegrationSuccess(result)
    },
  })

  const disconnect = useMutation({
    mutationFn: async (connectionID: string) => {
      const result = await desktopApi.integrations.disconnect(connectionID)
      await requireIntegrationSuccess(result)
    },
    onSuccess: async () => {
      if (!accountID || !isActiveServerStateAccount(accountID)) return
      await invalidateResource(queryClient, accountID, 'calendar_settings')
    },
  })

  return { connect, disconnect }
}

export function useCalendarVisibilityMutation(accountID: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ calendar, visible }: CalendarVisibilityVariables) =>
      updateCalendarVisibility(calendar.connection_id, calendar.id, visible),
    onMutate: async ({ calendar, visible }) => {
      if (!accountID) throw new Error('Calendar settings are unavailable')
      const queryKey = queryKeys.calendarSettings(accountID)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<CalendarSettingsSnapshot>(queryKey)
      queryClient.setQueryData<CalendarSettingsSnapshot>(queryKey, (current) => current
        ? {
            ...current,
            calendars: current.calendars.map((item) =>
              item.connection_id === calendar.connection_id && item.id === calendar.id
                ? { ...item, visible }
                : item,
            ),
          }
        : current)
      return { previous, queryKey }
    },
    onError: (_error, _variables, context) => {
      if (accountID && isActiveServerStateAccount(accountID) && context?.previous) {
        queryClient.setQueryData(context.queryKey, context.previous)
      }
    },
    onSuccess: async () => {
      if (!accountID || !isActiveServerStateAccount(accountID)) return
      await invalidateResource(queryClient, accountID, 'calendar_settings')
    },
  })
}
