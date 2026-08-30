import { useMutation, useQueryClient } from '@tanstack/react-query'

import { createFolder, deleteFolder, renameFolder } from '@/features/notes/api/folders-client'
import {
  createNote,
  deleteNote,
  addNoteAttendee,
  removeNoteAttendee,
  updateCalendarLink,
  updateNote,
} from '@/features/notes/api/notes-client'
import type { FolderRecord } from '@/features/notes/folder-types'
import type { NoteDetail, NoteRecord, NoteSummary } from '@/features/notes/types'
import {
  patchNoteEverywhere,
  prependNoteToPages,
  relocateNote,
  removeNoteEverywhere,
  restoreSnapshot,
  seedCanonicalNote,
  snapshotAccountNotes,
  summaryFromRecord,
  type NotesInfiniteData,
  type QuerySnapshot,
} from '@/features/notes/queries/note-cache-transforms'
import { resolveNoteRevision } from '@/features/notes/queries/note-revision'
import { queryKeys } from '@/lib/query-keys'
import { isActiveServerStateAccount } from '@/lib/query-client'

function invalidateSharedDependencies(queryClient: ReturnType<typeof useQueryClient>, accountID: string) {
  if (!isActiveServerStateAccount(accountID)) return
  void queryClient.invalidateQueries({
    queryKey: queryKeys.activity(accountID),
  })
  void queryClient.invalidateQueries({
    queryKey: [...queryKeys.account(accountID), 'search'],
  })
}

function invalidateNoteDependencies(queryClient: ReturnType<typeof useQueryClient>, accountID: string) {
  if (!isActiveServerStateAccount(accountID)) return
  void queryClient.invalidateQueries({ queryKey: queryKeys.notes(accountID) })
  void queryClient.invalidateQueries({
    queryKey: queryKeys.folders(accountID),
  })
  invalidateSharedDependencies(queryClient, accountID)
}

export function useCreateFolderMutation(accountID: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => createFolder(accountID, name),
    onSuccess: (created) => {
      if (!isActiveServerStateAccount(accountID)) return
      queryClient.setQueryData<FolderRecord[]>(queryKeys.folders(accountID), (folders = []) =>
        [...folders.filter((folder) => folder.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name)),
      )
    },
    onSettled: () => invalidateSharedDependencies(queryClient, accountID),
  })
}

export function useRenameFolderMutation(accountID: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ folderID, name }: { folderID: string; name: string }) => renameFolder(accountID, folderID, name),
    onMutate: async ({ folderID, name }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.folders(accountID),
      })
      const previous = queryClient.getQueryData<FolderRecord[]>(queryKeys.folders(accountID))
      queryClient.setQueryData<FolderRecord[]>(queryKeys.folders(accountID), (folders) =>
        folders?.map((folder) => (folder.id === folderID ? { ...folder, name } : folder)),
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (!isActiveServerStateAccount(accountID)) return
      queryClient.setQueryData(queryKeys.folders(accountID), context?.previous)
    },
    onSuccess: (updated) => {
      if (!isActiveServerStateAccount(accountID)) return
      if (!updated) return
      queryClient.setQueryData<FolderRecord[]>(queryKeys.folders(accountID), (folders) =>
        folders?.map((folder) => (folder.id === updated.id ? updated : folder)),
      )
    },
    onSettled: () => {
      if (!isActiveServerStateAccount(accountID)) return
      void queryClient.invalidateQueries({
        queryKey: queryKeys.folders(accountID),
      })
      invalidateSharedDependencies(queryClient, accountID)
    },
  })
}

export function useDeleteFolderMutation(accountID: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (folderID: string) => deleteFolder(accountID, folderID),
    onSuccess: (_ok, folderID) => {
      if (!isActiveServerStateAccount(accountID)) return
      queryClient.setQueryData<FolderRecord[]>(queryKeys.folders(accountID), (folders) =>
        folders?.filter((folder) => folder.id !== folderID),
      )
      queryClient.removeQueries({
        queryKey: queryKeys.notesByFolder(accountID, folderID),
        exact: true,
      })
    },
    onSettled: () => invalidateNoteDependencies(queryClient, accountID),
  })
}

