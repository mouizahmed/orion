import * as React from 'react'

import { cn } from '@/lib/utils'

type SidebarButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>

export function SidebarRowButton({
  active,
  embedded,
  className,
  children,
  ...props
}: SidebarButtonProps & { active?: boolean; embedded?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-8 w-full items-center justify-start gap-2 rounded-full px-2 text-xs',
        embedded
          ? 'text-inherit'
          : active
          ? 'border border-neutral-200 bg-neutral-100 text-neutral-950 dark:border-white/12 dark:bg-white/10 dark:text-white'
          : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/8 dark:hover:text-white',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function SidebarIconButton({
  revealOnRowHover,
  suppressHoverBackground,
  className,
  children,
  ...props
}: SidebarButtonProps & { revealOnRowHover?: boolean; suppressHoverBackground?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'group/action flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white',
        revealOnRowHover && 'opacity-0 group-hover/row:opacity-100',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full border border-transparent',
          !suppressHoverBackground && 'group-hover/action:border-neutral-300/35 group-hover/action:bg-neutral-200/65 dark:group-hover/action:border-transparent dark:group-hover/action:bg-white/8',
        )}
      >
        {children}
      </span>
    </button>
  )
}

export function SidebarMenuItemButton({
  destructive,
  active,
  className,
  children,
  ...props
}: SidebarButtonProps & { destructive?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-full px-2 text-left text-xs hover:bg-neutral-100 dark:hover:bg-white/10',
        destructive
          ? 'text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-300 dark:hover:bg-red-500/10 dark:hover:text-red-200'
          : active
            ? 'font-medium text-neutral-950 dark:text-white'
            : 'text-neutral-600 dark:text-neutral-300',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
