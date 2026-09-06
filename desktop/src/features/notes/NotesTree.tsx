import { useState } from 'react'
import { ChevronDown, ChevronRight, FilePlus, Folder, FolderOpen, FolderPlus } from 'lucide-react'

import { LoadMoreButton } from '@/components/ui/load-more-button'
import { RowActionMenu, RowActionMenuTrigger } from '@/components/ui/row-action-menu'
import { SidebarIconButton, SidebarRowButton } from '@/components/ui/sidebar-button'
import { FolderMenuContent } from '@/features/notes/FolderMenuContent'
import { NoteMenuContent } from '@/features/notes/NoteMenuContent'
import { NoteRow } from '@/features/notes/NoteRow'
import type { FolderRecord } from '@/features/notes/folder-types'
import { useNotesByFolderQuery } from '@/features/notes/queries/useNotesQueries'
import type { NoteSummary } from '@/features/notes/types'
import { cn } from '@/lib/utils'

type RenameState = { id: string; value: string } | null

function QueryNoteRows({
  accountID,
  folderID,
  enabled,
  folders,
  selectedNoteID,
  rename,
  showMove,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onShowMoveChange,
  onSelectNote,
  onRenameNote,
  onDeleteNote,
  onMoveNote,
}: {
  accountID: string
  folderID: string | null
  enabled: boolean
  folders: FolderRecord[]
  selectedNoteID: string | null
  rename: RenameState
  showMove: boolean
  onRenameChange: (value: string) => void
  onRenameCommit: (note: NoteSummary) => void
  onRenameCancel: () => void
  onShowMoveChange: (open: boolean) => void
  onSelectNote: (note: NoteSummary) => void
  onRenameNote: (id: string, title: string) => void
  onDeleteNote: (id: string, title: string) => void
  onMoveNote: (id: string, folderID: string | null) => void
}) {
  const query = useNotesByFolderQuery(accountID, folderID, enabled)
  const notes = query.data?.pages.flatMap((page) => page.notes) ?? []
  if (query.isLoading)
    return (
      <div className={folderID ? 'space-y-1 pl-8' : 'space-y-1'}>
        {[70, 55, 80].map((width) => (
          <div key={width} className="h-8 px-2 py-2">
            <div
              className="h-3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700"
              style={{ width: `${width}%` }}
            />
          </div>
        ))}
      </div>
    )
  return (
    <div className="space-y-1">
      {notes.map((note) => (
        <NoteRow
          key={note.id}
          variant="sidebar"
          title={note.title || 'Untitled'}
          selected={selectedNoteID === note.id}
          indented={Boolean(folderID)}
          onClick={() => onSelectNote(note)}
          isRenaming={rename?.id === note.id}
          renameValue={rename?.id === note.id ? rename.value : ''}
          onRenameChange={onRenameChange}
          onRenameCommit={() => onRenameCommit(note)}
          onRenameCancel={onRenameCancel}
          onMenuClose={() => onShowMoveChange(false)}
          menuContent={(close) => (
            <NoteMenuContent
              noteId={note.id}
              noteTitle={note.title || 'Untitled'}
              noteFolderId={note.folderId}
              folders={folders}
              showMove={showMove}
              onShowMoveChange={onShowMoveChange}
              onRename={onRenameNote}
              onDelete={onDeleteNote}
              onMove={onMoveNote}
              close={close}
            />
          )}
        />
      ))}
      {query.hasNextPage ? (
        <LoadMoreButton
          indented={Boolean(folderID)}
          isLoading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        />
      ) : null}
    </div>
  )
}

