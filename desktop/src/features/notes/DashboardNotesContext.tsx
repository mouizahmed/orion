import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import type { NoteAttendee, NoteDetail, NoteRecord, NoteSummary } from '@/features/notes/types'
import type { FolderRecord } from '@/features/notes/folder-types'
import { CreateNoteDialog } from '@/features/notes/dialogs/CreateNoteDialog'
import { createFolder as createFolderApi, deleteFolder as deleteFolderApi, listFolders, renameFolder as renameFolderApi } from '@/features/notes/api/folders-client'
import {
  createNote,
  deleteNote,
  getNote,
  listNotesPage,
  updateNote,
  addNoteAttendee,
  removeNoteAttendee,
} from '@/features/notes/api/notes-client'

export const UNFILED_ID = '__unfiled__'
const PAGE_SIZE = 20

type FolderPage = {
  noteIds: string[]
  hasMore: boolean
  cursor?: string
  isLoading: boolean
  loaded: boolean
}

type Patch = Partial<Pick<NoteSummary, 'title' | 'folderId'>>

type DashboardNotesContextType = {
  isLoading: boolean
  loadError: string | null
  notes: NoteSummary[]
  noteSummariesById: Record<string, NoteSummary>
  folderPages: Record<string, { noteIds: string[]; hasMore: boolean; isLoading: boolean; loaded: boolean }>
  folders: FolderRecord[]
  selectedNote: NoteDetail | null
  selectedNoteLoading: boolean
  noteAttendeesByNoteId: Record<string, NoteAttendee[]>
  loadMoreForFolder: (folderId: string | null) => Promise<void>
  selectedFolderId: string | null
  selectedId: string | null
  search: string
  setSearch: (value: string) => void
  selectFolder: (id: string | null) => void
  selectNote: (id: string | null) => void
  createFolder: (name: string) => Promise<FolderRecord | null>
  deleteFolder: (folderId: string) => Promise<boolean>
  renameFolder: (folderId: string, name: string) => Promise<boolean>
  renameNote: (noteId: string, title: string) => Promise<boolean>
  moveNote: (noteId: string, folderId: string | null) => Promise<boolean>
  openCreateNoteDialog: () => void
  refresh: () => Promise<void>
  createNewNote: (payload?: { title?: string; folderId?: string | null; calendarEventId?: string }) => Promise<NoteRecord | null>
  deleteById: (noteId: string) => Promise<boolean>
  evictNote: (noteId: string) => void
  optimisticPatch: (noteId: string, patch: Patch) => void
  replaceNote: (note: NoteRecord) => void
  addAttendee: (noteId: string, email: string) => Promise<NoteAttendee | null>
  removeAttendee: (noteId: string, email: string) => Promise<boolean>
}

const DashboardNotesContext = createContext<DashboardNotesContextType | null>(null)

function summaryFromRecord(note: NoteRecord): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    folderId: note.folderId,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    calendarEventId: note.calendarEventId,
  }
}