export function useCreateNoteMutation(accountID: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (initial?: Parameters<typeof createNote>[1]) => createNote(accountID, initial),
    onSuccess: (created) => {
      if (!isActiveServerStateAccount(accountID)) return
      seedCanonicalNote(queryClient, accountID, created)
      const folderID = created.folderId ?? null
      const summary = summaryFromRecord(created)
      queryClient.setQueryData<NoteDetail>(queryKeys.note(accountID, created.id), created)
      queryClient.setQueryData<FolderRecord[]>(queryKeys.folders(accountID), (folders) =>
        folders?.map((folder) => (folder.id === folderID ? { ...folder, noteCount: folder.noteCount + 1 } : folder)),
      )
      queryClient.setQueryData<NotesInfiniteData>(queryKeys.notesByFolder(accountID, folderID), (current) =>
        prependNoteToPages(current, summary),
      )
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notesByFolder(accountID, folderID),
      })
      if (created.calendarEventId) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notesByEvent(accountID, created.calendarEventId),
        })
      }
      patchNoteEverywhere(queryClient, accountID, created.id, summary)
    },
    onSettled: () => invalidateNoteDependencies(queryClient, accountID),
  })
}

type UpdateVariables = {
  noteID: string
  patch: Omit<Parameters<typeof updateNote>[2], 'expectedRevision'>
}

export function useUpdateNoteMutation(accountID: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ noteID, patch }: UpdateVariables) => {
      const revision = await resolveNoteRevision(queryClient, accountID, noteID)
      return updateNote(accountID, noteID, {
        ...patch,
        expectedRevision: revision,
      })
    },
    scope: { id: `note-update:${accountID}` },
    onMutate: async ({ noteID, patch }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.note(accountID, noteID),
      })
      const snapshot = snapshotAccountNotes(queryClient, accountID)
      patchNoteEverywhere(queryClient, accountID, noteID, {
        ...('title' in patch ? { title: patch.title } : {}),
        ...('folderId' in patch ? { folderId: patch.folderId ?? undefined } : {}),
        ...('calendarEventId' in patch ? { calendarEventId: patch.calendarEventId ?? undefined } : {}),
        updatedAt: Date.now(),
      })
      return { snapshot }
    },
    onError: (_error, _variables, context) => {
      if (isActiveServerStateAccount(accountID)) restoreSnapshot(queryClient, context?.snapshot ?? [])
    },
    onSuccess: (updated) => {
      if (!isActiveServerStateAccount(accountID)) return
      if (updated) seedCanonicalNote(queryClient, accountID, updated)
    },
    onSettled: async (_data, _error, variables) => {
      if (!isActiveServerStateAccount(accountID)) return
      await queryClient.invalidateQueries({
        queryKey: queryKeys.note(accountID, variables.noteID),
      })
      invalidateNoteDependencies(queryClient, accountID)
    },
  })
}

export function useMoveNoteMutation(accountID: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ noteID, folderID }: { noteID: string; folderID: string | null }) => {
      const revision = await resolveNoteRevision(queryClient, accountID, noteID)
      return updateNote(accountID, noteID, {
        folderId: folderID,
        expectedRevision: revision,
      })
    },
    scope: { id: `note-update:${accountID}` },
    onMutate: async ({ noteID, folderID }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.notes(accountID) }),
        queryClient.cancelQueries({ queryKey: queryKeys.folders(accountID) }),
      ])
      const noteSnapshot = snapshotAccountNotes(queryClient, accountID)
      const folderSnapshot = queryClient.getQueryData<FolderRecord[]>(queryKeys.folders(accountID))
      const detail = queryClient.getQueryData<NoteDetail | null>(queryKeys.note(accountID, noteID))
      const cachedSummary = queryClient
        .getQueriesData<{ pages?: Array<{ notes: NoteSummary[] }> }>({
          queryKey: queryKeys.notes(accountID),
        })
        .flatMap(([, data]) => data?.pages?.flatMap((page) => page.notes) ?? [])
        .find((note) => note.id === noteID)
      const note = detail ?? cachedSummary
      if (note) relocateNote(queryClient, accountID, note, note.folderId ?? null, folderID)
      return { noteSnapshot, folderSnapshot }
    },
    onError: (_error, _variables, context) => {
      if (!isActiveServerStateAccount(accountID)) return
      restoreSnapshot(queryClient, context?.noteSnapshot ?? [])
      queryClient.setQueryData(queryKeys.folders(accountID), context?.folderSnapshot)
    },
    onSuccess: (updated) => {
      if (!isActiveServerStateAccount(accountID)) return
      if (updated) seedCanonicalNote(queryClient, accountID, updated)
    },
    onSettled: async (_data, _error, variables) => {
      if (!isActiveServerStateAccount(accountID)) return
      await queryClient.invalidateQueries({
        queryKey: queryKeys.note(accountID, variables.noteID),
      })
      invalidateNoteDependencies(queryClient, accountID)
    },
  })
}

