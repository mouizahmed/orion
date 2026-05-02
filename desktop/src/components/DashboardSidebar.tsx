import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Home, LogOut, Notebook, Settings, Users } from 'lucide-react'

import { Sidebar as SidebarContainer } from '@/components/ui/sidebar'
import { SidebarIconButton, SidebarMenuItemButton, SidebarRowButton } from '@/components/ui/sidebar-button'
import { NotesTree } from '@/components/NotesTree'
import { CreateFolderDialog } from '@/components/dialog/CreateFolderDialog'
import { DashboardSettingsNav, type DashboardSettingsSection } from '@/components/DashboardSettingsPage'
import { useAuth } from '@/contexts/AuthContext'
import { useDashboardNotes } from '@/contexts/DashboardNotesContext'

export default function DashboardSidebar({
  mode = 'notes',
  selectedSettingsSection = 'account',
  onOpenHome,
  onOpenCalendar,
  onOpenSettings,
  onCloseSettings,
  onSelectSettingsSection,
}: {
  mode?: 'notes' | 'calendar' | 'settings'
  selectedSettingsSection?: DashboardSettingsSection
  onOpenHome?: () => void
  onOpenCalendar?: () => void
  onOpenSettings?: () => void
  onCloseSettings?: () => void
  onSelectSettingsSection?: (section: DashboardSettingsSection) => void
}) {
  const { user, logout } = useAuth()
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
    openCreateNoteDialog,
    search,
    deleteById,
    renameNote,
    moveNote,
  } = useDashboardNotes()

  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false)
  const [profileImageFailed, setProfileImageFailed] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const profileMenuRef = useRef<HTMLDivElement | null>(null)
  const displayName = user?.name || user?.email || 'Account'
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'S'

  useEffect(() => {
    setProfileImageFailed(false)
  }, [user?.picture])

  useEffect(() => {
    console.log('Dashboard sidebar user avatar debug', {
      id: user?.id,
      email: user?.email,
      name: user?.name,
      picture: user?.picture,
    })
  }, [user?.email, user?.id, user?.name, user?.picture])

  useEffect(() => {
    if (!profileMenuOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProfileMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [profileMenuOpen])

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
      <SidebarRowButton
        active={isActive}
        onClick={onClick}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Icon size={14} />
        <span>{label}</span>
      </SidebarRowButton>
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

  const openHome = () => {
    onCloseSettings?.()
    onOpenHome?.()
    selectFolder(null)
    selectNote(null)
  }

  const openCalendar = () => {
    onOpenCalendar?.()
    selectFolder(null)
    selectNote(null)
  }

  const openNotesPage = () => {
    onOpenHome?.()
  }

  return (
    <SidebarContainer className="">
      <div className="p-1">
        {mode === 'settings' ? (
          <DashboardSettingsNav
            selectedSection={selectedSettingsSection}
            onSelectSection={(section) => onSelectSettingsSection?.(section)}
            onBackToApp={() => onCloseSettings?.()}
          />
        ) : (
          <div className="space-y-1">
            <NavButton
              icon={Home}
              label="Home"
              onClick={openHome}
              isActive={mode === 'notes' && selectedId === null}
            />
            <NavButton
              icon={CalendarDays}
              label="Calendar"
              onClick={openCalendar}
              isActive={mode === 'calendar'}
            />
            <NavButton
              icon={Notebook}
              label="My Notes"
              onClick={() => {}}
              isActive={false}
            />
            <NavButton
              icon={Users}
              label="Shared with me"
              onClick={() => {}}
              isActive={false}
            />
          </div>
        )}
      </div>

      {mode === 'settings' ? (
        <div className="flex min-h-0 flex-1 items-end px-3 pb-2">
          <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            Need help? Email{' '}
            <a
              href="mailto:support@orionly.app"
              className="font-medium text-neutral-700 underline-offset-2 hover:underline dark:text-neutral-200"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              support@orionly.app
            </a>
          </p>
        </div>
      ) : (
        <>
          <div className="border-t border-neutral-200 dark:border-white/10" />

          <div className="min-h-0 flex-1 p-1">
            <NotesTree
              folders={folders}
              onCreateFolder={() => setShowCreateFolderDialog(true)}
              onCreateNote={() => {
                openNotesPage()
                openCreateNoteDialog()
              }}
              notes={filteredNotes}
              isLoading={isLoading}
              error={loadError}
              folderPagination={folderPagination}
              onLoadMore={loadMoreForFolder}
              selectedFolderId={selectedFolderId}
              selectedNoteId={selectedId}
              search={search}
              onSelectFolder={(folderId) => {
                openNotesPage()
                selectFolder(folderId)
              }}
              onSelectNote={(noteId) => {
                openNotesPage()
                selectNote(noteId)
              }}
              onRenameFolder={async (id, name) => { await renameFolder(id, name) }}
              onDeleteFolder={async (id) => { await deleteFolder(id) }}
              onRenameNote={async (id, title) => { await renameNote(id, title) }}
              onDeleteNote={async (id) => { await deleteById(id) }}
              onMoveNote={async (id, folderId) => { await moveNote(id, folderId) }}
            />
          </div>
        </>
      )}

      <div className="border-t border-neutral-200 p-1 dark:border-white/10">
        <div
          ref={profileMenuRef}
          className="relative flex h-8 items-center gap-2 rounded-full text-xs text-neutral-700 dark:text-neutral-200"
        >
          <SidebarRowButton
            className="min-w-0 flex-1 text-left"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            onClick={() => setProfileMenuOpen((open) => !open)}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {user?.picture && !profileImageFailed ? (
              <img
                src={user.picture}
                alt=""
                className="h-5 w-5 shrink-0 rounded-full object-cover"
                draggable={false}
                referrerPolicy="no-referrer"
                onLoad={() => {
                  console.log('Dashboard sidebar avatar loaded', user.picture)
                }}
                onError={(event) => {
                  console.warn('Dashboard sidebar avatar failed to load', user.picture, event.currentTarget.currentSrc)
                  setProfileImageFailed(true)
                }}
              />
            ) : (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700 dark:bg-white/10 dark:text-white">
                {initials}
              </div>
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{displayName}</span>
          </SidebarRowButton>
          <SidebarIconButton
            aria-label="Settings"
            suppressHoverBackground={mode === 'settings'}
            onClick={onOpenSettings}
            className={mode === 'settings' ? 'border border-neutral-200 bg-neutral-100 text-neutral-950 dark:border-white/12 dark:bg-white/10 dark:text-white' : undefined}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <Settings size={14} />
          </SidebarIconButton>
          {profileMenuOpen ? (
            <div
              role="menu"
              className="absolute bottom-[calc(100%+6px)] left-1 z-50 w-[calc(100%-8px)] rounded-xl border border-neutral-200 bg-white/95 p-1 text-neutral-900 shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/95 dark:text-neutral-100"
            >
              <SidebarMenuItemButton
                role="menuitem"
                onClick={() => {
                  setProfileMenuOpen(false)
                  logout()
                }}
              >
                <LogOut size={14} />
                <span>Log out</span>
              </SidebarMenuItemButton>
            </div>
          ) : null}
        </div>
      </div>

      <CreateFolderDialog
        isOpen={showCreateFolderDialog}
        onClose={() => setShowCreateFolderDialog(false)}
        onCreate={handleCreateFolder}
      />

    </SidebarContainer>
  )
}
