import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'

import { listFolders } from '@/features/notes/api/folders-client'
import { getNote, listNotesByEvent, listNotesPage, listVersions } from '@/features/notes/api/notes-client'
import { getTranscriptSegments } from '@/features/notes/api/transcript-client'
import { queryKeys } from '@/lib/query-keys'

export const NOTES_PAGE_SIZE = 20

export function foldersQueryOptions(accountID: string) {
  return queryOptions({
    queryKey: queryKeys.folders(accountID),
    queryFn: ({ signal }) => listFolders(accountID, signal),
    staleTime: 30_000,
  })
}

export function noteQueryOptions(accountID: string, noteID: string) {
  return queryOptions({
    queryKey: queryKeys.note(accountID, noteID),
    queryFn: ({ signal }) => getNote(accountID, noteID, signal),
    enabled: Boolean(accountID && noteID),
    staleTime: 15_000,
  })
}

export function notesByFolderQueryOptions(accountID: string, folderID: string | null) {
  return infiniteQueryOptions({
    queryKey: queryKeys.notesByFolder(accountID, folderID),
    queryFn: ({ pageParam, signal }) =>
      listNotesPage({
        folderId: folderID ?? undefined,
        unfiled: folderID === null,
        limit: NOTES_PAGE_SIZE,
        cursor: pageParam,
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    staleTime: 15_000,
  })
}

export function recentNotesQueryOptions(accountID: string) {
  return infiniteQueryOptions({
    queryKey: [...queryKeys.notes(accountID), 'recent'] as const,
    queryFn: ({ pageParam, signal }) =>
      listNotesPage({
        limit: NOTES_PAGE_SIZE,
        cursor: pageParam,
        signal,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    staleTime: 15_000,
  })
}

export function notesByEventQueryOptions(accountID: string, eventID: string) {
  return infiniteQueryOptions({
    queryKey: queryKeys.notesByEvent(accountID, eventID),
    queryFn: ({ pageParam, signal }) => listNotesByEvent(eventID, pageParam, NOTES_PAGE_SIZE, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    enabled: Boolean(accountID && eventID),
    staleTime: 15_000,
  })
}

export function noteTranscriptQueryOptions(accountID: string, noteID: string) {
  return queryOptions({
    queryKey: queryKeys.noteTranscript(accountID, noteID),
    queryFn: ({ signal }) => getTranscriptSegments(noteID, signal),
    enabled: Boolean(accountID && noteID),
    staleTime: 30_000,
  })
}

export function noteVersionsQueryOptions(accountID: string, noteID: string) {
  return queryOptions({
    queryKey: queryKeys.noteVersions(accountID, noteID),
    queryFn: ({ signal }) => listVersions(noteID, signal),
    enabled: Boolean(accountID && noteID),
    staleTime: 15_000,
  })
}
