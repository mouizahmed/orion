import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, FilePlus, Folder, FolderOpen, FolderPlus, MoreHorizontal } from 'lucide-react'

import { SidebarIconButton, SidebarMenuItemButton, SidebarRowButton } from '@/components/ui/sidebar-button'
import { LoadMoreButton } from '@/components/ui/load-more-button'
import { NoteRow } from '@/components/NoteRow'
import { cn } from '@/lib/utils'
import type { FolderRecord } from '@/types/folder'
import type { NoteDetail, NoteSummary } from '@/types/note'
import { UNFILED_ID } from '@/contexts/DashboardNotesContext'

type FolderPage = {
  noteIds: string[]
  hasMore: boolean
  isLoading: boolean
  loaded: boolean
}

type TreeFolder = {
  id: string
  name: string
  noteCount: number
  noteIds: string[]
}

type OpenMenu =
  | { kind: 'folder'; id: string }
  | { kind: 'note'; id: string; showMove: boolean }
  | null

export function NotesTree({
  folders,
  noteSummariesById,
  folderPages,
  selectedNoteDetail,
  isLoading,
  onLoadMore,
  selectedFolderId,
  selectedNoteId,
  onSelectFolder,
  onSelectNote,
  onCreateFolder,
  onCreateNote,
  onRenameFolder,
  onDeleteFolder,
  onRenameNote,
  onDeleteNote,
  onMoveNote,
}: {
  folders: FolderRecord[]
  noteSummariesById: Record<string, NoteSummary>
  folderPages: Record<string, FolderPage>
  selectedNoteDetail: NoteDetail | null
  isLoading: boolean
  onLoadMore: (folderId: string | null) => void
  selectedFolderId: string | null
  selectedNoteId: string | null
  onSelectFolder: (id: string | null) => void
  onSelectNote: (noteId: string) => void
  onCreateFolder: () => void
  onCreateNote: () => void
  onRenameFolder: (folderId: string, name: string) => Promise<boolean>
  onDeleteFolder: (folderId: string) => Promise<boolean>
  onRenameNote: (noteId: string, title: string) => Promise<boolean>
  onDeleteNote: (noteId: string) => Promise<boolean>
  onMoveNote: (noteId: string, folderId: string | null) => Promise<boolean>
}) {
  const [treeExpanded, setTreeExpanded] = useState(true)
  const [folderExpansions, setFolderExpansions] = useState<Record<string, boolean>>({})
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    if (!openMenu) return
    const handler = () => setOpenMenu(null)
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openMenu])

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id)
    setRenameValue(currentName)
    setOpenMenu(null)
  }

  const commitRename = async (type: 'note' | 'folder', id: string) => {
    const val = renameValue.trim()
    if (!val) { setRenamingId(null); setRenameValue(''); return }
    setRenamingId(null)
    setRenameValue('')
    const ok = type === 'folder' ? await onRenameFolder(id, val) : await onRenameNote(id, val)
    if (!ok) { setRenamingId(id); setRenameValue(val) }
  }

  const cancelRename = () => { setRenamingId(null); setRenameValue('') }

  const sortByUpdatedAt = (ids: string[]) =>
    [...ids].sort((a, b) => (noteSummariesById[b]?.updatedAt ?? 0) - (noteSummariesById[a]?.updatedAt ?? 0))

  const treeFolders = useMemo<TreeFolder[]>(() => {
    return folders
      .map((f) => {
        const page = folderPages[f.id]
        let noteIds = page?.noteIds ?? []
        if (
          selectedNoteDetail &&
          selectedNoteDetail.folderId === f.id &&
          !noteIds.includes(selectedNoteDetail.id)
        ) {
          noteIds = [selectedNoteDetail.id, ...noteIds]
        }
        return { id: f.id, name: f.name, noteCount: f.noteCount, noteIds: sortByUpdatedAt(noteIds) }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [folders, folderPages, selectedNoteDetail, noteSummariesById])

  const unfiledNoteIds = useMemo(() => {
    const ids = folderPages[UNFILED_ID]?.noteIds ?? []
    const withSelected =
      selectedNoteDetail && !selectedNoteDetail.folderId && !ids.includes(selectedNoteDetail.id)
        ? [selectedNoteDetail.id, ...ids]
        : ids
    return sortByUpdatedAt(withSelected)
  }, [folderPages, selectedNoteDetail, noteSummariesById])

  const handleExpandFolder = (id: string) => {
    const nowExpanded = !(folderExpansions[id] ?? false)
    setFolderExpansions((prev) => ({ ...prev, [id]: nowExpanded }))
    if (nowExpanded && !folderPages[id]?.loaded) {
      onLoadMore(id)
    }
  }

  const renderNoteRow = (noteId: string, indented: boolean) => {
    const n = noteSummariesById[noteId]
    if (!n) return null
    const active = n.id === selectedNoteId
    const isMenuOpen = openMenu?.kind === 'note' && openMenu.id === n.id
    const showMove = isMenuOpen && (openMenu as Extract<OpenMenu, { kind: 'note' }>).showMove

    return (
      <div key={n.id} className="relative">
        <NoteRow
          variant="sidebar"
          title={n.title || 'Untitled'}
          selected={active}
          indented={indented}
          onClick={() => onSelectNote(n.id)}
          isRenaming={renamingId === n.id}
          renameValue={renameValue}
          onRenameChange={setRenameValue}
          onRenameCommit={() => void commitRename('note', n.id)}
          onRenameCancel={cancelRename}
          actions={
            <SidebarIconButton
              revealOnRowHover
              suppressHoverBackground={active}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                setOpenMenu(isMenuOpen ? null : { kind: 'note', id: n.id, showMove: false })
              }}
            >
              <MoreHorizontal size={14} />
            </SidebarIconButton>
          }
        />
        {isMenuOpen && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute right-0 top-8 z-50 min-w-[160px] rounded-xl border border-neutral-200 bg-white/95 p-1 text-neutral-900 shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/95 dark:text-neutral-100"
          >
            {!showMove ? (
              <>
                <SidebarMenuItemButton onClick={() => startRename(n.id, n.title || 'Untitled')}>
                  Rename
                </SidebarMenuItemButton>
                <SidebarMenuItemButton
                  className="justify-between"
                  onClick={() => setOpenMenu({ kind: 'note', id: n.id, showMove: true })}
                >
                  Move to folder
                  <ChevronRight size={14} />
                </SidebarMenuItemButton>
                <div className="my-1 border-t border-neutral-200 dark:border-white/10" />
                <SidebarMenuItemButton
                  destructive
                  onClick={() => { void onDeleteNote(n.id); setOpenMenu(null) }}
                >
                  Delete
                </SidebarMenuItemButton>
              </>
            ) : (
              <>
                <SidebarMenuItemButton
                  className="text-neutral-500 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
                  onClick={() => setOpenMenu({ kind: 'note', id: n.id, showMove: false })}
                >
                  <ChevronLeft size={14} />
                  Back
                </SidebarMenuItemButton>
                <div className="my-1 border-t border-neutral-200 dark:border-white/10" />
                <SidebarMenuItemButton
                  active={!n.folderId}
                  onClick={() => { void onMoveNote(n.id, null); setOpenMenu(null) }}
                >
                  No folder
                </SidebarMenuItemButton>
                {folders.map((f) => (
                  <SidebarMenuItemButton
                    key={f.id}
                    active={n.folderId === f.id}
                    onClick={() => { void onMoveNote(n.id, f.id); setOpenMenu(null) }}
                  >
                    {f.name}
                  </SidebarMenuItemButton>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  const renderFolderRow = (f: TreeFolder) => {
    const page = folderPages[f.id]
    const hasLoadedChildren = f.noteIds.length > 0
    const isExpanded = folderExpansions[f.id] ?? false
    const isFolderActive = selectedFolderId === f.id
    const isLoadingNotes = page?.isLoading ?? false
    const showLoadMore = page?.loaded && page?.hasMore
    const canExpand = f.noteCount > 0 || hasLoadedChildren
    const isMenuOpen = openMenu?.kind === 'folder' && openMenu.id === f.id

    return (
      <div key={f.id} className="relative min-w-0">
        <div className={cn(
          'group/row flex items-center rounded-full min-w-0',
          'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/8 dark:hover:text-white',
        )}>
          <SidebarRowButton
            embedded
            className="min-w-0 flex-1 rounded-none pr-2 pl-0 text-inherit hover:bg-transparent hover:text-inherit"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => handleExpandFolder(f.id)}
          >
            {canExpand ? (
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center">
                <span
                  onClick={(e) => { e.stopPropagation(); handleExpandFolder(f.id) }}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-white/8"
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              </span>
            ) : (
              <span className="h-8 w-8 flex-shrink-0" />
            )}
            {isExpanded && hasLoadedChildren ? (
              <FolderOpen size={14} className="flex-shrink-0 text-violet-600 transition-colors group-hover/row:text-violet-700 dark:text-violet-400 dark:group-hover/row:text-violet-300" />
            ) : (
              <Folder size={14} className="flex-shrink-0 text-violet-600 transition-colors group-hover/row:text-violet-700 dark:text-violet-400 dark:group-hover/row:text-violet-300" />
            )}
            {renamingId === f.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename('folder', f.id)
                  if (e.key === 'Escape') cancelRename()
                }}
                onBlur={() => void commitRename('folder', f.id)}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 bg-transparent outline-none border-b border-violet-400 text-xs"
              />
            ) : (
              <span className="truncate">{f.name}</span>
            )}
          </SidebarRowButton>
          {renamingId !== f.id && (
            <SidebarIconButton
              revealOnRowHover
              suppressHoverBackground={isExpanded || isFolderActive}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                setOpenMenu(isMenuOpen ? null : { kind: 'folder', id: f.id })
              }}
            >
              <MoreHorizontal size={14} />
            </SidebarIconButton>
          )}
        </div>

        {isMenuOpen && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute right-0 top-8 z-50 min-w-[140px] rounded-xl border border-neutral-200 bg-white/95 p-1 text-neutral-900 shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/95 dark:text-neutral-100"
          >
            <SidebarMenuItemButton onClick={() => startRename(f.id, f.name)}>
              Rename
            </SidebarMenuItemButton>
            <div className="my-1 border-t border-neutral-200 dark:border-white/10" />
            <SidebarMenuItemButton
              destructive
              onClick={() => { void onDeleteFolder(f.id); setOpenMenu(null) }}
            >
              Delete
            </SidebarMenuItemButton>
          </div>
        )}

        {isExpanded ? (
          <div className="mt-1 space-y-1">
            {isLoadingNotes && !hasLoadedChildren ? (
              <>
                {[70, 55, 80].map((w, i) => (
                  <div key={i} className="flex h-8 items-center gap-2 pl-8 pr-2">
                    <div className="h-3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" style={{ width: `${w}%` }} />
                  </div>
                ))}
              </>
            ) : (
              <>
                {f.noteIds.map((noteId) => renderNoteRow(noteId, true))}
                {showLoadMore ? (
                  <LoadMoreButton
                    indented
                    isLoading={isLoadingNotes}
                    onClick={() => onLoadMore(f.id)}
                  />
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="group flex h-8 items-center justify-between rounded-full hover:bg-neutral-100 dark:hover:bg-white/8">
        <div
          className="flex flex-1 cursor-pointer items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={() => setTreeExpanded(!treeExpanded)}
        >
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center">
            {treeExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
            Notes
          </div>
        </div>
        <div className="flex items-center">
          <SidebarIconButton
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={onCreateFolder}
            title="New folder"
          >
            <FolderPlus size={14} />
          </SidebarIconButton>
          <SidebarIconButton
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={onCreateNote}
            title="New note"
          >
            <FilePlus size={14} />
          </SidebarIconButton>
        </div>
      </div>

      {treeExpanded ? (
        <div className="mt-1 min-h-0 flex-1 overflow-y-auto overflow-x-hidden sidebar-scrollbar">
          <div className="min-w-0">
            {isLoading ? (
              <div className="space-y-1 px-1 py-1">
                {[60, 80, 45, 70, 55].map((w, i) => (
                  <div key={i} className="flex h-8 items-center gap-2 px-2">
                    <div className="h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                    <div className="h-3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-1 min-w-0">
                {treeFolders.map(renderFolderRow)}
                {unfiledNoteIds.map((noteId) => renderNoteRow(noteId, false))}
                {folderPages[UNFILED_ID]?.hasMore ? (
                  <LoadMoreButton
                    isLoading={folderPages[UNFILED_ID]?.isLoading}
                    onClick={() => onLoadMore(null)}
                  />
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
