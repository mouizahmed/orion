import React, { createContext, useCallback, useContext, useState } from 'react'
import { PanelLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type SidebarContextType = {
  isOpen: boolean
  toggle: () => void
  setOpen: (open: boolean) => void
}

const SidebarContext = createContext<SidebarContextType | null>(null)

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider')
  }
  return context
}

export function useSidebarOptional() {
  return useContext(SidebarContext)
}

export function SidebarProvider({
  children,
  defaultOpen = true,
}: {
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const toggle = useCallback(() => setIsOpen((prev) => !prev), [])
  const setOpen = useCallback((open: boolean) => setIsOpen(open), [])

  return <SidebarContext.Provider value={{ isOpen, toggle, setOpen }}>{children}</SidebarContext.Provider>
}

export function Sidebar({ children, className }: { children: React.ReactNode; className?: string }) {
  const { isOpen } = useSidebar()

  return (
    <div
      className={cn(
        'h-full transition-all duration-200 ease-in-out select-none overflow-hidden',
        isOpen ? 'w-56' : 'w-0',
        className,
      )}
    >
      <div className="h-full min-h-0 flex flex-col select-none">{children}</div>
    </div>
  )
}

export function SidebarTrigger({ className }: { className?: string }) {
  const sidebarContext = useSidebarOptional()
  if (!sidebarContext) return null

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => sidebarContext.toggle()}
      className={cn(
        'flex items-center gap-2 px-2 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800',
        className,
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <PanelLeft size={14} />
    </Button>
  )
}

export function SidebarHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('p-3 border-b border-neutral-200 dark:border-neutral-800', className)}>{children}</div>
  )
}

export function SidebarContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn('flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-auto sidebar-scrollbar', className)}
      style={{
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgb(163 163 163) transparent',
      } as React.CSSProperties}
    >
      {children}
    </div>
  )
}

export function SidebarFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('border-t border-neutral-200 dark:border-neutral-800', className)}>{children}</div>
}

