import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DropdownItem, DropdownSeparator } from '@/components/ui/dropdown-list'
import { FolderOptionsList } from '@/features/notes/FolderOptionsList'
import type { FolderRecord } from '@/features/notes/folder-types'

export function NoteMenuContent({
  noteId,
  noteTitle,
  noteFolderId,
  folders,
  showMove,
  onShowMoveChange,
  onRename,
  onDelete,
  onMove,
  close,
}: {
  noteId: string
  noteTitle: string
  noteFolderId?: string | null
  folders: FolderRecord[]
  showMove: boolean
  onShowMoveChange: (show: boolean) => void
  onRename: (noteId: string, currentTitle: string) => void
  onDelete: (noteId: string, noteTitle: string) => void
  onMove: (noteId: string, folderId: string | null) => void
  close: () => void
}) {
  if (!showMove) {
    return (
      <>
        <DropdownItem onClick={() => { onRename(noteId, noteTitle); close() }}>
          Rename
        </DropdownItem>
        <DropdownItem className="justify-between" onClick={() => onShowMoveChange(true)}>
          Move to folder
          <ChevronRight size={14} />
        </DropdownItem>
        <DropdownSeparator />
        <DropdownItem destructive onClick={() => { onDelete(noteId, noteTitle); close() }}>
          Delete
        </DropdownItem>
      </>
    )
  }

  return (
    <>
      <DropdownItem
        className="text-neutral-500 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
        onClick={() => onShowMoveChange(false)}
      >
        <ChevronLeft size={14} />
        Back
      </DropdownItem>
      <DropdownSeparator />
      <FolderOptionsList
        folders={folders}
        selectedFolderId={noteFolderId}
        onSelect={(folderId) => { onMove(noteId, folderId); close() }}
      />
    </>
  )
}
