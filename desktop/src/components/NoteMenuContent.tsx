import { ChevronLeft, ChevronRight } from 'lucide-react'
import { SidebarMenuItemButton } from '@/components/ui/sidebar-button'
import type { FolderRecord } from '@/types/folder'

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
  onDelete: (noteId: string) => void
  onMove: (noteId: string, folderId: string | null) => void
  close: () => void
}) {
  if (!showMove) {
    return (
      <>
        <SidebarMenuItemButton onClick={() => { onRename(noteId, noteTitle); close() }}>
          Rename
        </SidebarMenuItemButton>
        <SidebarMenuItemButton className="justify-between" onClick={() => onShowMoveChange(true)}>
          Move to folder
          <ChevronRight size={14} />
        </SidebarMenuItemButton>
        <div className="my-1 border-t border-neutral-200 dark:border-white/10" />
        <SidebarMenuItemButton destructive onClick={() => { onDelete(noteId); close() }}>
          Delete
        </SidebarMenuItemButton>
      </>
    )
  }

  return (
    <>
      <SidebarMenuItemButton
        className="text-neutral-500 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white"
        onClick={() => onShowMoveChange(false)}
      >
        <ChevronLeft size={14} />
        Back
      </SidebarMenuItemButton>
      <div className="my-1 border-t border-neutral-200 dark:border-white/10" />
      <SidebarMenuItemButton active={!noteFolderId} onClick={() => { onMove(noteId, null); close() }}>
        No folder
      </SidebarMenuItemButton>
      {folders.map((f) => (
        <SidebarMenuItemButton
          key={f.id}
          active={noteFolderId === f.id}
          onClick={() => { onMove(noteId, f.id); close() }}
        >
          {f.name}
        </SidebarMenuItemButton>
      ))}
    </>
  )
}
