import { type CSSProperties, useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, ArrowUpDown, ChevronRight, FileText, Folder, FolderPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DashboardPanel,
  DashboardPanelBody,
  DashboardPanelHeader,
  DashboardPanelTitle,
} from '@/components/ui/dashboard-panel'
import { DashboardIconTile, DashboardRow } from '@/components/ui/dashboard-row'
import { LoadMoreButton } from '@/components/ui/load-more-button'
import { RowActionMenu, RowActionMenuTrigger } from '@/components/ui/row-action-menu'
import { CreateFolderDialog } from '@/features/notes/dialogs/CreateFolderDialog'
import { FolderMenuContent } from '@/features/notes/FolderMenuContent'
import { useAuth } from '@/features/auth/AuthContext'
import { NoteMenuContent } from '@/features/notes/NoteMenuContent'
import { NoteRow } from '@/features/notes/NoteRow'
import { useDashboardNotes } from '@/features/notes/DashboardNotesContext'
import { useSortedNotesByFolderQuery } from '@/features/notes/queries/useNotesQueries'
import type { NoteSort, NoteSortDirection, NoteSummary } from '@/features/notes/types'

function EmptyNotes({ folderName }: { folderName?: string }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-4 py-8 text-center">
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100 text-neutral-500 dark:border-white/10 dark:bg-white/5 dark:text-neutral-400">
        <FileText className="h-4 w-4" />
      </div>
      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">No notes here yet</p>
      <p className="mt-1 text-xs text-neutral-500">
        {folderName ? `Create or move a note into ${folderName}.` : 'Notes without a folder will appear here.'}
      </p>
    </div>
  )
}

