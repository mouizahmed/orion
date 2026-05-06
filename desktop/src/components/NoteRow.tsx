import React, { type ReactNode } from 'react'
import { FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SidebarRowButton } from '@/components/ui/sidebar-button'
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
}: NoteRowProps) {
  if (variant === 'card') {
    return (
      <DashboardRow onClick={onClick} interactive={Boolean(onClick)} className="items-center">
        <DashboardIconTile className="h-8 w-8">
          <FileText className="h-4 w-4" />
        </DashboardIconTile>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="block truncate text-xs font-medium leading-4 text-neutral-800 dark:text-neutral-200">
                {title || 'Untitled'}
              </span>
              {subtitle ? (
                <span className="block truncate text-xs leading-4 text-neutral-500 dark:text-neutral-400">
                  {subtitle}
                </span>
              ) : null}
            </div>
            {timestamp ? (
              <span className="shrink-0 text-xs leading-4 text-neutral-400 dark:text-neutral-500">
                {timestamp}
              </span>
            ) : null}
          </div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </DashboardRow>
    )
  }

  // sidebar variant
  return (
    <div className="relative group/row min-w-0" style={indented ? { paddingLeft: '8px' } : undefined}>
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
        {!isRenaming && actions ? (
          <div className="opacity-0 group-hover/row:opacity-100">{actions}</div>
        ) : null}
      </div>
    </div>
  )
}
