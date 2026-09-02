import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Search } from 'lucide-react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn('flex h-full w-full flex-col overflow-hidden', className)}
    {...props}
  />
))
Command.displayName = CommandPrimitive.displayName

function CommandDialog({
  open,
  onOpenChange,
  title = 'Search',
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} overlayClassName="bg-black/55">
      <DialogContent className="w-[min(calc(100vw-32px),576px)] gap-0 overflow-hidden rounded-xl border-neutral-300/70 bg-white/95 p-0 text-neutral-900 dark:border-white/12 dark:bg-[#252325]/95 dark:text-neutral-100 [&>button]:hidden">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <Command shouldFilter={false}>{children}</Command>
      </DialogContent>
    </Dialog>
  )
}

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex h-11 items-center gap-2 border-b border-neutral-200 px-4 dark:border-white/12" cmdk-input-wrapper="">
    <Search className="h-4 w-4 shrink-0 text-neutral-400" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
    <span className="rounded border border-neutral-300 px-1.5 py-0.5 text-[9px] font-semibold text-neutral-500 dark:border-white/15 dark:text-neutral-400">
      ESC
    </span>
  </div>
))
CommandInput.displayName = CommandPrimitive.Input.displayName

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn('sidebar-scrollbar max-h-[360px] overflow-y-auto overflow-x-hidden p-2', className)}
    {...props}
  />
))
CommandList.displayName = CommandPrimitive.List.displayName

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty ref={ref} className="px-3 py-6 text-center text-xs text-neutral-500" {...props} />
))
CommandEmpty.displayName = CommandPrimitive.Empty.displayName

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'overflow-hidden text-neutral-900 dark:text-neutral-100 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-neutral-500 dark:[&_[cmdk-group-heading]]:text-neutral-400',
      className,
    )}
    {...props}
  />
))
CommandGroup.displayName = CommandPrimitive.Group.displayName

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex min-h-9 cursor-default select-none items-center gap-3 rounded-lg px-2.5 py-2 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-neutral-200/75 data-[disabled=true]:opacity-50 dark:data-[selected=true]:bg-white/10',
      className,
    )}
    {...props}
  />
))
CommandItem.displayName = CommandPrimitive.Item.displayName

export { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList }
