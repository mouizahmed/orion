import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { CreateNoteDialog } from '@/features/notes/dialogs/CreateNoteDialog'
import { DeleteConfirmationDialog } from '@/features/notes/dialogs/DeleteConfirmationDialog'
import type { FolderRecord } from '@/features/notes/folder-types'
import {
  useCreateFolderMutation,
  useCreateNoteMutation,
  useDeleteFolderMutation,
  useDeleteNoteMutation,
  useMoveNoteMutation,
  useRenameFolderMutation,
  useUpdateNoteMutation,
} from '@/features/notes/queries/useNoteMutations'
import { useFoldersQuery, useNoteQuery } from '@/features/notes/queries/useNotesQueries'
import type { NoteDetail, NoteRecord } from '@/features/notes/types'
import { queryKeys } from '@/lib/query-keys'

type DashboardNotesContextType = {
  isLoading: boolean
  loadError: string | null
  folders: FolderRecord[]
  selectedNote: NoteDetail | null
  selectedNoteLoading: boolean
  selectedFolderId: string | null
  selectedId: string | null
  selectFolder: (id: string | null) => void
  selectNote: (id: string | null) => void
  createFolder: (name: string) => Promise<FolderRecord | null>
  deleteFolder: (folderID: string) => Promise<boolean>
  requestDeleteFolder: (folderID: string, name?: string) => void
  renameFolder: (folderID: string, name: string) => Promise<boolean>
  renameNote: (noteID: string, title: string) => Promise<boolean>
  moveNote: (noteID: string, folderID: string | null) => Promise<boolean>
  openCreateNoteDialog: () => void
  refresh: () => Promise<void>
  createNewNote: (payload?: {
    title?: string
    folderId?: string | null
    calendarEventId?: string
  }, options?: {
    select?: boolean
  }) => Promise<NoteRecord | null>
  deleteById: (noteID: string) => Promise<boolean>
  requestDeleteNote: (noteID: string, title?: string) => void
}

type PendingDeletion = {
  kind: 'note' | 'folder'
  id: string
  name: string
}

const DashboardNotesContext = createContext<DashboardNotesContextType | null>(null)

