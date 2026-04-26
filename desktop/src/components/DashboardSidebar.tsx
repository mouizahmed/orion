import React, { useMemo, useState } from 'react'
import { Home, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Sidebar as SidebarContainer, SidebarContent } from '@/components/ui/sidebar'
import { NotesTree } from '@/components/NotesTree'
import { CreateFolderDialog } from '@/components/dialog/CreateFolderDialog'
import { CreateNoteDialog } from '@/components/dialog/CreateNoteDialog'
import { useDashboardNotes } from '@/contexts/DashboardNotesContext'

export default function DashboardSidebar() {
  const {
    isLoading,
    loadError,
    folders,
    folderPagination,
    loadMoreForFolder,
    selectedFolderId,
    selectFolder,
    createFolder,
    deleteFolder,
    renameFolder,
    filteredNotes,
    selectedId,
    selectNote,
    search,
    createNewNote,
    deleteById,
    renameNote,
    moveNote,
  } = useDashboardNotes()

  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false)
  const [showCreateNoteDialog, setShowCreateNoteDialog] = useState(false)

  function NavButton({
    icon: Icon,
    label,
    onClick,
    isActive,
  }: {
    icon: React.ComponentType<{ size?: number | string }>
    label: string
    onClick: () => void
    isActive?: boolean
  }) {
    return (
      <Button
        type="button"
        variant={isActive ? 'default' : 'ghost'}
        className={`w-full justify-start gap-2 py-1 px-2 text-xs h-7 ${
          isActive
            ? 'bg-violet-600 text-white hover:bg-violet-700'
            : 'hover:bg-neutral-100 dark:hover:bg-neutral-700'
        }`}
        onClick={onClick}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Icon size={14} />
        <span>{label}</span>
      </Button>
    )
  }

  const handleCreateFolder = useMemo(() => {
    return async (name: string) => {
      const created = await createFolder(name)
      if (created) {
        selectFolder(created.id)
        return true
      }
      return false
    }
  }, [createFolder, selectFolder])

  return (
    <SidebarContainer className="">
      <SidebarContent className="">
        <div className="space-y-1">
          <NavButton
            icon={Home}
            label="Home"
            onClick={() => { selectFolder(null); selectNote(null) }}
            isActive={selectedId === null}
          />
          <NavButton
            icon={Users}
            label="Shared with me"
            onClick={() => {}}
            isActive={false}
          />
        </div>

        <NotesTree
          folders={folders}
          onCreateFolder={() => setShowCreateFolderDialog(true)}
          onCreateNote={() => setShowCreateNoteDialog(true)}
          notes={filteredNotes}
          isLoading={isLoading}
          error={loadError}
          folderPagination={folderPagination}
          onLoadMore={loadMoreForFolder}
          selectedFolderId={selectedFolderId}
          selectedNoteId={selectedId}
          search={search}
          onSelectFolder={selectFolder}
          onSelectNote={selectNote}
          onRenameFolder={async (id, name) => { await renameFolder(id, name) }}
          onDeleteFolder={async (id) => { await deleteFolder(id) }}
          onRenameNote={async (id, title) => { await renameNote(id, title) }}
          onDeleteNote={async (id) => { await deleteById(id) }}
          onMoveNote={async (id, folderId) => { await moveNote(id, folderId) }}
        />
      </SidebarContent>

      <CreateFolderDialog
        isOpen={showCreateFolderDialog}
        onClose={() => setShowCreateFolderDialog(false)}
        onCreate={handleCreateFolder}
      />

      <CreateNoteDialog
        isOpen={showCreateNoteDialog}
        folders={folders}
        defaultFolderId={selectedFolderId}
        onClose={() => setShowCreateNoteDialog(false)}
        onCreate={async ({ title, folderId }) => {
          const created = await createNewNote({ title, folderId })
          return Boolean(created)
        }}
      />
    </SidebarContainer>
  )
}
