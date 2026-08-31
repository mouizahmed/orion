import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Folder, Plus, RefreshCw, Search, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { useWindowState } from '@/features/dashboard/useWindowState'
import { useDashboardNotes } from '@/features/notes/DashboardNotesContext'
import { desktopApi } from '@/lib/desktop-api'
import { useAuth } from '@/features/auth/AuthContext'
import { DropdownItem, DropdownIconSlot, DropdownPopover } from '@/components/ui/dropdown-list'
import { publicAssetUrl } from '@/lib/public-asset'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { useDashboardSearchQuery } from '@/features/notes/queries/useDashboardSearchQuery'
import { useRecentNotesQuery } from '@/features/notes/queries/useNotesQueries'
import { useCalendarSyncMutation } from '@/features/calendar/useCalendarSyncMutation'

export default function DashboardTopBar({
  onBackToOverlay,
  onOpenNotes,
}: {
  onBackToOverlay: () => void
  onOpenNotes?: () => void
}) {
  const isMacOS = desktopApi.platform.current() === 'darwin'
  const { isCompact, setOpen: setNavigationOpen, setCompactPanel } = useSidebar()
  const { user } = useAuth()
  const { isMaximized } = useWindowState()
  const { folders, refresh, selectFolder, selectNote } = useDashboardNotes()
  const recentNotesQuery = useRecentNotesQuery(user?.id)
  const recentNotes = useMemo(
    () => recentNotesQuery.data?.pages.flatMap((page) => page.notes) ?? [],
    [recentNotesQuery.data],
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isRecordOpen, setIsRecordOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement | null>(null)
  const recordContainerRef = useRef<HTMLDivElement | null>(null)
  const calendarSyncMutation = useCalendarSyncMutation(user?.id)

  const closeCompactOverlay = () => {
    if (!isCompact) return
    setNavigationOpen(false)
    setCompactPanel(null)
  }

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 200)
  const search = useDashboardSearchQuery(user?.id, debouncedSearchQuery)
  const query = search.query
  const defaultFolders = useMemo(() => folders.slice(0, 6), [folders])
  const defaultMeetings = useMemo(() => recentNotes.slice(0, 8), [recentNotes])
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setIsSearchOpen(false)
      }
      if (recordContainerRef.current && !recordContainerRef.current.contains(event.target as Node)) {
        setIsRecordOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSearchOpen(false)
        setIsRecordOpen(false)
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
  const filteredFolders = showRemote
    ? (search.folders.data?.pages.flatMap((page) => page.folders) ?? [])
    : defaultFolders
  const filteredMeetings = showRemote ? (search.notes.data?.pages.flatMap((page) => page.notes) ?? []) : defaultMeetings
  const isSearching = search.folders.isLoading || search.notes.isLoading
  const searchError = search.folders.error ?? search.notes.error

  const handleRefresh = async () => {
    if (isRefreshing || calendarSyncMutation.isPending) return
    setIsRefreshing(true)
    try {
      await refresh()
      await calendarSyncMutation.mutateAsync()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to refresh dashboard')
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <div
      className="relative flex h-12 w-full min-w-0 items-center gap-2 px-2 text-xs"
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
      <div className="relative z-10 flex min-w-0 items-center gap-2">
        <img src={publicAssetUrl('orion-mark.svg')} alt="Orion Logo" className="h-6 w-6" />
        <SidebarTrigger />

        <div
          ref={searchContainerRef}
          className="relative min-w-0 w-[clamp(180px,32vw,420px)]"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="flex min-w-0 max-w-[420px] items-center gap-2 rounded-full border border-neutral-200/80 bg-white/72 px-3 py-1 text-xs text-neutral-700 ring-1 ring-neutral-900/5 backdrop-blur-md dark:border-white/12 dark:bg-[#171417]/80 dark:text-neutral-200 dark:ring-white/8">
            <Search size={12} className="text-neutral-500 dark:text-neutral-400" />
            <Input
              variant="ghost"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setIsSearchOpen(true)
              }}
              onFocus={() => {
                closeCompactOverlay()
                setIsSearchOpen(true)
              }}
              placeholder={isCompact ? 'Search notes and meetings' : 'Search people, folders, or meetings'}
              className="h-6 min-w-0 w-full p-0 text-xs text-neutral-900 placeholder:text-neutral-500 dark:text-neutral-100 dark:placeholder:text-neutral-400"
            />
          </div>

          {isSearchOpen ? (
            <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-[520px] overflow-hidden rounded-xl border border-neutral-200/80 bg-white/88 text-neutral-900 shadow-[0_20px_48px_-32px_rgba(15,23,42,0.52)] backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/95 dark:text-neutral-100 dark:shadow-2xl">
              <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-white/10">
                <span className="text-xs text-neutral-600 dark:text-neutral-300">
                  Search people, folders, or meetings
                </span>
                <span className="rounded-full border border-neutral-200 bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:border-white/12 dark:bg-white/5 dark:text-neutral-300">
                  ESC
                </span>
              </div>

              <div className="sidebar-scrollbar max-h-[340px] overflow-y-auto p-2">
                {isSearching ? <div className="px-2 py-2 text-xs text-neutral-500">Searching...</div> : null}
                {searchError ? (
                  <div className="px-2 py-2 text-xs text-red-400">
                    {searchError instanceof Error ? searchError.message : 'Search failed'}
                  </div>
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
                          onOpenNotes?.()
                          selectNote(null)
                          selectFolder(folder.id)
                          setIsSearchOpen(false)
                        }}
                      >
                        <Folder size={14} className="text-neutral-500 dark:text-neutral-300" />
                        <span className="truncate">{folder.name}</span>
                      </button>
                    ))}
                    {showRemote && search.folders.hasNextPage ? (
                      <button
                        type="button"
                        className="h-8 w-full rounded-full px-2 text-left text-xs text-[#7c3aed] hover:bg-neutral-100 dark:text-[#9f73f2] dark:hover:bg-white/10"
                        onClick={() => {
                          void search.folders.fetchNextPage()
                        }}
                      >
                        {search.folders.isFetchingNextPage ? 'Loading more...' : 'Load more folders'}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="px-2 py-2 text-xs text-neutral-500">No folders</div>
                )}

                <div className="mb-1 mt-3 px-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                  Meetings
                </div>
                {filteredMeetings.length > 0 ? (
                  <div className="space-y-1">
                    {filteredMeetings.map((note) => (
                      <button
                        key={note.id}
                        type="button"
                        className="flex h-8 w-full items-center gap-2 rounded-full px-2 text-left text-xs text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-white/10"
                        onClick={() => {
                          onOpenNotes?.()
                          selectNote(note.id)
                          selectFolder(note.folderId ?? null)
                          setIsSearchOpen(false)
                        }}
                      >
                        <span className="text-xs text-neutral-300">•</span>
                        <span className="truncate">{note.title || 'Untitled meeting'}</span>
                      </button>
                    ))}
                    {showRemote && search.notes.hasNextPage ? (
                      <button
                        type="button"
                        className="h-8 w-full rounded-full px-2 text-left text-xs text-[#7c3aed] hover:bg-neutral-100 dark:text-[#9f73f2] dark:hover:bg-white/10"
                        onClick={() => {
                          void search.notes.fetchNextPage()
                        }}
                      >
                        {search.notes.isFetchingNextPage ? 'Loading more...' : 'Load more meetings'}
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

      <div className="relative z-10 flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 rounded-full"
          onClick={() => {
            closeCompactOverlay()
            void handleRefresh()
          }}
          disabled={isRefreshing || calendarSyncMutation.isPending}
          aria-busy={isRefreshing || calendarSyncMutation.isPending}
          aria-label="Refresh dashboard"
          title="Refresh dashboard"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <RefreshCw
            size={14}
            className={isRefreshing || calendarSyncMutation.isPending ? 'animate-spin' : undefined}
          />
        </Button>
        <div
          ref={recordContainerRef}
          className="relative"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Button
            type="button"
            variant="default"
            size="sm"
            className="h-8 rounded-full"
            onClick={() => {
              closeCompactOverlay()
              setIsRecordOpen((o) => !o)
            }}
          >
            <Plus size={14} />
            Record
          </Button>
          {isRecordOpen ? (
            <DropdownPopover align="start" width="sm" className="w-fit min-w-0">
              <DropdownItem
                className="whitespace-nowrap"
                onClick={() => {
                  setIsRecordOpen(false)
                  onBackToOverlay()
                }}
              >
                <DropdownIconSlot>
                  <AudioLines size={13} />
                </DropdownIconSlot>
                Start new meeting
              </DropdownItem>
              <DropdownItem className="whitespace-nowrap" disabled>
                <DropdownIconSlot>
                  <Upload size={13} />
                </DropdownIconSlot>
                Upload an audio file
              </DropdownItem>
            </DropdownPopover>
          ) : null}
        </div>
      </div>
    </div>
  )
}
