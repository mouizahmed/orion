import { useInfiniteQuery } from '@tanstack/react-query'

import { listActivityPage } from '@/features/home/api/activity-client'
import type { ActivityScope, ActivitySort, ActivitySortDirection } from '@/features/home/types'
import { queryKeys } from '@/lib/query-keys'

export function useActivityQuery(
  accountID: string | undefined,
  filters: { sort: ActivitySort; direction: ActivitySortDirection; scope: ActivityScope },
) {
  return useInfiniteQuery({
    queryKey: queryKeys.activityFiltered(accountID ?? 'anonymous', filters),
    queryFn: ({ pageParam, signal }) => listActivityPage({
      ...filters,
      limit: 20,
      cursor: pageParam,
      signal,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
    enabled: Boolean(accountID),
    staleTime: 15_000,
  })
}
