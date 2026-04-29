import * as React from 'react'

import { cn } from '@/lib/utils'

type SidebarButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>

export function SidebarRowButton({
  active,
  className,
  children,
  ...props
}: SidebarButtonProps & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'flex h-8 w-full items-center justify-start gap-2 rounded-full px-2 text-xs',
        active
          ? 'border border-white/12 bg-white/10 text-white'
          : 'text-neutral-300 hover:bg-white/8 hover:text-white',
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
  className,
  children,
  ...props
}: SidebarButtonProps & { revealOnRowHover?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'group/action flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-400 hover:text-white',
        revealOnRowHover && 'opacity-0 group-hover/row:opacity-100',
        className,
      )}
      {...props}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full group-hover/action:bg-white/8">
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
        'flex h-8 w-full items-center gap-2 rounded-full px-2 text-left text-xs hover:bg-white/10',
        destructive
          ? 'text-red-300 hover:bg-red-500/10'
          : active
            ? 'font-medium text-white'
            : 'text-neutral-300',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
