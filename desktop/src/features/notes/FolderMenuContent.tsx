import { DropdownItem } from '@/components/ui/dropdown-list'

export function FolderMenuContent({
  folderId,
  folderName,
  onRename,
  onDelete,
  close,
}: {
  folderId: string
  folderName: string
  onRename: (folderId: string, folderName: string) => void
  onDelete: (folderId: string, folderName: string) => void
  close: () => void
}) {
  return (
    <>
      <DropdownItem onClick={() => { onRename(folderId, folderName); close() }}>
        Rename
      </DropdownItem>
      <DropdownItem destructive onClick={() => { onDelete(folderId, folderName); close() }}>
        Delete
      </DropdownItem>
    </>
  )
}
