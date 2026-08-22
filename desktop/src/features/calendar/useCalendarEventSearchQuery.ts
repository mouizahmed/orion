import { useQuery } from '@tanstack/react-query'

import { searchCalendarEvents } from '@/features/calendar/api/event-search-client'
import { queryKeys } from '@/lib/query-keys'

export function useCalendarEventSearchQuery(
  accountID: string | undefined,
  noteID: string | null,
  rawQuery: string,
  enabled: boolean,
) {
  const query = rawQuery.trim().toLocaleLowerCase()
  return useQuery({
    queryKey: queryKeys.calendarEventSearch(accountID ?? 'anonymous', noteID ?? '', query),
    queryFn: ({ signal }) => searchCalendarEvents({ query, noteID: noteID ?? '', signal }),
    enabled: Boolean(accountID && noteID && enabled),
    staleTime: 15_000,
  })
}
