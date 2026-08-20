import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getCalendarSettings, updateCalendarVisibility } from '@/lib/calendar-settings-client'
import { queryKeys } from '@/lib/query-keys'
import { isActiveServerStateAccount } from '@/lib/query-client'
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
      await queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(accountID) })
    },
    onSettled: async () => {
      if (!accountID || !isActiveServerStateAccount(accountID)) return
      await queryClient.invalidateQueries({ queryKey: queryKeys.calendarSettings(accountID) })
    },
  })
}