export default function NotesLibraryView() {
  const { user } = useAuth()
  const {
    folders,
    selectedFolderId,
    selectFolder,
    selectNote,
    createFolder,
    renameFolder,
    requestDeleteFolder,
    requestDeleteNote,
    renameNote,
    moveNote,
  } = useDashboardNotes()
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [folderRenameValue, setFolderRenameValue] = useState('')
  const [showMove, setShowMove] = useState(false)
  const [noteSort, setNoteSort] = useState<NoteSort>('updated')
  const [noteSortDirection, setNoteSortDirection] = useState<NoteSortDirection>('desc')
  const notesQuery = useSortedNotesByFolderQuery(user?.id, selectedFolderId, {
    sort: noteSort,
    direction: noteSortDirection,
  })

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [folders, selectedFolderId],
  )
  const notes = useMemo(
    () => notesQuery.data?.pages.flatMap((page) => page.notes) ?? [],
    [notesQuery.data],
  )

  useEffect(() => {
    if (selectedFolderId && !selectedFolder) {
      selectFolder(null)
    }
  }, [selectFolder, selectedFolder, selectedFolderId])

  const startRename = (noteId: string, currentTitle: string) => {
    setRenamingId(noteId)
    setRenameValue(currentTitle)
  }

  const commitRename = async (noteId: string) => {
    const title = renameValue.trim()
    setRenamingId(null)
    setRenameValue('')
    if (title) await renameNote(noteId, title)
  }

  const startFolderRename = (folderId: string, currentName: string) => {
    setRenamingFolderId(folderId)
    setFolderRenameValue(currentName)
  }

  const commitFolderRename = async (folderId: string) => {
    const name = folderRenameValue.trim()
    setRenamingFolderId(null)
    setFolderRenameValue('')
    if (!name) return
    const renamed = await renameFolder(folderId, name)
    if (!renamed) {
      setRenamingFolderId(folderId)
      setFolderRenameValue(name)
    }
  }

  const renderNote = (note: NoteSummary) => {
    return (
      <NoteRow
        key={note.id}
        variant="card"
        title={note.title || 'Untitled'}
        onClick={() => selectNote(note.id)}
        isRenaming={renamingId === note.id}
        renameValue={renameValue}
        onRenameChange={setRenameValue}
        onRenameCommit={() => void commitRename(note.id)}
        onRenameCancel={() => { setRenamingId(null); setRenameValue('') }}
        onMenuClose={() => setShowMove(false)}
        menuContent={(close) => (
          <NoteMenuContent
            noteId={note.id}
            noteTitle={note.title || 'Untitled'}
            noteFolderId={note.folderId}
            folders={folders}
            showMove={showMove}
            onShowMoveChange={setShowMove}
            onRename={startRename}
            onDelete={(id, title) => requestDeleteNote(id, title)}
            onMove={(id, folderId) => void moveNote(id, folderId)}
            close={close}
          />
        )}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <DashboardPanel className="flex min-h-0 flex-1 flex-col">
        <DashboardPanelHeader>
          <div className="min-w-0">
            {selectedFolder ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  className="text-base font-medium leading-none text-neutral-500 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
                  onClick={() => selectFolder(null)}
                  style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
                >
                  My Notes
                </button>
                <ChevronRight className="h-4 w-4 shrink-0 text-neutral-400" />
                <DashboardPanelTitle className="truncate">{selectedFolder.name}</DashboardPanelTitle>
              </div>
            ) : (
              <DashboardPanelTitle>My Notes</DashboardPanelTitle>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={noteSortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
              title={noteSortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
              onClick={() => setNoteSortDirection((direction) => direction === 'asc' ? 'desc' : 'asc')}
              style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
            >
              {noteSortDirection === 'asc' ? (
                <ArrowUpDown className="h-3.5 w-3.5" />
              ) : (
                <ArrowDownUp className="h-3.5 w-3.5" />
              )}
            </Button>
            <Select value={noteSort} onValueChange={(value) => setNoteSort(value as NoteSort)}>
              <SelectTrigger
                size="sm"
                aria-label="Sort notes"
                style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="updated">Last updated</SelectItem>
                <SelectItem value="created">Created</SelectItem>
                <SelectItem value="title">Title</SelectItem>
              </SelectContent>
            </Select>
            {!selectedFolder ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowCreateFolderDialog(true)}
                style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              >
                <FolderPlus />
                New folder
              </Button>
            ) : null}
          </div>
        </DashboardPanelHeader>

        <DashboardPanelBody className="min-h-0 flex-1 p-2">
          {selectedFolder ? (
            notesQuery.isLoading ? (
              <div className="space-y-1">
                {[70, 55, 80, 65].map((width) => (
                  <div key={width} className="h-12 animate-pulse rounded-lg bg-neutral-100 dark:bg-white/5" style={{ width: `${width}%` }} />
                ))}
              </div>
            ) : notes.length > 0 ? (
              <div className="space-y-0.5">
                {notes.map(renderNote)}
                {notesQuery.hasNextPage ? (
                  <LoadMoreButton
                    isLoading={notesQuery.isFetchingNextPage}
                    onClick={() => void notesQuery.fetchNextPage()}
                  />
                ) : null}
              </div>
            ) : (
              <EmptyNotes folderName={selectedFolder.name} />
            )
          ) : (
            <div className="space-y-5">
              <section>
                <h3 className="px-2.5 pb-1.5 text-xs font-semibold text-neutral-400">Folders</h3>
                {folders.length > 0 ? (
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3">
                    {folders.map((folder) => {
                      const isRenaming = renamingFolderId === folder.id
                      return (
                        <RowActionMenu
                          key={folder.id}
                          menuContent={(close) => (
                            <FolderMenuContent
                              folderId={folder.id}
                              folderName={folder.name}
                              onRename={startFolderRename}
                              onDelete={requestDeleteFolder}
                              close={close}
                            />
                          )}
                        >
                          <DashboardRow
                            interactive={!isRenaming}
                            className="items-center"
                            onClick={() => { if (!isRenaming) selectFolder(folder.id) }}
                            onKeyDown={(event) => {
                              if (!isRenaming && (event.key === 'Enter' || event.key === ' ')) {
                                event.preventDefault()
                                selectFolder(folder.id)
                              }
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <DashboardIconTile className="h-9 w-9 text-violet-600 dark:text-violet-400">
                              <Folder className="h-4 w-4" />
                            </DashboardIconTile>
                            <div className="min-w-0 flex-1">
                              {isRenaming ? (
                                <input
                                  autoFocus
                                  value={folderRenameValue}
                                  onChange={(event) => setFolderRenameValue(event.target.value)}
                                  onClick={(event) => event.stopPropagation()}
                                  onBlur={() => void commitFolderRename(folder.id)}
                                  onKeyDown={(event) => {
                                    event.stopPropagation()
                                    if (event.key === 'Enter') void commitFolderRename(folder.id)
                                    if (event.key === 'Escape') {
                                      setRenamingFolderId(null)
                                      setFolderRenameValue('')
                                    }
                                  }}
                                  className="block w-full border-b border-violet-400 bg-transparent text-xs font-medium leading-4 text-neutral-800 outline-none dark:text-neutral-200"
                                />
                              ) : (
                                <div className="truncate text-xs font-medium text-neutral-800 dark:text-neutral-200">{folder.name}</div>
                              )}
                            </div>
                            {!isRenaming ? (
                              <RowActionMenuTrigger
                                aria-label={`More actions for ${folder.name}`}
                              />
                            ) : null}
                          </DashboardRow>
                        </RowActionMenu>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-neutral-200 px-4 py-6 text-center text-xs text-neutral-500 dark:border-white/10">
                    No folders yet
                  </div>
                )}
              </section>

              <section>
                <h3 className="px-2.5 pb-1.5 text-xs font-semibold text-neutral-400">Notes</h3>
                {notes.length > 0 ? (
                  <div className="space-y-0.5">
                    {notes.map(renderNote)}
                    {notesQuery.hasNextPage ? (
                      <LoadMoreButton
                        isLoading={notesQuery.isFetchingNextPage}
                        onClick={() => void notesQuery.fetchNextPage()}
                      />
                    ) : null}
                  </div>
                ) : (
                  <EmptyNotes />
                )}
              </section>
            </div>
          )}
        </DashboardPanelBody>
      </DashboardPanel>

      <CreateFolderDialog
        isOpen={showCreateFolderDialog}
        onClose={() => setShowCreateFolderDialog(false)}
        onCreate={async (name) => Boolean(await createFolder(name))}
      />
    </div>
  )
}