export function DashboardNotesProvider({
  userId,
  children,
}: {
  userId?: string
  children: React.ReactNode
}) {
  const [noteSummariesById, setNoteSummariesById] = useState<Record<string, NoteSummary>>({})
  const [folderPages, setFolderPages] = useState<Record<string, FolderPage>>({})
  const folderPagesRef = useRef<Record<string, FolderPage>>({})
  const [folders, setFolders] = useState<FolderRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedNote, setSelectedNote] = useState<NoteDetail | null>(null)
  const [selectedNoteLoading, setSelectedNoteLoading] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showCreateNoteDialog, setShowCreateNoteDialog] = useState(false)
  const [noteAttendeesByNoteId, setNoteAttendeesByNoteId] = useState<Record<string, NoteAttendee[]>>({})
  const createInFlightRef = useRef(false)

  const notes = useMemo(
    () => Object.values(noteSummariesById).sort((a, b) => b.updatedAt - a.updatedAt),
    [noteSummariesById],
  )

  const fetchAndSetSelectedNote = useCallback(async (id: string) => {
    setSelectedNoteLoading(true)
    try {
      const result = await getNote(userId, id)
      if (result) {
        setSelectedNote(result)
        setNoteSummariesById((prev) => ({ ...prev, [id]: summaryFromRecord(result) }))
        setNoteAttendeesByNoteId((prev) => ({ ...prev, [id]: result.attendees }))
      }
    } finally {
      setSelectedNoteLoading(false)
    }
  }, [userId])

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const [folderList, unfiledResult] = await Promise.all([
        listFolders(userId),
        listNotesPage({ unfiled: true, limit: PAGE_SIZE }),
      ])

      setFolders(folderList)

      const summaries: Record<string, NoteSummary> = {}
      for (const n of unfiledResult.notes) summaries[n.id] = n
      setNoteSummariesById(summaries)

      const pages: Record<string, FolderPage> = {
        [UNFILED_ID]: {
          noteIds: unfiledResult.notes.map((n) => n.id),
          hasMore: unfiledResult.hasMore,
          cursor: unfiledResult.nextCursor,
          isLoading: false,
          loaded: true,
        },
      }
      for (const folder of folderList) {
        pages[folder.id] = {
          noteIds: [],
          hasMore: folder.noteCount > 0,
          cursor: undefined,
          isLoading: false,
          loaded: false,
        }
      }
      setFolderPages(pages)
      setSelectedFolderId(null)
      setSelectedId(null)
      setSelectedNote(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load notes')
      setNoteSummariesById({})
      setFolderPages({})
      setFolders([])
      setSelectedFolderId(null)
      setSelectedId(null)
      setSelectedNote(null)
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  useEffect(() => {
    folderPagesRef.current = folderPages
  }, [folderPages])

  const selectNote = useCallback((id: string | null) => {
    if (!id) {
      setSelectedId(null)
      setSelectedNote(null)
      return
    }
    setSelectedId(id)
    window.dispatchEvent(new Event('dashboard-activity-refresh'))
    void fetchAndSetSelectedNote(id)
  }, [fetchAndSetSelectedNote])

  const selectFolder = useCallback((id: string | null) => {
    setSelectedFolderId(id)
  }, [])

  const openCreateNoteDialog = useCallback(() => {
    setShowCreateNoteDialog(true)
  }, [])

  const loadMoreForFolder = useCallback(
    async (folderId: string | null) => {
      const key = folderId ?? UNFILED_ID
      const currentPage = folderPagesRef.current[key]
      if (!currentPage || currentPage.isLoading || (currentPage.loaded && !currentPage.hasMore)) return
      const cursor = currentPage.cursor

      setFolderPages((prev) => {
        const state = prev[key]
        if (!state) return prev
        return { ...prev, [key]: { ...state, isLoading: true } }
      })

      try {
        const page = await listNotesPage({
          folderId: folderId ?? undefined,
          unfiled: folderId ? false : true,
          limit: PAGE_SIZE,
          cursor: cursor ?? null,
        })

        setNoteSummariesById((prev) => {
          const next = { ...prev }
          for (const n of page.notes) next[n.id] = n
          return next
        })

        setFolderPages((prev) => {
          const state = prev[key]
          if (!state) return prev
          const existingIds = new Set(state.noteIds)
          const newIds = page.notes.filter((n) => !existingIds.has(n.id)).map((n) => n.id)
          return {
            ...prev,
            [key]: {
              loaded: true,
              hasMore: page.hasMore,
              cursor: page.nextCursor,
              isLoading: false,
              noteIds: [...state.noteIds, ...newIds],
            },
          }
        })
      } catch {
        setFolderPages((prev) => {
          const state = prev[key]
          if (!state) return prev
          return { ...prev, [key]: { ...state, isLoading: false } }
        })
      }
    },
    [],
  )

  const createFolder = useCallback(
    async (name: string) => {
      try {
        const created = await createFolderApi(userId, name)
        setFolders((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
        setFolderPages((prev) => ({
          ...prev,
          [created.id]: { noteIds: [], loaded: true, hasMore: false, isLoading: false },
        }))
        setSelectedFolderId(created.id)
        return created
      } catch {
        return null
      }
    },
    [userId],
  )

  const deleteFolder = useCallback(
    async (folderId: string) => {
      const ok = await deleteFolderApi(userId, folderId)
      if (!ok) return false
      setFolders((prev) => prev.filter((f) => f.id !== folderId))
      // Remove folder's notes from summaries
      setFolderPages((prev) => {
        const page = prev[folderId]
        if (page) {
          const removedIds = new Set(page.noteIds)
          setNoteSummariesById((s) => {
            const next = { ...s }
            for (const id of removedIds) delete next[id]
            return next
          })
        }
        const next = { ...prev }
        delete next[folderId]
        return next
      })
      setSelectedFolderId((current) => (current === folderId ? null : current))
      return true
    },
    [userId],
  )

  const renameFolder = useCallback(
    async (folderId: string, name: string) => {
      const updated = await renameFolderApi(userId, folderId, name)
      if (!updated) return false
      setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name: updated.name } : f)))
      return true
    },
    [userId],
  )

  const renameNote = useCallback(
    async (noteId: string, title: string) => {
      const updated = await updateNote(userId, noteId, { title })
      if (!updated) return false
      setNoteSummariesById((prev) => ({
        ...prev,
        [noteId]: { ...prev[noteId], title: updated.title },
      }))
      setSelectedNote((prev) =>
        prev?.id === noteId ? { ...prev, title: updated.title } : prev,
      )
      return true
    },
    [userId],
  )

  const moveNote = useCallback(
    async (noteId: string, folderId: string | null) => {
      const updated = await updateNote(userId, noteId, { folderId })
      if (!updated) return false
      setNoteSummariesById((prev) => ({
        ...prev,
        [noteId]: { ...prev[noteId], folderId: updated.folderId },
      }))
      setFolderPages((prev) => {
        const next: Record<string, FolderPage> = {}
        for (const [key, page] of Object.entries(prev)) {
          next[key] = { ...page, noteIds: page.noteIds.filter((id) => id !== noteId) }
        }
        const newKey = folderId ?? UNFILED_ID
        if (next[newKey]?.loaded) {
          next[newKey] = { ...next[newKey], noteIds: [noteId, ...next[newKey].noteIds] }
        }
        return next
      })
      setSelectedNote((prev) =>
        prev?.id === noteId ? { ...prev, folderId: updated.folderId } : prev,
      )
      return true
    },
    [userId],
  )

  const createNewNote = useCallback(async (payload?: { title?: string; folderId?: string | null; calendarEventId?: string }) => {
    if (createInFlightRef.current) return null
    try {
      createInFlightRef.current = true
      const title = payload?.title?.trim() ? payload.title.trim() : 'New note'
      const folderId = payload?.folderId ?? null
      const created = await createNote(userId, {
        title,
        folderId: folderId ?? undefined,
        calendarEventId: payload?.calendarEventId,
      })
      const summary = summaryFromRecord(created)
      setNoteSummariesById((prev) => ({ ...prev, [created.id]: summary }))
      const key = folderId ?? UNFILED_ID
      setFolderPages((prev) => {
        const page = prev[key]
        if (!page) return prev
        const alreadyIn = page.noteIds.includes(created.id)
        if (alreadyIn) return prev
        return { ...prev, [key]: { ...page, noteIds: [created.id, ...page.noteIds] } }
      })
      selectNote(created.id)
      window.dispatchEvent(new Event('dashboard-activity-refresh'))
      return created
    } catch {
      return null
    } finally {
      createInFlightRef.current = false
    }
  }, [userId, selectNote])

  const deleteById = useCallback(
    async (noteId: string) => {
      const ok = await deleteNote(userId, noteId)
      if (!ok) return false
      setNoteSummariesById((prev) => {
        const next = { ...prev }
        delete next[noteId]
        return next
      })
      setFolderPages((prev) => {
        const next: Record<string, FolderPage> = {}
        for (const [key, page] of Object.entries(prev)) {
          next[key] = { ...page, noteIds: page.noteIds.filter((id) => id !== noteId) }
        }
        return next
      })
      setSelectedId((current) => {
        if (current !== noteId) return current
        setSelectedNote(null)
        return null
      })
      return true
    },
    [userId],
  )

  const evictNote = useCallback((noteId: string) => {
    setNoteSummariesById((prev) => {
      const next = { ...prev }
      delete next[noteId]
      return next
    })
    setFolderPages((prev) => {
      const next: Record<string, FolderPage> = {}
      for (const [key, page] of Object.entries(prev)) {
        next[key] = { ...page, noteIds: page.noteIds.filter((id) => id !== noteId) }
      }
      return next
    })
    setSelectedId((current) => {
      if (current !== noteId) return current
      setSelectedNote(null)
      return null
    })
  }, [])

  const optimisticPatch = useCallback((noteId: string, patch: Patch) => {
    setNoteSummariesById((prev) => {
      const existing = prev[noteId]
      if (!existing) return prev
      return { ...prev, [noteId]: { ...existing, ...patch, updatedAt: Date.now() } }
    })
    setSelectedNote((prev) => {
      if (!prev || prev.id !== noteId) return prev
      return { ...prev, ...patch, updatedAt: Date.now() }
    })
    window.dispatchEvent(new Event('dashboard-activity-refresh'))
  }, [])

  const replaceNote = useCallback((note: NoteRecord) => {
    const summary = summaryFromRecord(note)
    setNoteSummariesById((prev) => ({ ...prev, [note.id]: summary }))
    setSelectedNote((prev) => {
      if (!prev || prev.id !== note.id) return prev
      return { ...prev, ...summary, noteMarkdown: note.noteMarkdown }
    })
    window.dispatchEvent(new Event('dashboard-activity-refresh'))
  }, [])

  // ── Attendees ─────────────────────────────────────────────────────────────

  const addAttendee = useCallback(async (noteId: string, email: string) => {
    try {
      const attendee = await addNoteAttendee(noteId, email)
      setNoteAttendeesByNoteId((prev) => {
        const existing = (prev[noteId] ?? []).filter((a) => a.email !== email)
        return { ...prev, [noteId]: [...existing, attendee] }
      })
      return attendee
    } catch {
      return null
    }
  }, [])

  const removeAttendee = useCallback(async (noteId: string, email: string) => {
    try {
      await removeNoteAttendee(noteId, email)
      setNoteAttendeesByNoteId((prev) => ({
        ...prev,
        [noteId]: (prev[noteId] ?? []).filter((a) => a.email !== email),
      }))
      return true
    } catch {
      return false
    }
  }, [])

  // Expose folderPages without cursor (internal detail)
  const folderPagesPublic = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(folderPages).map(([key, p]) => [
          key,
          { noteIds: p.noteIds, hasMore: p.hasMore, isLoading: p.isLoading, loaded: p.loaded },
        ]),
      ),
    [folderPages],
  )

  const value: DashboardNotesContextType = useMemo(
    () => ({
      isLoading,
      loadError,
      notes,
      noteSummariesById,
      folderPages: folderPagesPublic,
      folders,
      selectedNote,
      selectedNoteLoading,
      noteAttendeesByNoteId,
      loadMoreForFolder,
      selectedFolderId,
      selectedId,
      search,
      setSearch,
      selectFolder,
      selectNote,
      createFolder,
      deleteFolder,
      renameFolder,
      renameNote,
      moveNote,
      openCreateNoteDialog,
      refresh,
      createNewNote,
      deleteById,
      evictNote,
      optimisticPatch,
      replaceNote,
      addAttendee,
      removeAttendee,
    }),
    [
      isLoading,
      loadError,
      notes,
      noteSummariesById,
      folderPagesPublic,
      folders,
      selectedNote,
      selectedNoteLoading,
      noteAttendeesByNoteId,
      loadMoreForFolder,
      selectedFolderId,
      selectedId,
      search,
      setSearch,
      selectFolder,
      selectNote,
      createFolder,
      deleteFolder,
      renameFolder,
      renameNote,
      moveNote,
      openCreateNoteDialog,
      refresh,
      createNewNote,
      deleteById,
      evictNote,
      optimisticPatch,
      replaceNote,
      addAttendee,
      removeAttendee,
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
        onCreate={async ({ title, folderId }) => {
          const created = await createNewNote({ title, folderId })
          return Boolean(created)
        }}
      />
    </DashboardNotesContext.Provider>
  )
}

export function useDashboardNotes() {
  const ctx = useContext(DashboardNotesContext)
  if (!ctx) throw new Error('useDashboardNotes must be used within DashboardNotesProvider')
  return ctx
}
