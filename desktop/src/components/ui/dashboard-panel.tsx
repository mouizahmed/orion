import * as React from 'react'

import { cn } from '@/lib/utils'

function DashboardPanel({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-lg border border-neutral-300/70 bg-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_18px_46px_-34px_rgba(15,23,42,0.5)] backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/80 dark:shadow-none',
        className,
      )}
      {...props}
    />
  )
}

function DashboardPanelHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-2.5 py-2',
        className,
      )}
      {...props}
    />
  )
}

function DashboardPanelTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn(
        'text-base font-medium leading-none text-neutral-900 dark:text-neutral-100',
        className,
      )}
      {...props}
    />
  )
}

function DashboardPanelDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('mt-1 text-xs leading-none text-neutral-500 dark:text-neutral-400', className)}
      {...props}
    />
  )
}

function DashboardPanelBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('overflow-y-auto p-1 sidebar-scrollbar', className)}
      {...props}
    />
  )
}

export {
  DashboardPanel,
  DashboardPanelBody,
  DashboardPanelDescription,
  DashboardPanelHeader,
  DashboardPanelTitle,
}
