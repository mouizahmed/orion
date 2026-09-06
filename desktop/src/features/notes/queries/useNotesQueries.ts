import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import {
  foldersQueryOptions,
  noteQueryOptions,
  notesByEventQueryOptions,
  noteTranscriptQueryOptions,
  notesByFolderQueryOptions,
  recentNotesQueryOptions,
  sortedNotesByFolderQueryOptions,
} from '@/features/notes/queries/note-query-options'
import type { NoteSort, NoteSortDirection } from '@/features/notes/types'

export function useFoldersQuery(accountID: string | undefined) {
  return useQuery({
    ...foldersQueryOptions(accountID ?? 'anonymous'),
    enabled: Boolean(accountID),
  })
}

export function useNoteQuery(accountID: string | undefined, noteID: string | null) {
  return useQuery({
    ...noteQueryOptions(accountID ?? 'anonymous', noteID ?? ''),
    enabled: Boolean(accountID && noteID),
  })
}

export function useNotesByFolderQuery(accountID: string | undefined, folderID: string | null, enabled = true) {
  return useInfiniteQuery({
    ...notesByFolderQueryOptions(accountID ?? 'anonymous', folderID),
    enabled: Boolean(accountID && enabled),
  })
}

export function useSortedNotesByFolderQuery(
  accountID: string | undefined,
  folderID: string | null,
  sorting: { sort: NoteSort; direction: NoteSortDirection },
) {
  return useInfiniteQuery({
    ...sortedNotesByFolderQueryOptions(accountID ?? 'anonymous', folderID, sorting),
    enabled: Boolean(accountID),
  })
}

export function useRecentNotesQuery(accountID: string | undefined, enabled = true) {
  return useInfiniteQuery({
    ...recentNotesQueryOptions(accountID ?? 'anonymous'),
    enabled: Boolean(accountID && enabled),
  })
}

export function useNotesByEventQuery(accountID: string | undefined, eventID: string) {
  return useInfiniteQuery({
    ...notesByEventQueryOptions(accountID ?? 'anonymous', eventID),
    enabled: Boolean(accountID && eventID),
  })
}

export function useNoteTranscriptQuery(accountID: string | undefined, noteID: string | null, enabled: boolean) {
  return useQuery({
    ...noteTranscriptQueryOptions(accountID ?? 'anonymous', noteID ?? ''),
    enabled: Boolean(accountID && noteID && enabled),
  })
}
