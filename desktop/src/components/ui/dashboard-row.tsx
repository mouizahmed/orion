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
        'group flex items-start gap-2.5 rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-neutral-200/70 hover:bg-neutral-100/60 group-data-[state=open]/row-action-menu:border-neutral-200/70 group-data-[state=open]/row-action-menu:bg-neutral-100/60 dark:hover:border-white/8 dark:hover:bg-white/[0.055] dark:group-data-[state=open]/row-action-menu:border-white/8 dark:group-data-[state=open]/row-action-menu:bg-white/[0.055]',
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
        'flex shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100 text-neutral-500 transition-colors group-hover:border-neutral-300/70 group-hover:bg-neutral-100 group-hover:text-neutral-600 group-data-[state=open]/row-action-menu:border-neutral-300/70 group-data-[state=open]/row-action-menu:text-neutral-600 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300 dark:group-hover:border-white/12 dark:group-hover:bg-white/[0.07] dark:group-hover:text-neutral-200 dark:group-data-[state=open]/row-action-menu:border-white/12 dark:group-data-[state=open]/row-action-menu:bg-white/[0.07] dark:group-data-[state=open]/row-action-menu:text-neutral-200',
        className,
      )}
      {...props}
    />
  )
}

export { DashboardIconTile, DashboardRow }
