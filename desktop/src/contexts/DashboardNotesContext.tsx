import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import type { NoteRecord } from '@/types/note'
import type { FolderRecord } from '@/types/folder'
import { CreateNoteDialog } from '@/components/dialog/CreateNoteDialog'
import { createFolder as createFolderApi, deleteFolder as deleteFolderApi, listFolders, renameFolder as renameFolderApi } from '@/lib/folders-client'
import { createNote, deleteNote, listNotesPage, updateNote } from '@/lib/notes-client'

type Patch = Partial<Pick<NoteRecord, 'title' | 'folderId' | 'noteMarkdown'>>

type DashboardNotesContextType = {
  isLoading: boolean
  loadError: string | null
  notes: NoteRecord[]
  filteredNotes: NoteRecord[]
  folders: FolderRecord[]
  folderPagination: Record<string, { hasMore: boolean; isLoading: boolean }>
  loadMoreForFolder: (folderId: string | null) => Promise<void>
  selectedFolderId: string | null
  selectFolder: (id: string | null) => void
  createFolder: (name: string) => Promise<FolderRecord | null>
  deleteFolder: (folderId: string) => Promise<boolean>
  renameFolder: (folderId: string, name: string) => Promise<boolean>
  renameNote: (noteId: string, title: string) => Promise<boolean>
  moveNote: (noteId: string, folderId: string | null) => Promise<boolean>
  selectedId: string | null
  selected: NoteRecord | null
  search: string
  setSearch: (value: string) => void
  selectNote: (id: string | null) => void
  openCreateNoteDialog: () => void
  refresh: () => Promise<void>
  createNewNote: (payload?: { title?: string; folderId?: string | null; eventLink?: { providerEventId: string; connectionId: string; calendarId: string } }) => Promise<NoteRecord | null>
  deleteById: (noteId: string) => Promise<boolean>
  evictNote: (noteId: string) => void
  optimisticPatch: (noteId: string, patch: Patch) => void
  replaceNote: (note: NoteRecord) => void
}

const DashboardNotesContext = createContext<DashboardNotesContextType | null>(null)
const UNFILED_ID = '__unfiled__'
const PAGE_SIZE = 20
const LS_SELECTED_NOTE = 'dashboard:selectedNoteId'
const LS_SELECTED_FOLDER = 'dashboard:selectedFolderId'
const ACTIVITY_REFRESH_EVENT = 'dashboard-activity-refresh'

