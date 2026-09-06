import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Home, MessageCircle, Notebook, Settings } from 'lucide-react'

import { Sidebar as SidebarContainer, useSidebar } from '@/components/ui/sidebar'
import { SidebarIconButton, SidebarRowButton, sidebarActiveClassName } from '@/components/ui/sidebar-button'
import { DropdownItem } from '@/components/ui/dropdown-list'
import { NotesTree } from '@/features/notes/NotesTree'
import { CreateFolderDialog } from '@/features/notes/dialogs/CreateFolderDialog'
import { SettingsNav } from '@/features/settings/SettingsNav'
import type { DashboardSettingsSection } from '@/features/settings/settings-config'
import { useAuth } from '@/features/auth/AuthContext'
import { useDashboardNotes } from '@/features/notes/DashboardNotesContext'
import type { DashboardViewMode } from '@/features/dashboard/types'

export default function DashboardSidebar({
  mode = 'home',
  selectedSettingsSection = 'account',
  onOpenHome,
  onOpenNotes,
  onOpenCalendar,
  onOpenChat,
  onOpenSettings,
  onCloseSettings,
  onSelectSettingsSection,
}: {
  mode?: DashboardViewMode
  selectedSettingsSection?: DashboardSettingsSection
  onOpenHome?: () => void
  onOpenNotes?: () => void
  onOpenCalendar?: () => void
  onOpenChat?: () => void
  onOpenSettings?: () => void
  onCloseSettings?: () => void
  onSelectSettingsSection?: (section: DashboardSettingsSection) => void
}) {
  const { isCompact, setOpen } = useSidebar()
  const { user, logout } = useAuth()
  const {
    isLoading,
    folders,
    selectFolder,
    createFolder,
    requestDeleteFolder,
    renameFolder,
    selectedId,
    selectNote,
    openCreateNoteDialog,
    requestDeleteNote,
    renameNote,
    moveNote,
  } = useDashboardNotes()

  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const avatarSrc = user?.picture ?? null
  const profileMenuRef = useRef<HTMLDivElement | null>(null)
  const displayName = user?.name || user?.email || 'Account'
  const planLabel = user?.plan === 'professional'
    ? 'Professional'
    : user?.plan === 'business'
      ? 'Business'
      : 'Free'
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'S'

  const closeCompactSidebar = () => {
    if (isCompact) setOpen(false)
  }

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
        onOpenNotes?.()
        selectFolder(created.id)
        return true
      }
      return false
    }
  }, [createFolder, onOpenNotes, selectFolder])

  const openHome = () => {
    onCloseSettings?.()
    onOpenHome?.()
    selectFolder(null)
    selectNote(null)
    closeCompactSidebar()
  }

  const openCalendar = () => {
    onOpenCalendar?.()
    selectFolder(null)
    selectNote(null)
    closeCompactSidebar()
  }

  const openNotesPage = () => {
    onOpenNotes?.()
    closeCompactSidebar()
  }

  const openNotesRoot = () => {
    onOpenNotes?.()
    selectFolder(null)
    selectNote(null)
    closeCompactSidebar()
  }

  return (
    <SidebarContainer className="">
      <div className="p-1">
        {mode === 'settings' ? (
            <SettingsNav
            selectedSection={selectedSettingsSection}
            onSelectSection={(section) => {
              onSelectSettingsSection?.(section)
              closeCompactSidebar()
            }}
            onBackToApp={() => {
              onCloseSettings?.()
              closeCompactSidebar()
            }}
          />
        ) : (
          <div className="space-y-1">
            <NavButton
              icon={Home}
              label="Home"
              onClick={openHome}
              isActive={mode === 'home' && selectedId === null}
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
              onClick={openNotesRoot}
              isActive={mode === 'notes'}
            />
            <NavButton
              icon={MessageCircle}
              label="Chat"
              onClick={() => {
                onOpenChat?.()
                selectFolder(null)
                selectNote(null)
                closeCompactSidebar()
              }}
              isActive={mode === 'chat'}
            />
          </div>
        )}
      </div>

      {mode === 'settings' ? (
        <div className="flex min-h-0 flex-1 items-end px-3 pb-2">
          <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            Need help? Email{' '}
            <a
              href="mailto:support@orion.app"
              className="font-medium text-neutral-700 underline-offset-2 hover:underline dark:text-neutral-200"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              support@orion.app
            </a>
          </p>
        </div>
      ) : (
        <>
          <div className="border-t border-neutral-200 dark:border-white/10" />

          <div className="min-h-0 flex-1 p-1">
            <NotesTree
              accountID={user?.id ?? ''}
              folders={folders}
              isLoading={isLoading}
              selectedNoteID={selectedId}
              onCreateFolder={() => setShowCreateFolderDialog(true)}
              onCreateNote={() => {
                openNotesPage()
                openCreateNoteDialog()
              }}
              onSelectNote={(note) => {
                openNotesPage()
                selectFolder(note.folderId ?? null)
                selectNote(note.id)
              }}
              onRenameFolder={(id, name) => renameFolder(id, name)}
              onDeleteFolder={(id, name) => requestDeleteFolder(id, name)}
              onRenameNote={(id, title) => renameNote(id, title)}
              onDeleteNote={(id, title) => requestDeleteNote(id, title)}
              onMoveNote={(id, folderId) => moveNote(id, folderId)}
            />
          </div>
        </>
      )}

      <div className="border-t border-neutral-200 p-1 dark:border-white/10">
        <div
          ref={profileMenuRef}
          className="relative flex h-8 items-center gap-2 rounded-md text-xs text-neutral-700 dark:text-neutral-200"
        >
          <SidebarRowButton
            className="min-w-0 flex-1 text-left"
            aria-haspopup="menu"
            aria-expanded={profileMenuOpen}
            onClick={() => setProfileMenuOpen((open) => !open)}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {avatarSrc ? (
              <img
                src={avatarSrc}
                alt=""
                className="h-5 w-5 shrink-0 rounded-full object-cover"
                draggable={false}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700 dark:bg-white/10 dark:text-white">
                {initials}
              </div>
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{displayName}</span>
          </SidebarRowButton>
          <SidebarIconButton
            size="row"
            aria-label="Settings"
            suppressHoverBackground={mode === 'settings'}
            onClick={() => {
              onOpenSettings?.()
              closeCompactSidebar()
            }}
            className={mode === 'settings' ? sidebarActiveClassName : undefined}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <Settings size={14} />
          </SidebarIconButton>
          {profileMenuOpen ? (
            <div
              role="menu"
              className="absolute bottom-[calc(100%+6px)] left-1 z-50 w-[calc(100%-8px)] rounded-xl border border-neutral-200 bg-white/95 py-1 text-neutral-900 shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/95 dark:text-neutral-100"
            >
              <button
                type="button"
                role="menuitem"
                className="mx-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-md px-2 py-2 text-left outline-none transition-colors hover:bg-neutral-100 focus:bg-neutral-100 dark:hover:bg-white/10 dark:focus:bg-white/10"
                onClick={() => {
                  setProfileMenuOpen(false)
                  onSelectSettingsSection?.('account')
                  if (mode !== 'settings') onOpenSettings?.()
                  closeCompactSidebar()
                }}
              >
                {avatarSrc ? (
                  <img
                    src={avatarSrc}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-full object-cover"
                    draggable={false}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700 dark:bg-white/10 dark:text-white">
                    {initials}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{displayName}</span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-500 dark:text-neutral-400">{planLabel}</span>
                </span>
              </button>
              <div className="my-1 h-px bg-neutral-200 dark:bg-white/10" />
              <DropdownItem
                role="menuitem"
                radius="md"
                onClick={() => {
                  setProfileMenuOpen(false)
                  logout()
                }}
              >
                Log out
              </DropdownItem>
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
