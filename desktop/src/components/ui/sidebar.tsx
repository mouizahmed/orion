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
        'h-full transition-all duration-200 ease-in-out select-none overflow-hidden text-neutral-100',
        isOpen
          ? 'w-56 rounded-lg border border-white/10 bg-[#171417]/80 backdrop-blur-md'
          : 'w-0 border-0 bg-transparent',
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
        'flex h-8 items-center gap-2 rounded-full border border-white/12 bg-[#171417]/80 px-2 text-xs text-neutral-300 hover:bg-white/10 hover:text-white',
        className,
      )}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <PanelLeft size={14} />
    </Button>
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
  return <div className={cn('border-t border-white/10', className)}>{children}</div>
}
