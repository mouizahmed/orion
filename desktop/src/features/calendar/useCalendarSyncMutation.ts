import { useMutation, useQueryClient } from '@tanstack/react-query'

import { authenticatedFetch } from '@/features/auth/auth-session'
import type { CalendarEventsSnapshot } from '@/features/calendar/api/calendar-events-client'
import { API_BASE_URL } from '@/lib/api-config'
import { queryKeys } from '@/lib/query-keys'

export function useCalendarSyncMutation(accountID: string | undefined) {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.calendarEvents(accountID ?? 'anonymous')
  return useMutation({
    mutationFn: async () => {
      const response = await authenticatedFetch(`${API_BASE_URL}/calendar/sync?wait=true`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`Calendar sync failed: ${response.status}`)
    },
    onMutate: () => {
      const previous = queryClient.getQueryData<CalendarEventsSnapshot>(queryKey)
      queryClient.setQueryData<CalendarEventsSnapshot>(queryKey, (current) => current
        ? { ...current, syncing: true }
        : current)
      return { previous }
    },
    onError: (_error, _variables, context) => queryClient.setQueryData(queryKey, context?.previous),
    onSettled: () => void queryClient.invalidateQueries({ queryKey }),
  })
}
