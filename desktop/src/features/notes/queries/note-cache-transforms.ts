import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'

import type { FolderRecord } from '@/features/notes/folder-types'
import type { NoteDetail, NoteRecord, NoteSummary } from '@/features/notes/types'
import { queryKeys } from '@/lib/query-keys'

export type NotesPage = {
  notes: NoteSummary[]
  nextCursor?: string
  hasMore: boolean
}

export type NotesInfiniteData = InfiniteData<NotesPage, string | null>

export function summaryFromRecord(note: NoteRecord): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    folderId: note.folderId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    calendarEventId: note.calendarEventId,
  }
}

function patchPages(
  data: NotesInfiniteData | undefined,
  transform: (notes: NoteSummary[], pageIndex: number) => NoteSummary[],
) {
  if (!data || !Array.isArray(data.pages)) return data
  return {
    ...data,
    pages: data.pages.map((page, pageIndex) => ({
      ...page,
      notes: transform(page.notes, pageIndex),
    })),
  }
}

export function removeNoteFromPages(data: NotesInfiniteData | undefined, noteID: string) {
  return patchPages(data, (notes) => notes.filter((note) => note.id !== noteID))
}

export function patchNoteInPages(
  data: NotesInfiniteData | undefined,
  noteID: string,
  patch: Partial<NoteSummary>,
) {
  return patchPages(data, (notes) => notes.map((note) => (
    note.id === noteID ? { ...note, ...patch } : note
  )))
}

export function prependNoteToPages(
  data: NotesInfiniteData | undefined,
  note: NoteSummary,
) {
  if (!data?.pages.length) return data
  const withoutNote = removeNoteFromPages(data, note.id)
  if (!withoutNote) return withoutNote
  return {
    ...withoutNote,
    pages: withoutNote.pages.map((page, index) => (
      index === 0 ? { ...page, notes: [note, ...page.notes] } : page
    )),
  }
}

export function patchNoteEverywhere(
  queryClient: QueryClient,
  accountID: string,
  noteID: string,
  patch: Partial<NoteSummary>,
) {
  queryClient.setQueryData<NoteDetail | null>(queryKeys.note(accountID, noteID), (current) => (
    current ? { ...current, ...patch } : current
  ))
  queryClient.setQueriesData<NotesInfiniteData>(
    { queryKey: queryKeys.notes(accountID) },
    (current) => patchNoteInPages(current, noteID, patch),
  )
}

export function removeNoteEverywhere(
  queryClient: QueryClient,
  accountID: string,
  noteID: string,
) {
  queryClient.removeQueries({ queryKey: queryKeys.note(accountID, noteID), exact: true })
  queryClient.setQueriesData<NotesInfiniteData>(
    { queryKey: queryKeys.notes(accountID) },
    (current) => removeNoteFromPages(current, noteID),
  )
}

export function seedCanonicalNote(
  queryClient: QueryClient,
  accountID: string,
  note: NoteRecord,
) {
  const summary = summaryFromRecord(note)
  queryClient.setQueryData<NoteDetail | null>(queryKeys.note(accountID, note.id), (current) => (
    current
      ? { ...current, ...note }
      : { ...note, linkedEvent: null, attendees: [] }
  ))
  queryClient.setQueriesData<NotesInfiniteData>(
    { queryKey: queryKeys.notes(accountID) },
    (current) => patchNoteInPages(current, note.id, summary),
  )
}

export function relocateNote(
  queryClient: QueryClient,
  accountID: string,
  note: NoteSummary,
  previousFolderID: string | null,
  nextFolderID: string | null,
) {
  const destinationMarker = nextFolderID ?? 'unfiled'
  const previousMarker = previousFolderID ?? 'unfiled'
  const detailBefore = queryClient.getQueryData<NoteDetail | null>(queryKeys.note(accountID, note.id))
  let representedInPrevious = detailBefore?.folderId === previousFolderID
  for (const [queryKey, current] of queryClient.getQueriesData<NotesInfiniteData>({
    queryKey: queryKeys.notes(accountID),
  })) {
    if (!current || !Array.isArray(current.pages)) continue
    const folderMarker = queryKey[4]
    if (folderMarker === previousMarker && current.pages.some((page) => page.notes.some((item) => item.id === note.id))) {
      representedInPrevious = true
    }
    const removed = removeNoteFromPages(current, note.id)
    queryClient.setQueryData(
      queryKey,
      folderMarker === destinationMarker
        ? prependNoteToPages(removed, { ...note, folderId: nextFolderID ?? undefined })
        : removed,
    )
  }
  patchNoteEverywhere(queryClient, accountID, note.id, {
    folderId: nextFolderID ?? undefined,
    updatedAt: Date.now(),
  })
  if (representedInPrevious && previousFolderID !== nextFolderID) {
    queryClient.setQueryData<FolderRecord[]>(queryKeys.folders(accountID), (folders) => folders?.map((folder) => {
      if (folder.id === previousFolderID) return { ...folder, noteCount: Math.max(0, folder.noteCount - 1) }
      if (folder.id === nextFolderID) return { ...folder, noteCount: folder.noteCount + 1 }
      return folder
    }))
  }
}

export type QuerySnapshot = Array<[QueryKey, unknown]>

export function snapshotAccountNotes(queryClient: QueryClient, accountID: string): QuerySnapshot {
  return queryClient.getQueriesData({ queryKey: queryKeys.notes(accountID) })
}

export function restoreSnapshot(queryClient: QueryClient, snapshot: QuerySnapshot) {
  for (const [queryKey, data] of snapshot) queryClient.setQueryData(queryKey, data)
}
