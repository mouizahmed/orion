import { useInfiniteQuery } from '@tanstack/react-query'

import { searchAll } from '@/features/notes/api/search-client'
import { queryKeys } from '@/lib/query-keys'

const SEARCH_PAGE_SIZE = 12

export function normalizeSearchQuery(value: string) {
  return value.trim().toLocaleLowerCase()
}

export function useDashboardSearchQuery(accountID: string | undefined, rawQuery: string) {
  const query = normalizeSearchQuery(rawQuery)
  const rootKey = queryKeys.search(accountID ?? 'anonymous', query)

  const folders = useInfiniteQuery({
    queryKey: [...rootKey, 'folders'] as const,
    queryFn: ({ pageParam, signal }) => searchAll({
      query,
      folderOffset: pageParam,
      folderLimit: SEARCH_PAGE_SIZE,
      noteLimit: 0,
      signal,
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.pagination.folders.hasMore
      ? lastPage.pagination.folders.nextOffset
      : undefined,
    enabled: Boolean(accountID && query),
    staleTime: 15_000,
  })

  const notes = useInfiniteQuery({
    queryKey: [...rootKey, 'notes'] as const,
    queryFn: ({ pageParam, signal }) => searchAll({
      query,
      noteOffset: pageParam,
      noteLimit: SEARCH_PAGE_SIZE,
      folderLimit: 0,
      signal,
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.pagination.notes.hasMore
      ? lastPage.pagination.notes.nextOffset
      : undefined,
    enabled: Boolean(accountID && query),
    staleTime: 15_000,
  })

  return { query, folders, notes }
}
