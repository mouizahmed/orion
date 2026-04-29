import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Folder, Grid3X3, RefreshCw, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useWindowState } from '@/hooks/useWindowState'
import { useDashboardNotes } from '@/contexts/DashboardNotesContext'
import { searchAll } from '@/lib/search-client'

export default function DashboardTopBar({
  onBackToOverlay,
}: {
  onBackToOverlay: () => void
}) {
  const isMacOS = window.env?.platform === 'darwin'
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
        <img src="/Document.svg" alt="Sunless Logo" className="h-6 w-6" />
        <SidebarTrigger />

        <div
          ref={searchContainerRef}
          className="relative"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="flex items-center gap-2 rounded-full border border-white/12 bg-[#171417]/80 px-3 py-1 text-xs text-neutral-200 ring-1 ring-white/8 backdrop-blur-md">
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
              className="h-6 w-[420px] p-0 text-xs text-neutral-100 placeholder:text-neutral-400"
            />
          </div>

          {isSearchOpen ? (
            <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-[520px] overflow-hidden rounded-xl border border-white/10 bg-[#171417]/95 text-neutral-100 shadow-2xl backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                <span className="text-xs text-neutral-300">
                  Search people, folders, companies, or meetings
                </span>
                <span className="rounded-full border border-white/12 bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-300">
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
                <div className="mb-1 px-1 text-xs font-semibold text-neutral-400">Folders</div>
                {filteredFolders.length > 0 ? (
                  <div className="space-y-1">
                    {filteredFolders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        className="flex h-8 w-full items-center gap-2 rounded-full px-2 text-left text-xs text-neutral-100 hover:bg-white/10"
                        onClick={() => {
                          selectFolder(folder.id)
                          setIsSearchOpen(false)
                        }}
                      >
                        <Folder size={14} className="text-neutral-300" />
                        <span className="truncate">{folder.name}</span>
                      </button>
                    ))}
                    {showRemote && searchPagination.folders.hasMore ? (
                      <button
                        type="button"
                        className="h-8 w-full rounded-full px-2 text-left text-xs text-[#9f73f2] hover:bg-white/10"
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

                <div className="mb-1 mt-3 px-1 text-xs font-semibold text-neutral-400">Meetings</div>
                {filteredMeetings.length > 0 ? (
                  <div className="space-y-1">
                    {filteredMeetings.map((note) => (
                      <button
                        key={note.id}
                        type="button"
                        className="flex h-8 w-full items-center gap-2 rounded-full px-2 text-left text-xs text-neutral-100 hover:bg-white/10"
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
                        className="h-8 w-full rounded-full px-2 text-left text-xs text-[#9f73f2] hover:bg-white/10"
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
          variant="ghost"
          size="sm"
          className="h-8 rounded-full border border-white/12 bg-[#171417]/80 px-3 text-xs leading-none text-neutral-200 hover:bg-white/10 hover:text-white"
          onClick={() => {
            void refresh()
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
          variant="ghost"
          size="sm"
          className="h-8 rounded-full border border-white/12 bg-[#171417]/80 px-3 text-xs leading-none text-neutral-200 hover:bg-white/10 hover:text-white"
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

