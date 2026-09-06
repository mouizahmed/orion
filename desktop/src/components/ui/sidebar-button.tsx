import * as React from 'react'

import { cn } from '@/lib/utils'

type SidebarButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>

export const sidebarActiveClassName = 'border border-neutral-200 bg-neutral-100 text-neutral-950 dark:border-white/12 dark:bg-white/10 dark:text-white'

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
        'flex h-8 w-full items-center justify-start gap-2 rounded-md px-2 text-xs',
        embedded
          ? 'text-inherit'
          : active
          ? sidebarActiveClassName
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
  active = false,
  size = 'compact',
  className,
  children,
  ...props
}: SidebarButtonProps & {
  revealOnRowHover?: boolean
  suppressHoverBackground?: boolean
  active?: boolean
  size?: 'compact' | 'row'
}) {
  return (
    <button
      type="button"
      className={cn(
        'group/action flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:text-neutral-950 dark:text-neutral-400 dark:hover:text-white',
        revealOnRowHover && 'opacity-0 group-hover/row:opacity-100 group-data-[state=open]/row-action-menu:opacity-100',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'flex items-center justify-center border border-transparent',
          size === 'row' ? 'h-8 w-8 rounded-md' : 'h-6 w-6 rounded-sm',
          !suppressHoverBackground && active
            ? 'group-hover/action:border-neutral-300/55 group-hover/action:bg-neutral-200/85 dark:group-hover/action:border-transparent dark:group-hover/action:bg-white/16'
            : !suppressHoverBackground && 'group-hover/action:border-neutral-300/35 group-hover/action:bg-neutral-200/65 dark:group-hover/action:border-transparent dark:group-hover/action:bg-white/8',
        )}
      >
        {children}
      </span>
    </button>
  )
}
