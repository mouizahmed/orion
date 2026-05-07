import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Folder, Grid3X3, RefreshCw, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { auth } from '@/config/firebase'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useWindowState } from '@/hooks/useWindowState'
import { useDashboardNotes } from '@/contexts/DashboardNotesContext'
import { searchAll } from '@/lib/search-client'
import { desktopApi } from '@/lib/desktop-api'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'
const CALENDAR_REFRESH_EVENT = 'dashboard-calendar-refresh'

export default function DashboardTopBar({
  onBackToOverlay,
}: {
  onBackToOverlay: () => void
}) {
  const isMacOS = desktopApi.platform.current() === 'darwin'
  const { isMaximized } = useWindowState()
  const {
    folders,
    isLoading,
    notes,
    refresh,
    selectFolder,
    selectNote,
  } = useDashboardNotes()
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement | null>(null)
  const calendarRefreshInFlightRef = useRef(false)

  const query = searchQuery.trim().toLowerCase()
  const defaultFolders = useMemo(
    () =>
      folders
        .slice(0, 6),
    [folders],
  )
  const defaultMeetings = useMemo(
    () =>
      notes
        .slice(0, 8),
    [notes],
  )
  const [searchResults, setSearchResults] = useState<{ folders: typeof folders; notes: typeof notes }>({
    folders: [],
    notes: [],
  })
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingMoreFolders, setIsLoadingMoreFolders] = useState(false)
  const [isLoadingMoreMeetings, setIsLoadingMoreMeetings] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchPagination, setSearchPagination] = useState({
    notes: { nextOffset: 0, hasMore: false },
    folders: { nextOffset: 0, hasMore: false },
  })

  useEffect(() => {
    let cancelled = false
    const trimmed = searchQuery.trim()

    if (!trimmed) {
      setSearchResults({ folders: [], notes: [] })
      setIsSearching(false)
      setIsLoadingMoreFolders(false)
      setIsLoadingMoreMeetings(false)
      setSearchError(null)
      setSearchPagination({
        notes: { nextOffset: 0, hasMore: false },
        folders: { nextOffset: 0, hasMore: false },
      })
      return
    }

    setIsSearching(true)
    setSearchError(null)

    const timer = window.setTimeout(async () => {
      try {
        const result = await searchAll({ query: trimmed, limit: 12, noteOffset: 0, folderOffset: 0 })
        if (cancelled) return
        setSearchResults({
          folders: result.folders,
          notes: result.notes,
        })
        setSearchPagination({
          notes: {
            nextOffset: result.pagination.notes.nextOffset,
            hasMore: result.pagination.notes.hasMore,
          },
          folders: {
            nextOffset: result.pagination.folders.nextOffset,
            hasMore: result.pagination.folders.hasMore,
          },
        })
      } catch (error) {
        if (cancelled) return
        setSearchResults({ folders: [], notes: [] })
        setSearchError(error instanceof Error ? error.message : 'Search failed')
        setSearchPagination({
          notes: { nextOffset: 0, hasMore: false },
          folders: { nextOffset: 0, hasMore: false },
        })
      } finally {
        if (!cancelled) {
          setIsSearching(false)
        }
      }
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [searchQuery])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!searchContainerRef.current) return
      if (!searchContainerRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSearchOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const showRemote = query.length > 0
  const filteredFolders = showRemote ? searchResults.folders : defaultFolders
  const filteredMeetings = showRemote ? searchResults.notes : defaultMeetings

  const loadMoreFolders = async () => {
    const trimmed = searchQuery.trim()
    if (!trimmed || !searchPagination.folders.hasMore || isLoadingMoreFolders) return
    setIsLoadingMoreFolders(true)
    setSearchError(null)
    try {
      const result = await searchAll({
        query: trimmed,
        limit: 12,
        noteOffset: searchPagination.notes.nextOffset,
        folderOffset: searchPagination.folders.nextOffset,
        noteLimit: 0,
        folderLimit: 12,
      })
      setSearchResults((prev) => {
        const existing = new Set(prev.folders.map((folder) => folder.id))
        const mergedFolders = [...prev.folders]
        for (const folder of result.folders) {
          if (!existing.has(folder.id)) {
            mergedFolders.push(folder)
            existing.add(folder.id)
          }
        }
        return { ...prev, folders: mergedFolders }
      })
      setSearchPagination((prev) => ({
        notes: prev.notes,
        folders: {
          nextOffset: result.pagination.folders.nextOffset,
          hasMore: result.pagination.folders.hasMore,
        },
      }))
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Search failed')
    } finally {
      setIsLoadingMoreFolders(false)
    }
  }

  const loadMoreMeetings = async () => {
    const trimmed = searchQuery.trim()
    if (!trimmed || !searchPagination.notes.hasMore || isLoadingMoreMeetings) return
    setIsLoadingMoreMeetings(true)
    setSearchError(null)
    try {
      const result = await searchAll({
        query: trimmed,
        limit: 12,
        noteOffset: searchPagination.notes.nextOffset,
        folderOffset: searchPagination.folders.nextOffset,
        noteLimit: 12,
        folderLimit: 0,
      })
      setSearchResults((prev) => {
        const existing = new Set(prev.notes.map((note) => note.id))
        const mergedNotes = [...prev.notes]
        for (const note of result.notes) {
          if (!existing.has(note.id)) {
            mergedNotes.push(note)
            existing.add(note.id)
          }
        }
        return { ...prev, notes: mergedNotes }
      })
      setSearchPagination((prev) => ({
        notes: {
          nextOffset: result.pagination.notes.nextOffset,
          hasMore: result.pagination.notes.hasMore,
        },
        folders: prev.folders,
      }))
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Search failed')
    } finally {
      setIsLoadingMoreMeetings(false)
    }
  }

  const handleRefresh = async () => {
    void refresh()
    window.dispatchEvent(new Event('dashboard-activity-refresh'))
    if (calendarRefreshInFlightRef.current) return

    calendarRefreshInFlightRef.current = true

    try {
      const currentUser = auth.currentUser
      if (currentUser) {
        const idToken = await currentUser.getIdToken()
        await fetch(`${API_BASE_URL}/calendar/sync?wait=true`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
        })
      }
    } finally {
      calendarRefreshInFlightRef.current = false
      window.dispatchEvent(new Event(CALENDAR_REFRESH_EVENT))
    }
  }

  return (
    <div
      className="relative flex h-12 w-full items-center justify-between px-2 text-xs"
      style={
        {
          paddingLeft: isMacOS && !isMaximized ? '80px' : undefined,
          paddingRight: !isMacOS ? '140px' : undefined,
        } as React.CSSProperties
      }
    >
      <div
        className="absolute bottom-0 left-0 top-0 z-0"
        style={
          {
            right: isMacOS ? '0px' : '140px',
            WebkitAppRegion: 'drag',
          } as React.CSSProperties
        }
      />
      <div className="relative z-10 flex items-center gap-2">
        <img src="/orionly-mark.svg" alt="Orionly Logo" className="h-6 w-6" />
        <SidebarTrigger />

        <div
          ref={searchContainerRef}
          className="relative"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="flex items-center gap-2 rounded-full border border-neutral-200/80 bg-white/72 px-3 py-1 text-xs text-neutral-700 ring-1 ring-neutral-900/5 backdrop-blur-md dark:border-white/12 dark:bg-[#171417]/80 dark:text-neutral-200 dark:ring-white/8">
            <Search size={12} className="text-neutral-500 dark:text-neutral-400" />
            <Input
              variant="ghost"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setIsSearchOpen(true)
              }}
              onFocus={() => setIsSearchOpen(true)}
              placeholder="Search people, folders, companies, or meetings"
              className="h-6 w-[420px] p-0 text-xs text-neutral-900 placeholder:text-neutral-500 dark:text-neutral-100 dark:placeholder:text-neutral-400"
            />
          </div>

          {isSearchOpen ? (
            <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-[520px] overflow-hidden rounded-xl border border-neutral-200/80 bg-white/88 text-neutral-900 shadow-[0_20px_48px_-32px_rgba(15,23,42,0.52)] backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/95 dark:text-neutral-100 dark:shadow-2xl">
              <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-white/10">
                <span className="text-xs text-neutral-600 dark:text-neutral-300">
                  Search people, folders, companies, or meetings
                </span>
                <span className="rounded-full border border-neutral-200 bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:border-white/12 dark:bg-white/5 dark:text-neutral-300">
                  ESC
                </span>
              </div>

              <div className="sidebar-scrollbar max-h-[340px] overflow-y-auto p-2">
                {isSearching ? (
                  <div className="px-2 py-2 text-xs text-neutral-500">Searching...</div>
                ) : null}
                {searchError ? (
                  <div className="px-2 py-2 text-xs text-red-400">{searchError}</div>
                ) : null}
                <div className="mb-1 px-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">Folders</div>
                {filteredFolders.length > 0 ? (
                  <div className="space-y-1">
                    {filteredFolders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        className="flex h-8 w-full items-center gap-2 rounded-full px-2 text-left text-xs text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-white/10"
                        onClick={() => {
                          selectFolder(folder.id)
                          setIsSearchOpen(false)
                        }}
                      >
                        <Folder size={14} className="text-neutral-500 dark:text-neutral-300" />
                        <span className="truncate">{folder.name}</span>
                      </button>
                    ))}
                    {showRemote && searchPagination.folders.hasMore ? (
                      <button
                        type="button"
                        className="h-8 w-full rounded-full px-2 text-left text-xs text-[#7c3aed] hover:bg-neutral-100 dark:text-[#9f73f2] dark:hover:bg-white/10"
                        onClick={() => {
                          void loadMoreFolders()
                        }}
                      >
                        {isLoadingMoreFolders ? 'Loading more...' : 'Load more folders'}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="px-2 py-2 text-xs text-neutral-500">No folders</div>
                )}

                <div className="mb-1 mt-3 px-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">Meetings</div>
                {filteredMeetings.length > 0 ? (
                  <div className="space-y-1">
                    {filteredMeetings.map((note) => (
                      <button
                        key={note.id}
                        type="button"
                        className="flex h-8 w-full items-center gap-2 rounded-full px-2 text-left text-xs text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-white/10"
                        onClick={() => {
                          selectNote(note.id)
                          selectFolder(note.folderId ?? null)
                          setIsSearchOpen(false)
                        }}
                      >
                        <span className="text-xs text-neutral-300">•</span>
                        <span className="truncate">{note.title || 'Untitled meeting'}</span>
                      </button>
                    ))}
                    {showRemote && searchPagination.notes.hasMore ? (
                      <button
                        type="button"
                        className="h-8 w-full rounded-full px-2 text-left text-xs text-[#7c3aed] hover:bg-neutral-100 dark:text-[#9f73f2] dark:hover:bg-white/10"
                        onClick={() => {
                          void loadMoreMeetings()
                        }}
                      >
                        {isLoadingMoreMeetings ? 'Loading more...' : 'Load more meetings'}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="px-2 py-2 text-xs text-neutral-500">No meetings</div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="relative z-10 flex items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 rounded-full"
          onClick={() => {
            void handleRefresh()
          }}
          disabled={isLoading}
          aria-label="Refresh dashboard"
          title="Refresh dashboard"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : undefined} />
          Refresh
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 rounded-full"
          onClick={onBackToOverlay}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Grid3X3 size={14} />
          Back to overlay
        </Button>
      </div>
    </div>
  )
}
