import { SidebarMenuItemButton } from '@/components/ui/sidebar-button'

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
      <SidebarMenuItemButton onClick={() => { onRename(folderId, folderName); close() }}>
        Rename
      </SidebarMenuItemButton>
      <SidebarMenuItemButton destructive onClick={() => { onDelete(folderId, folderName); close() }}>
        Delete
      </SidebarMenuItemButton>
    </>
  )
}