export function DashboardNotesProvider({ userId, children }: { userId?: string; children: React.ReactNode }) {
  const accountID = userId ?? ''
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [showCreateNoteDialog, setShowCreateNoteDialog] = useState(false)
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const createInFlightRef = useRef(false)

  const foldersQuery = useFoldersQuery(userId)
  const selectedNoteQuery = useNoteQuery(userId, selectedId)
  const folders = useMemo(() => foldersQuery.data ?? [], [foldersQuery.data])
  const { mutateAsync: createFolderAsync } = useCreateFolderMutation(accountID)
  const { mutateAsync: deleteFolderAsync } = useDeleteFolderMutation(accountID)
  const { mutateAsync: renameFolderAsync } = useRenameFolderMutation(accountID)
  const { mutateAsync: createNoteAsync } = useCreateNoteMutation(accountID)
  const { mutateAsync: deleteNoteAsync } = useDeleteNoteMutation(accountID)
  const { mutateAsync: updateNoteAsync } = useUpdateNoteMutation(accountID)
  const { mutateAsync: moveNoteAsync } = useMoveNoteMutation(accountID)

  const selectNote = useCallback((id: string | null) => setSelectedId(id), [])
  const selectFolder = useCallback((id: string | null) => setSelectedFolderId(id), [])
  const openCreateNoteDialog = useCallback(() => setShowCreateNoteDialog(true), [])

  const refresh = useCallback(async () => {
    if (!accountID) return
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.folders(accountID) }, { throwOnError: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(accountID) }, { throwOnError: true }),
      queryClient.invalidateQueries({ queryKey: queryKeys.activity(accountID) }, { throwOnError: true }),
      queryClient.invalidateQueries({ queryKey: [...queryKeys.account(accountID), 'search'] }, { throwOnError: true }),
    ])
  }, [accountID, queryClient])

  const createFolder = useCallback(
    async (name: string) => {
      try {
        const folder = await createFolderAsync(name)
        setSelectedFolderId(folder.id)
        return folder
      } catch {
        return null
      }
    },
    [createFolderAsync],
  )

  const deleteFolder = useCallback(
    async (folderID: string) => {
      try {
        const deleted = await deleteFolderAsync(folderID)
        if (deleted) setSelectedFolderId((current) => (current === folderID ? null : current))
        return deleted
      } catch {
        return false
      }
    },
    [deleteFolderAsync],
  )

  const renameFolder = useCallback(
    async (folderID: string, name: string) => {
      try {
        return Boolean(await renameFolderAsync({ folderID, name }))
      } catch {
        return false
      }
    },
    [renameFolderAsync],
  )

  const renameNote = useCallback(
    async (noteID: string, title: string) => {
      try {
        return Boolean(await updateNoteAsync({ noteID, patch: { title } }))
      } catch {
        return false
      }
    },
    [updateNoteAsync],
  )

  const moveNote = useCallback(
    async (noteID: string, folderID: string | null) => {
      try {
        return Boolean(await moveNoteAsync({ noteID, folderID }))
      } catch {
        return false
      }
    },
    [moveNoteAsync],
  )

  const createNewNote = useCallback(
    async (
      payload?: { title?: string; folderId?: string | null; calendarEventId?: string },
      options?: { select?: boolean },
    ) => {
      if (createInFlightRef.current) return null
      createInFlightRef.current = true
      try {
        const created = await createNoteAsync({
          title: payload?.title?.trim() || 'New note',
          folderId: payload?.folderId ?? null,
          calendarEventId: payload?.calendarEventId,
        })
        if (options?.select !== false) setSelectedId(created.id)
        return created
      } catch {
        return null
      } finally {
        createInFlightRef.current = false
      }
    },
    [createNoteAsync],
  )

  const deleteById = useCallback(
    async (noteID: string) => {
      try {
        const deleted = await deleteNoteAsync(noteID)
        if (deleted) setSelectedId((current) => (current === noteID ? null : current))
        return deleted
      } catch {
        return false
      }
    },
    [deleteNoteAsync],
  )

  const requestDeleteFolder = useCallback((folderID: string, name?: string) => {
    setDeleteError(null)
    setPendingDeletion({
      kind: 'folder',
      id: folderID,
      name: name?.trim() || folders.find((folder) => folder.id === folderID)?.name || 'this folder',
    })
  }, [folders])

  const requestDeleteNote = useCallback((noteID: string, title?: string) => {
    setDeleteError(null)
    setPendingDeletion({ kind: 'note', id: noteID, name: title?.trim() || 'this note' })
  }, [])

  const closeDeleteDialog = useCallback(() => {
    if (deleting) return
    setPendingDeletion(null)
    setDeleteError(null)
  }, [deleting])

  const confirmDeletion = useCallback(async () => {
    if (!pendingDeletion || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const deleted = pendingDeletion.kind === 'note'
        ? await deleteNoteAsync(pendingDeletion.id)
        : await deleteFolderAsync(pendingDeletion.id)
      if (!deleted) throw new Error(`Could not delete ${pendingDeletion.kind}`)
      if (pendingDeletion.kind === 'note') {
        setSelectedId((current) => (current === pendingDeletion.id ? null : current))
      } else {
        setSelectedFolderId((current) => (current === pendingDeletion.id ? null : current))
      }
      setPendingDeletion(null)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : `Could not delete ${pendingDeletion.kind}`)
    } finally {
      setDeleting(false)
    }
  }, [deleteFolderAsync, deleteNoteAsync, deleting, pendingDeletion])

  const value = useMemo<DashboardNotesContextType>(
    () => ({
      isLoading: foldersQuery.isLoading,
      loadError: foldersQuery.error instanceof Error ? foldersQuery.error.message : null,
      folders,
      selectedNote: selectedNoteQuery.data ?? null,
      selectedNoteLoading: selectedNoteQuery.isLoading,
      selectedFolderId,
      selectedId,
      selectFolder,
      selectNote,
      createFolder,
      deleteFolder,
      requestDeleteFolder,
      renameFolder,
      renameNote,
      moveNote,
      openCreateNoteDialog,
      refresh,
      createNewNote,
      deleteById,
      requestDeleteNote,
    }),
    [
      createFolder,
      createNewNote,
      deleteById,
      deleteFolder,
      folders,
      foldersQuery.error,
      foldersQuery.isLoading,
      moveNote,
      openCreateNoteDialog,
      refresh,
      requestDeleteFolder,
      requestDeleteNote,
      renameFolder,
      renameNote,
      selectFolder,
      selectNote,
      selectedFolderId,
      selectedId,
      selectedNoteQuery.data,
      selectedNoteQuery.isLoading,
    ],
  )

  return (
    <DashboardNotesContext.Provider value={value}>
      {children}
      <CreateNoteDialog
        isOpen={showCreateNoteDialog}
        folders={folders}
        defaultFolderId={selectedFolderId}
        onClose={() => setShowCreateNoteDialog(false)}
        onCreate={async ({ title, folderId }) => Boolean(await createNewNote({ title, folderId }))}
      />
      <DeleteConfirmationDialog
        open={Boolean(pendingDeletion)}
        title={pendingDeletion ? `Delete ${pendingDeletion.name}?` : 'Delete item?'}
        description={pendingDeletion?.kind === 'note'
          ? 'The note, recording, and transcript are deleted with it. This cannot be undone.'
          : 'The folder will be removed from your sidebar. This cannot be undone.'}
        confirmLabel={pendingDeletion?.kind === 'folder' ? 'Delete folder' : 'Delete note'}
        deleting={deleting}
        error={deleteError}
        onClose={closeDeleteDialog}
        onConfirm={() => void confirmDeletion()}
      />
    </DashboardNotesContext.Provider>
  )
}

export function useDashboardNotes() {
  const context = useContext(DashboardNotesContext)
  if (!context) throw new Error('useDashboardNotes must be used within DashboardNotesProvider')
  return context
}
