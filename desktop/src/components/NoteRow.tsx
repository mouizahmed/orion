import React, { useCallback, useEffect, useState, type ReactNode } from 'react'
import { FileText, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SidebarIconButton, SidebarRowButton } from '@/components/ui/sidebar-button'
import { DashboardRow, DashboardIconTile } from '@/components/ui/dashboard-row'

type NoteRowProps = {
  title: string
  selected?: boolean
  onClick?: () => void
  actions?: ReactNode
  variant?: 'sidebar' | 'card'
  indented?: boolean
  // sidebar rename support — state stays in parent
  isRenaming?: boolean
  renameValue?: string
  onRenameChange?: (val: string) => void
  onRenameCommit?: () => void
  onRenameCancel?: () => void
  // card only
  subtitle?: string
  timestamp?: string
  // shared menu — renders the 3-dot button, right-click, and dropdown internally
  menuContent?: (close: () => void) => ReactNode
  onMenuClose?: () => void
}

export function NoteRow({
  title,
  selected = false,
  onClick,
  actions,
  variant = 'sidebar',
  indented = false,
  isRenaming = false,
  renameValue = '',
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  subtitle,
  timestamp,
  menuContent,
  onMenuClose,
}: NoteRowProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false)
    onMenuClose?.()
  }, [onMenuClose])

  useEffect(() => {
    if (!isMenuOpen) return
    document.addEventListener('mousedown', closeMenu)
    return () => document.removeEventListener('mousedown', closeMenu)
  }, [isMenuOpen, closeMenu])

  const toggleMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isMenuOpen) closeMenu()
    else setIsMenuOpen(true)
  }

  if (variant === 'card') {
    return (
      <div className="relative">
        <DashboardRow
          onClick={onClick}
          interactive={Boolean(onClick)}
          className="items-center"
          onContextMenu={menuContent ? (e) => { e.preventDefault(); setIsMenuOpen((prev) => !prev) } : undefined}
        >
          <DashboardIconTile className="h-8 w-8">
            <FileText className="h-4 w-4" />
          </DashboardIconTile>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => onRenameChange?.(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onRenameCommit?.()
                      if (e.key === 'Escape') onRenameCancel?.()
                    }}
                    onBlur={() => onRenameCommit?.()}
                    onClick={(e) => e.stopPropagation()}
                    className="block w-full bg-transparent outline-none border-b border-violet-400 text-xs font-medium leading-4 text-neutral-800 dark:text-neutral-200"
                  />
                ) : (
                  <span className="block truncate text-xs font-medium leading-4 text-neutral-800 dark:text-neutral-200">
                    {title || 'Untitled'}
                  </span>
                )}
                {subtitle ? (
                  <span className="block truncate text-xs leading-4 text-neutral-500 dark:text-neutral-400">
                    {subtitle}
                  </span>
                ) : null}
              </div>
              <div className="shrink-0 flex items-center">
                {timestamp ? (
                  <span className={cn(
                    'text-xs leading-4 text-neutral-400 dark:text-neutral-500',
                    (actions || menuContent) && 'group-hover:hidden',
                  )}>
                    {timestamp}
                  </span>
                ) : null}
                {menuContent ? (
                  <div className={cn(timestamp ? 'hidden group-hover:flex' : 'flex', 'items-center')}>
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={toggleMenu}
                      className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-neutral-200 dark:hover:bg-white/10"
                    >
                      <MoreHorizontal size={14} className="text-neutral-500 dark:text-neutral-400" />
                    </button>
                  </div>
                ) : actions ? (
                  <div className={cn(timestamp ? 'hidden group-hover:flex' : 'flex', 'items-center')}>
                    {actions}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </DashboardRow>
        {isMenuOpen && menuContent && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="absolute right-0 top-full z-50 min-w-[140px] rounded-xl border border-neutral-200 bg-white/95 p-1 text-neutral-900 shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/95 dark:text-neutral-100"
          >
            {menuContent(closeMenu)}
          </div>
        )}
      </div>
    )
  }

  // sidebar variant
  return (
    <div
      className="relative group/row min-w-0"
      style={indented ? { paddingLeft: '8px' } : undefined}
      onContextMenu={menuContent ? (e) => { e.preventDefault(); setIsMenuOpen((prev) => !prev) } : undefined}
    >
      <div
        className={cn(
          'flex items-center rounded-full min-w-0',
          selected
            ? 'border border-neutral-200 bg-neutral-100 text-neutral-950 dark:border-white/12 dark:bg-white/10 dark:text-white'
            : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/8 dark:hover:text-white',
        )}
      >
        <SidebarRowButton
          embedded
          className="min-w-0 flex-1 rounded-none text-inherit hover:bg-transparent hover:text-inherit"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={onClick}
          title={title || 'Untitled'}
        >
          <FileText
            size={14}
            className={cn(
              'flex-shrink-0 text-neutral-500 transition-colors group-hover/row:text-neutral-950 dark:text-neutral-400 dark:group-hover/row:text-white',
              selected && 'text-neutral-950 dark:text-white',
            )}
          />
          {isRenaming ? (
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => onRenameChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenameCommit?.()
                if (e.key === 'Escape') onRenameCancel?.()
              }}
              onBlur={() => onRenameCommit?.()}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 bg-transparent outline-none border-b border-violet-400 text-xs"
            />
          ) : (
            <span className="truncate">{title || 'Untitled'}</span>
          )}
        </SidebarRowButton>
        {!isRenaming && menuContent ? (
          <SidebarIconButton
            revealOnRowHover
            suppressHoverBackground={selected}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={toggleMenu}
          >
            <MoreHorizontal size={14} />
          </SidebarIconButton>
        ) : !isRenaming && actions ? (
          <div className="opacity-0 group-hover/row:opacity-100">{actions}</div>
        ) : null}
      </div>
      {isMenuOpen && menuContent && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute right-0 top-8 z-50 min-w-[160px] rounded-xl border border-neutral-200 bg-white/95 p-1 text-neutral-900 shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/95 dark:text-neutral-100"
        >
          {menuContent(closeMenu)}
        </div>
      )}
    </div>
  )
}
