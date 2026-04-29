import * as React from 'react'

import { cn } from '@/lib/utils'

function DashboardRow({
  className,
  interactive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean
}) {
  return (
    <div
      className={cn(
        'group flex items-start gap-2.5 rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-white/10 hover:bg-white/8',
        interactive && 'cursor-pointer',
        className,
      )}
      {...props}
    />
  )
}

function DashboardIconTile({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-neutral-300 transition-colors group-hover:border-white/15 group-hover:bg-white/10 group-hover:text-neutral-100',
        className,
      )}
      {...props}
    />
  )
}

export { DashboardIconTile, DashboardRow }