export function excerpt(markdown: string) {
  const text = markdown.replace(/[#*_`>[\]()-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return 'No content yet.'
  return text.length > 90 ? `${text.slice(0, 90).trim()}…` : text
}

export function DashboardNotesProvider({
  userId,
  children,
}: {
  userId?: string
  children: React.ReactNode
}) {
  const [notes, setNotes] = useState<NoteRecord[]>([])
  const [folders, setFolders] = useState<FolderRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showCreateNoteDialog, setShowCreateNoteDialog] = useState(false)
  const [folderPagination, setFolderPagination] = useState<Record<string, { hasMore: boolean; isLoading: boolean; cursor?: string }>>({})
  const createInFlightRef = useRef(false)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const folderList = await listFolders(userId)
      setFolders(folderList)

      const results = await Promise.all([
        listNotesPage({ unfiled: true, limit: PAGE_SIZE }),
        ...folderList.map((f) => listNotesPage({ folderId: f.id, limit: PAGE_SIZE })),
      ])

      const nextPagination: Record<string, { hasMore: boolean; isLoading: boolean; cursor?: string }> = {}
      const nextNotes: NoteRecord[] = []

      const unfiledResult = results[0]
      nextPagination[UNFILED_ID] = {
        hasMore: unfiledResult.hasMore,
        isLoading: false,
        cursor: unfiledResult.nextCursor,
      }
      nextNotes.push(...unfiledResult.notes)

      folderList.forEach((folder, idx) => {
        const page = results[idx + 1]
        nextPagination[folder.id] = {
          hasMore: page.hasMore,
          isLoading: false,
          cursor: page.nextCursor,
        }
        nextNotes.push(...page.notes)
      })

      setNotes(nextNotes)
      setFolderPagination(nextPagination)
      setSelectedFolderId((current) => {
        const saved = localStorage.getItem(LS_SELECTED_FOLDER)
        const candidate = current ?? saved
        if (!candidate) return null
        if (folderList.some((f) => f.id === candidate)) return candidate
        return null
      })
      setSelectedId((current) => {
        const saved = localStorage.getItem(LS_SELECTED_NOTE)
        const candidate = current ?? saved
        if (candidate && nextNotes.some((n) => n.id === candidate)) return candidate
        return null
      })
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load notes')
      setNotes([])
      setFolders([])
      setFolderPagination({})
      setSelectedFolderId(null)
      setSelectedId(null)
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase()
    return notes.filter((n) => {
      if (!q) return true
      const hay = `${n.title}\n${excerpt(n.noteMarkdown)}`.toLowerCase()
      return hay.includes(q)
    })
  }, [notes, search])

  const selected = useMemo(
    () => (selectedId ? notes.find((n) => n.id === selectedId) ?? null : null),
    [notes, selectedId],
  )

  const selectNote = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) localStorage.setItem(LS_SELECTED_NOTE, id)
    else localStorage.removeItem(LS_SELECTED_NOTE)
  }, [])

  const selectFolder = useCallback((id: string | null) => {
    setSelectedFolderId(id)
    if (id) localStorage.setItem(LS_SELECTED_FOLDER, id)
    else localStorage.removeItem(LS_SELECTED_FOLDER)
  }, [])

  const openCreateNoteDialog = useCallback(() => {
    setShowCreateNoteDialog(true)
  }, [])

  const loadMoreForFolder = useCallback(
    async (folderId: string | null) => {
      const key = folderId ?? UNFILED_ID
      const state = folderPagination[key]
      if (!state || state.isLoading || !state.hasMore) return

      setFolderPagination((prev) => ({
        ...prev,
        [key]: { ...prev[key], isLoading: true },
      }))

      try {
        const page = await listNotesPage({
          folderId: folderId ?? undefined,
          unfiled: folderId ? false : true,
          limit: PAGE_SIZE,
          cursor: state.cursor ?? null,
        })

        setNotes((prev) => {
          const existing = new Set(prev.map((n) => n.id))
          const merged = [...prev]
          for (const n of page.notes) {
            if (!existing.has(n.id)) {
              merged.push(n)
              existing.add(n.id)
            }
          }
          return merged
        })

        setFolderPagination((prev) => ({
          ...prev,
          [key]: { hasMore: page.hasMore, isLoading: false, cursor: page.nextCursor },
        }))
      } catch {
        setFolderPagination((prev) => ({
          ...prev,
          [key]: { ...prev[key], isLoading: false },
        }))
      }
    },
    [folderPagination],
  )

  const createFolder = useCallback(
    async (name: string) => {
      try {
        const created = await createFolderApi(userId, name)
        setFolders((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
        setFolderPagination((prev) => ({
          ...prev,
          [created.id]: { hasMore: false, isLoading: false },
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
      setFolderPagination((prev) => {
        const next = { ...prev }
        delete next[folderId]
        return next
      })
      setSelectedFolderId((current) => {
        if (current === folderId) { localStorage.removeItem(LS_SELECTED_FOLDER); return null }
        return current
      })
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
      setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, title: updated.title } : n)))
      return true
    },
    [userId],
  )

  const moveNote = useCallback(
    async (noteId: string, folderId: string | null) => {
      const updated = await updateNote(userId, noteId, { folderId })
      if (!updated) return false
      setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, folderId: updated.folderId } : n)))
      return true
    },
    [userId],
  )

  const createNewNote = useCallback(async (payload?: { title?: string; folderId?: string | null; eventLink?: { providerEventId: string; connectionId: string; calendarId: string } }) => {
    if (createInFlightRef.current) return null
    try {
      createInFlightRef.current = true
      const title = payload?.title?.trim() ? payload.title.trim() : 'New note'
      const folderId = payload?.folderId ?? null
      const created = await createNote(userId, {
        title,
        folderId: folderId ?? undefined,
        providerEventId: payload?.eventLink?.providerEventId,
        connectionId: payload?.eventLink?.connectionId,
        calendarId: payload?.eventLink?.calendarId,
      })
      setNotes((prev) => {
        const existing = prev.find((n) => n.id === created.id)
        if (existing) {
          return prev.map((n) => (n.id === created.id ? created : n))
        }
        return [created, ...prev]
      })
      setSelectedId(created.id)
      window.dispatchEvent(new Event(ACTIVITY_REFRESH_EVENT))
      return created
    } catch {
      return null
    } finally {
      createInFlightRef.current = false
    }
  }, [userId])

  const deleteById = useCallback(
    async (noteId: string) => {
      const ok = await deleteNote(userId, noteId)
      if (!ok) return false

      setNotes((prev) => prev.filter((n) => n.id !== noteId))
      setSelectedId((current) => {
        if (current !== noteId) return current
        localStorage.removeItem(LS_SELECTED_NOTE)
        const remaining = notes.filter((n) => n.id !== noteId)
        return remaining[0]?.id ?? null
      })
      return true
    },
    [notes, userId],
  )

  const evictNote = useCallback((noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== noteId))
    setSelectedId((current) => {
      if (current !== noteId) return current
      localStorage.removeItem(LS_SELECTED_NOTE)
      return null
    })
  }, [])

  const optimisticPatch = useCallback((noteId: string, patch: Patch) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === noteId ? { ...n, ...patch, updatedAt: Date.now() } : n)),
    )
  }, [])

  // Listen for AI-driven note edits and update local state in real time
  useEffect(() => {
    const handler = (e: Event) => {
      const { noteId, content } = (e as CustomEvent<{ noteId: string; content: string }>).detail
      if (noteId && content != null) {
        optimisticPatch(noteId, { noteMarkdown: content })
      }
    }
    window.addEventListener('note-updated-by-ai', handler)
    return () => window.removeEventListener('note-updated-by-ai', handler)
  }, [optimisticPatch])

  const replaceNote = useCallback((note: NoteRecord) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === note.id ? note : n)),
    )
  }, [])

  const value: DashboardNotesContextType = useMemo(
    () => ({
      isLoading,
      loadError,
      notes,
      filteredNotes,
      folders,
      folderPagination: Object.fromEntries(
        Object.entries(folderPagination).map(([key, value]) => [
          key,
          { hasMore: value.hasMore, isLoading: value.isLoading },
        ]),
      ),
      loadMoreForFolder,
      selectedFolderId,
      selectFolder,
      createFolder,
      deleteFolder,
      renameFolder,
      renameNote,
      moveNote,
      selectedId,
      selected,
      search,
      setSearch,
      selectNote,
      openCreateNoteDialog,
      refresh,
      createNewNote,
      deleteById,
      evictNote,
      optimisticPatch,
      replaceNote,
    }),
    [
      isLoading,
      loadError,
      notes,
      filteredNotes,
      folders,
      folderPagination,
      loadMoreForFolder,
      selectedFolderId,
      selectFolder,
      createFolder,
      deleteFolder,
      renameFolder,
      renameNote,
      moveNote,
      selectedId,
      selected,
      search,
      setSearch,
      selectNote,
      openCreateNoteDialog,
      refresh,
      createNewNote,
      deleteById,
      evictNote,
      optimisticPatch,
      replaceNote,
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