export function NotesTree({
  accountID,
  folders,
  selectedNoteID,
  isLoading,
  onSelectNote,
  onCreateFolder,
  onCreateNote,
  onRenameFolder,
  onDeleteFolder,
  onRenameNote,
  onDeleteNote,
  onMoveNote,
}: {
  accountID: string
  folders: FolderRecord[]
  selectedNoteID: string | null
  isLoading: boolean
  onSelectNote: (note: NoteSummary) => void
  onCreateFolder: () => void
  onCreateNote: () => void
  onRenameFolder: (folderID: string, name: string) => Promise<boolean>
  onDeleteFolder: (folderID: string, name: string) => void
  onRenameNote: (noteID: string, title: string) => Promise<boolean>
  onDeleteNote: (noteID: string, title: string) => void
  onMoveNote: (noteID: string, folderID: string | null) => Promise<boolean>
}) {
  const [treeExpanded, setTreeExpanded] = useState(true)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  const [rename, setRename] = useState<RenameState>(null)
  const [showMove, setShowMove] = useState(false)

  const commitRename = async (kind: 'folder' | 'note', id: string) => {
    const value = rename?.id === id ? rename.value.trim() : ''
    setRename(null)
    if (!value) return
    const ok = kind === 'folder' ? await onRenameFolder(id, value) : await onRenameNote(id, value)
    if (!ok) setRename({ id, value })
  }
  const noteRows = (folderID: string | null, enabled: boolean) => (
    <QueryNoteRows
      accountID={accountID}
      folderID={folderID}
      enabled={enabled}
      folders={folders}
      selectedNoteID={selectedNoteID}
      rename={rename}
      showMove={showMove}
      onRenameChange={(value) => setRename((current) => (current ? { ...current, value } : null))}
      onRenameCommit={(note) => void commitRename('note', note.id)}
      onRenameCancel={() => setRename(null)}
      onShowMoveChange={setShowMove}
      onSelectNote={onSelectNote}
      onRenameNote={(id, title) => {
        setRename({ id, value: title })
        setShowMove(false)
      }}
      onDeleteNote={onDeleteNote}
      onMoveNote={(id, nextFolderID) => void onMoveNote(id, nextFolderID)}
    />
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="group flex h-8 items-center justify-between rounded-md hover:bg-neutral-100 dark:hover:bg-white/8">
        <button
          type="button"
          className="flex flex-1 items-center gap-2"
          onClick={() => setTreeExpanded((value) => !value)}
        >
          <span className="flex h-8 w-8 items-center justify-center">
            {treeExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
            Notes
          </span>
        </button>
        <div className="flex items-center">
          <SidebarIconButton onClick={onCreateFolder} title="New folder">
            <FolderPlus size={14} />
          </SidebarIconButton>
          <SidebarIconButton onClick={onCreateNote} title="New note">
            <FilePlus size={14} />
          </SidebarIconButton>
        </div>
      </div>
      {treeExpanded ? (
        <div className="sidebar-scrollbar mt-1 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          {isLoading ? (
            <div className="px-2 py-2 text-xs text-neutral-500">Loading notes…</div>
          ) : (
            <div className="space-y-1">
              {[...folders]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((folder) => {
                  const expanded = Boolean(expandedFolders[folder.id])
                  return (
                    <div key={folder.id}>
                      <RowActionMenu
                        className="group/row"
                        placement="row-end"
                        menuContent={(close) => (
                          <FolderMenuContent
                            folderId={folder.id}
                            folderName={folder.name}
                            onRename={(id, name) => setRename({ id, value: name })}
                            onDelete={onDeleteFolder}
                            close={close}
                          />
                        )}
                      >
                        <div
                          className={cn(
                            'flex items-center rounded-md',
                            'hover:bg-neutral-100 dark:hover:bg-white/8',
                            'group-data-[state=open]/row-action-menu:bg-neutral-100 dark:group-data-[state=open]/row-action-menu:bg-white/8',
                          )}
                        >
                          <SidebarRowButton
                            embedded
                            className="min-w-0 flex-1 rounded-none pl-0 pr-2"
                            onClick={() => setExpandedFolders((current) => ({ ...current, [folder.id]: !expanded }))}
                          >
                            <span className="flex h-8 w-8 items-center justify-center">
                              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </span>
                            {expanded ? (
                              <FolderOpen size={14} className="text-violet-500" />
                            ) : (
                              <Folder size={14} className="text-violet-500" />
                            )}
                            {rename?.id === folder.id ? (
                              <input
                                autoFocus
                                value={rename.value}
                                onChange={(event) => setRename({ id: folder.id, value: event.target.value })}
                                onClick={(event) => event.stopPropagation()}
                                onBlur={() => void commitRename('folder', folder.id)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') void commitRename('folder', folder.id)
                                  if (event.key === 'Escape') setRename(null)
                                }}
                                className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                              />
                            ) : (
                              <span className="truncate">{folder.name}</span>
                            )}
                          </SidebarRowButton>
                          {rename?.id === folder.id ? null : (
                            <RowActionMenuTrigger
                              variant="sidebar"
                              aria-label={`More actions for ${folder.name}`}
                            />
                          )}
                        </div>
                      </RowActionMenu>
                      {expanded ? <div className="mt-1">{noteRows(folder.id, true)}</div> : null}
                    </div>
                  )
                })}
              {noteRows(null, true)}
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
