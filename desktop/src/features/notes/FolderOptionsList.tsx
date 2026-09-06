import { Check, Folder } from 'lucide-react'

import {
  DropdownIconSlot,
  DropdownItem,
  DropdownSeparator,
} from '@/components/ui/dropdown-list'
import type { FolderRecord } from '@/features/notes/folder-types'

export function FolderOptionsList({
  folders,
  selectedFolderId,
  onSelect,
}: {
  folders: FolderRecord[]
  selectedFolderId?: string | null
  onSelect: (folderId: string | null) => void
}) {
  return (
    <div className="sidebar-scrollbar max-h-60 overflow-y-auto">
      <DropdownItem radius="md" onClick={() => onSelect(null)}>
        <DropdownIconSlot>{!selectedFolderId ? <Check className="h-3.5 w-3.5" /> : null}</DropdownIconSlot>
        <Folder className="h-3.5 w-3.5 text-neutral-400 dark:text-neutral-500" />
        <span className="truncate">No folder</span>
      </DropdownItem>
      {folders.length > 0 ? <DropdownSeparator /> : null}
      {folders.map((folder) => (
        <DropdownItem key={folder.id} radius="md" onClick={() => onSelect(folder.id)}>
          <DropdownIconSlot>
            {selectedFolderId === folder.id ? <Check className="h-3.5 w-3.5" /> : null}
          </DropdownIconSlot>
          <Folder className="h-3.5 w-3.5 text-neutral-400 dark:text-neutral-500" />
          <span className="truncate">{folder.name}</span>
        </DropdownItem>
      ))}
    </div>
  )
}