export function useLinkNoteEventMutation(accountID: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ noteID, eventID }: { noteID: string; eventID: string | null }) => {
      const revision = await resolveNoteRevision(queryClient, accountID, noteID)
      return updateCalendarLink(accountID, noteID, eventID, revision)
    },
    scope: { id: `note-update:${accountID}` },
    onMutate: async ({ noteID, eventID }) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.note(accountID, noteID),
      })
      const snapshot = snapshotAccountNotes(queryClient, accountID)
      const previousEventID = queryClient.getQueryData<NoteDetail | null>(
        queryKeys.note(accountID, noteID),
      )?.calendarEventId
      patchNoteEverywhere(queryClient, accountID, noteID, {
        calendarEventId: eventID ?? undefined,
        updatedAt: Date.now(),
      })
      return { snapshot, previousEventID }
    },
    onError: (_error, _variables, context) => {
      if (isActiveServerStateAccount(accountID)) restoreSnapshot(queryClient, context?.snapshot ?? [])
    },
    onSuccess: (note) => {
      if (isActiveServerStateAccount(accountID) && note) seedCanonicalNote(queryClient, accountID, note)
    },
    onSettled: async (_data, _error, { noteID, eventID }, context) => {
      if (!isActiveServerStateAccount(accountID)) return
      await queryClient.invalidateQueries({
        queryKey: queryKeys.note(accountID, noteID),
      })
      if (eventID)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notesByEvent(accountID, eventID),
        })
      if (context?.previousEventID)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notesByEvent(accountID, context.previousEventID),
        })
      invalidateNoteDependencies(queryClient, accountID)
    },
  })
}

export function useDeleteNoteMutation(accountID: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (noteID: string) => deleteNote(accountID, noteID),
    scope: { id: `note-update:${accountID}` },
    onMutate: async (noteID) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.notes(accountID) })
      const snapshot = snapshotAccountNotes(queryClient, accountID)
      removeNoteEverywhere(queryClient, accountID, noteID)
      return { snapshot }
    },
    onError: (_error, _noteID, context) => {
      if (isActiveServerStateAccount(accountID)) restoreSnapshot(queryClient, context?.snapshot ?? [])
    },
    onSettled: () => invalidateNoteDependencies(queryClient, accountID),
  })
}

export function useAddNoteAttendeeMutation(accountID: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ noteID, email, name }: { noteID: string; email: string; name?: string }) =>
      addNoteAttendee(noteID, email, name),
    onSuccess: (attendee, { noteID }) => {
      if (!isActiveServerStateAccount(accountID)) return
      queryClient.setQueryData<NoteDetail | null>(queryKeys.note(accountID, noteID), (current) =>
        current
          ? {
              ...current,
              attendees: [...current.attendees.filter((item) => item.email !== attendee.email), attendee],
            }
          : current,
      )
    },
    onSettled: (_data, _error, { noteID }) => {
      if (isActiveServerStateAccount(accountID))
        void queryClient.invalidateQueries({
          queryKey: queryKeys.note(accountID, noteID),
        })
    },
  })
}

export function useRemoveNoteAttendeeMutation(accountID: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ noteID, email }: { noteID: string; email: string }) => {
      await removeNoteAttendee(noteID, email)
      return { noteID, email }
    },
    onMutate: async ({ noteID, email }) => {
      if (!isActiveServerStateAccount(accountID)) return undefined
      const queryKey = queryKeys.note(accountID, noteID)
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<NoteDetail | null>(queryKey)
      const normalizedEmail = email.trim().toLowerCase()
      queryClient.setQueryData<NoteDetail | null>(queryKey, (current) =>
        current
          ? {
              ...current,
              attendees: current.attendees.filter(
                (item) => item.email.trim().toLowerCase() !== normalizedEmail,
              ),
            }
          : current,
      )
      return { queryKey, previous }
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(context.queryKey, context.previous)
    },
    onSettled: (_data, _error, { noteID }) => {
      if (isActiveServerStateAccount(accountID))
        void queryClient.invalidateQueries({
          queryKey: queryKeys.note(accountID, noteID),
        })
    },
  })
}

export type NoteMutationResult = NoteRecord | null
export type NoteMutationSnapshot = QuerySnapshot
