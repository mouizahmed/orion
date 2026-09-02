import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Folder } from 'lucide-react'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import type { FolderRecord } from '@/features/notes/folder-types'
import { useDashboardSearchQuery } from '@/features/notes/queries/useDashboardSearchQuery'
import { useRecentNotesQuery } from '@/features/notes/queries/useNotesQueries'
import { useDebouncedValue } from '@/lib/use-debounced-value'

export default function DashboardSearchDialog({
  open,
  onOpenChange,
  accountId,
  folders,
  onSelectFolder,
  onSelectNote,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accountId?: string
  folders: FolderRecord[]
  onSelectFolder: (folderId: string) => void
  onSelectNote: (noteId: string, folderId: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 200)
  const search = useDashboardSearchQuery(accountId, debouncedSearchQuery)
  const recentNotesQuery = useRecentNotesQuery(accountId)
  const recentNotes = useMemo(
    () => recentNotesQuery.data?.pages.flatMap((page) => page.notes) ?? [],
    [recentNotesQuery.data],
  )
  const normalizedInput = searchQuery.trim().toLocaleLowerCase()
  const showRemote = normalizedInput.length > 0
  const visibleFolders = showRemote
    ? (search.folders.data?.pages.flatMap((page) => page.folders) ?? [])
    : folders.slice(0, 6)
  const visibleMeetings = showRemote
    ? (search.notes.data?.pages.flatMap((page) => page.notes) ?? [])
    : recentNotes.slice(0, 8)
  const isSearching = (showRemote && normalizedInput !== search.query)
    || search.folders.isLoading
    || search.notes.isLoading
  const searchError = search.folders.error ?? search.notes.error

  useEffect(() => {
    if (!open) return
    setSearchQuery('')
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(focusTimer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onOpenChange, open])

  const close = () => onOpenChange(false)

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search Orion">
      <CommandInput
        ref={inputRef}
        value={searchQuery}
        onValueChange={setSearchQuery}
        placeholder="Search folders or meetings"
      />
      <CommandList>
        {isSearching ? <div className="px-2.5 py-3 text-xs text-neutral-500">Searching...</div> : null}
        {searchError ? (
          <div className="px-2.5 py-3 text-xs text-red-500">
            {searchError instanceof Error ? searchError.message : 'Search failed'}
          </div>
        ) : null}
        {!isSearching && !searchError && visibleFolders.length === 0 && visibleMeetings.length === 0 ? (
          <CommandEmpty>No results found</CommandEmpty>
        ) : null}

        {visibleFolders.length > 0 ? (
          <CommandGroup heading="Folders">
            {visibleFolders.map((folder) => (
              <CommandItem
                key={folder.id}
                value={`folder ${folder.name} ${folder.id}`}
                onSelect={() => {
                  onSelectFolder(folder.id)
                  close()
                }}
              >
                <Folder className="h-4 w-4 text-neutral-400" />
                <span className="truncate font-medium">{folder.name}</span>
              </CommandItem>
            ))}
            {showRemote && search.folders.hasNextPage ? (
              <CommandItem
                value="load more folders"
                disabled={search.folders.isFetchingNextPage}
                onSelect={() => void search.folders.fetchNextPage()}
                className="text-xs font-medium text-[#7c3aed] dark:text-[#9f73f2]"
              >
                {search.folders.isFetchingNextPage ? 'Loading more...' : 'Load more folders'}
              </CommandItem>
            ) : null}
          </CommandGroup>
        ) : null}

        {visibleMeetings.length > 0 ? (
          <CommandGroup heading="Meetings">
            {visibleMeetings.map((note) => (
              <CommandItem
                key={note.id}
                value={`meeting ${note.title} ${note.id}`}
                onSelect={() => {
                  onSelectNote(note.id, note.folderId ?? null)
                  close()
                }}
              >
                <FileText className="h-4 w-4 text-neutral-400" />
                <span className="truncate font-medium">{note.title || 'Untitled meeting'}</span>
              </CommandItem>
            ))}
            {showRemote && search.notes.hasNextPage ? (
              <CommandItem
                value="load more meetings"
                disabled={search.notes.isFetchingNextPage}
                onSelect={() => void search.notes.fetchNextPage()}
                className="text-xs font-medium text-[#7c3aed] dark:text-[#9f73f2]"
              >
                {search.notes.isFetchingNextPage ? 'Loading more...' : 'Load more meetings'}
              </CommandItem>
            ) : null}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
