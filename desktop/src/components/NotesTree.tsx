import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, FilePlus, FileText, Folder, FolderOpen, FolderPlus, Loader2, MoreHorizontal } from 'lucide-react'

import { SidebarIconButton, SidebarMenuItemButton, SidebarRowButton } from '@/components/ui/sidebar-button'
import { cn } from '@/lib/utils'
import type { FolderRecord } from '@/types/folder'
import type { NoteRecord } from '@/types/note'

type TreeFolder = {
  id: string
  name: string
  noteIds: string[]
}

type OpenMenu =
  | { kind: 'folder'; id: string }
  | { kind: 'note'; id: string; showMove: boolean }
  | null

export function NotesTree({
  folders,
  notes,
  isLoading,
  error,
  folderPagination,
  onLoadMore,
  selectedFolderId,
  selectedNoteId,
  search,
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
  notes: NoteRecord[]
  isLoading: boolean
  error: string | null
  folderPagination: Record<string, { hasMore: boolean; isLoading: boolean }>
  onLoadMore: (folderId: string | null) => void
  selectedFolderId: string | null
  selectedNoteId: string | null
  search: string
  onSelectFolder: (id: string | null) => void
  onSelectNote: (noteId: string) => void
  onCreateFolder: () => void
  onCreateNote: () => void
  onRenameFolder: (folderId: string, name: string) => Promise<void>
  onDeleteFolder: (folderId: string) => Promise<void>
  onRenameNote: (noteId: string, title: string) => Promise<void>
  onDeleteNote: (noteId: string) => Promise<void>
  onMoveNote: (noteId: string, folderId: string | null) => Promise<void>
}) {
  const [treeExpanded, setTreeExpanded] = useState(true)
  const [folderExpansions, setFolderExpansions] = useState<Record<string, boolean>>({})
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // Close menu on outside click
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
    setRenamingId(null)
    setRenameValue('')
    if (!val) return
    if (type === 'folder') await onRenameFolder(id, val)
    else await onRenameNote(id, val)
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue('')
  }

  const notesById = useMemo(() => {
    const map = new Map<string, NoteRecord>()
    for (const n of notes) map.set(n.id, n)
    return map
  }, [notes])

  const treeFolders = useMemo<TreeFolder[]>(() => {
    const byFolder = new Map<string, TreeFolder>()
    for (const f of folders) byFolder.set(f.id, { id: f.id, name: f.name, noteIds: [] })
    for (const n of notes) {
      if (n.folderId) {
        const node = byFolder.get(n.folderId)
        if (node) node.noteIds.push(n.id)
      }
    }
    return [...byFolder.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [folders, notes])

  const unfiledNoteIds = useMemo(() => notes.filter((n) => !n.folderId).map((n) => n.id), [notes])

  const toggleFolder = (id: string) => {
    setFolderExpansions((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }))
  }

  const renderNoteRow = (noteId: string, indented: boolean) => {
    const n = notesById.get(noteId)
    if (!n) return null
    const active = n.id === selectedNoteId
    const isMenuOpen = openMenu?.kind === 'note' && openMenu.id === n.id
    const showMove = isMenuOpen && (openMenu as Extract<OpenMenu, { kind: 'note' }>).showMove

    return (
      <div key={n.id} className="relative group/row min-w-0" style={indented ? { paddingLeft: '8px' } : {}}>
        <div className={cn(
          'flex items-center rounded-full min-w-0',
          active ? 'border border-white/12 bg-white/10 text-white' : 'text-neutral-300 hover:bg-white/8 hover:text-white',
        )}>
          <SidebarRowButton
            className="min-w-0 flex-1 rounded-none text-inherit hover:bg-transparent hover:text-inherit"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => onSelectNote(n.id)}
            title={n.title || 'Untitled'}
          >
            <FileText size={14} className="flex-shrink-0 text-neutral-500 dark:text-neutral-400" />
            {renamingId === n.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitRename('note', n.id)
                  if (e.key === 'Escape') cancelRename()
                }}
                onBlur={() => void commitRename('note', n.id)}
                onClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 bg-transparent outline-none border-b border-violet-400 text-xs"
              />
            ) : (
              <span className="truncate">{n.title || 'Untitled'}</span>
            )}
          </SidebarRowButton>
          {renamingId !== n.id && (
            <SidebarIconButton
              revealOnRowHover
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                setOpenMenu(isMenuOpen ? null : { kind: 'note', id: n.id, showMove: false })
              }}
            >
              <MoreHorizontal size={14} />
            </SidebarIconButton>
          )}
        </div>

        {isMenuOpen && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute right-0 top-8 z-50 min-w-[160px] rounded-xl border border-white/10 bg-[#171417]/95 p-1 text-neutral-100 shadow-xl backdrop-blur-md"
          >
            {!showMove ? (
              <>
                <SidebarMenuItemButton
                  onClick={() => startRename(n.id, n.title || 'Untitled')}
                >
                  Rename
                </SidebarMenuItemButton>
                <SidebarMenuItemButton
                  className="justify-between"
                  onClick={() => setOpenMenu({ kind: 'note', id: n.id, showMove: true })}
                >
                  Move to folder
                  <ChevronRight size={14} />
                </SidebarMenuItemButton>
                <div className="my-1 border-t border-white/10" />
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
                  className="text-neutral-400 hover:text-white"
                  onClick={() => setOpenMenu({ kind: 'note', id: n.id, showMove: false })}
                >
                  <ChevronLeft size={14} />
                  Back
                </SidebarMenuItemButton>
                <div className="my-1 border-t border-white/10" />
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
    const hasChildren = f.noteIds.length > 0
    const isExpanded = folderExpansions[f.id] ?? false
    const isFolderActive = selectedFolderId === f.id
    const pagination = folderPagination[f.id]
    const showLoadMore = !search.trim() && pagination?.hasMore
    const canExpand = hasChildren || showLoadMore
    const isMenuOpen = openMenu?.kind === 'folder' && openMenu.id === f.id

    if (search.trim() && !hasChildren) return null

    return (
      <div key={f.id} className="relative group/row min-w-0">
        <div className={cn(
          'flex items-center rounded-full min-w-0',
          isExpanded || isFolderActive ? 'border border-white/12 bg-white/10 text-white' : 'text-neutral-300 hover:bg-white/8 hover:text-white',
        )}>
          <SidebarRowButton
            className="min-w-0 flex-1 rounded-none pr-2 pl-0 text-inherit hover:bg-transparent hover:text-inherit"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => {
              onSelectFolder(f.id)
              if (hasChildren) toggleFolder(f.id)
            }}
          >
            {canExpand ? (
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center">
                <span
                  onClick={(e) => { e.stopPropagation(); toggleFolder(f.id) }}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full hover:bg-white/8"
                >
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              </span>
            ) : (
              <span className="h-8 w-8 flex-shrink-0" />
            )}
            {isExpanded && hasChildren ? (
              <FolderOpen size={14} className="flex-shrink-0 text-violet-600 dark:text-violet-400" />
            ) : (
              <Folder size={14} className="flex-shrink-0 text-violet-600 dark:text-violet-400" />
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
              <span className="truncate text-neutral-700 dark:text-neutral-200">{f.name}</span>
            )}
          </SidebarRowButton>
          {renamingId !== f.id && (
            <SidebarIconButton
              revealOnRowHover
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
            className="absolute right-0 top-8 z-50 min-w-[140px] rounded-xl border border-white/10 bg-[#171417]/95 p-1 text-neutral-100 shadow-xl backdrop-blur-md"
          >
            <SidebarMenuItemButton
              onClick={() => startRename(f.id, f.name)}
            >
              Rename
            </SidebarMenuItemButton>
            <div className="my-1 border-t border-white/10" />
            <SidebarMenuItemButton
              destructive
              onClick={() => { void onDeleteFolder(f.id); setOpenMenu(null) }}
            >
              Delete
            </SidebarMenuItemButton>
          </div>
        )}

        {isExpanded && (hasChildren || showLoadMore) ? (
          <div className="mt-1 space-y-1">
            {f.noteIds.map((noteId) => renderNoteRow(noteId, true))}
            {showLoadMore ? (
              <div style={{ paddingLeft: '8px' }}>
                <SidebarRowButton
                  className="text-neutral-400 hover:bg-white/10"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  onClick={() => onLoadMore(f.id)}
                  disabled={pagination?.isLoading}
                >
                  {pagination?.isLoading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Loading...</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown size={14} />
                      <span>Load more</span>
                    </>
                  )}
                </SidebarRowButton>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="group flex h-8 items-center justify-between rounded-full hover:bg-white/8">
        <div className="flex items-center gap-2">
          <SidebarIconButton
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => setTreeExpanded(!treeExpanded)}
          >
            {treeExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </SidebarIconButton>
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
            ) : error ? (
              <div className="px-2 py-1 text-xs text-red-500">{error}</div>
            ) : (
              <div className="space-y-1 min-w-0">
                {treeFolders.map(renderFolderRow)}

                {unfiledNoteIds.map((noteId) => renderNoteRow(noteId, false))}

                {!search.trim() && folderPagination['__unfiled__']?.hasMore ? (
                  <div>
                    <SidebarRowButton
                      className="text-neutral-400 hover:bg-white/10"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      onClick={() => onLoadMore(null)}
                      disabled={folderPagination['__unfiled__']?.isLoading}
                    >
                      {folderPagination['__unfiled__']?.isLoading ? (
                        <>
                          <Loader2 size={14} className="animate-spin" />
                          <span>Loading...</span>
                        </>
                      ) : (
                        <>
                          <ChevronDown size={14} />
                          <span>Load more</span>
                        </>
                      )}
                    </SidebarRowButton>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
