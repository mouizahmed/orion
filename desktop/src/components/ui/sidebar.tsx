import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { PanelLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type SidebarContextType = {
  isOpen: boolean
  isCompact: boolean
  compactPanel: 'navigation' | null
  toggle: () => void
  setOpen: (open: boolean) => void
  setCompactPanel: (panel: 'navigation' | null) => void
}

const SidebarContext = createContext<SidebarContextType | null>(null)
const COMPACT_DASHBOARD_QUERY = '(max-width: 1100px)'

function compactDashboardMatches() {
  return typeof window !== 'undefined' && window.matchMedia(COMPACT_DASHBOARD_QUERY).matches
}

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
  const initialCompact = compactDashboardMatches()
  const [isCompact, setIsCompact] = useState(initialCompact)
  const [isOpen, setIsOpenState] = useState(defaultOpen && !initialCompact)
  const [compactPanel, setCompactPanelState] = useState<'navigation' | null>(null)
  const isOpenRef = useRef(isOpen)
  const desktopOpenRef = useRef(defaultOpen)

  const setOpen = useCallback((open: boolean) => {
    isOpenRef.current = open
    setIsOpenState(open)
    if (isCompact) {
      setCompactPanelState((current) => open ? 'navigation' : current === 'navigation' ? null : current)
    } else {
      desktopOpenRef.current = open
    }
  }, [isCompact])

  const toggle = useCallback(() => {
    setOpen(!isOpenRef.current)
  }, [setOpen])

  const setCompactPanel = useCallback((panel: 'navigation' | null) => {
    setCompactPanelState(panel)
    if (isCompact && panel !== 'navigation' && isOpenRef.current) {
      isOpenRef.current = false
      setIsOpenState(false)
    }
  }, [isCompact])

  useEffect(() => {
    const media = window.matchMedia(COMPACT_DASHBOARD_QUERY)
    const handleChange = () => {
      const nextCompact = media.matches
      setIsCompact(nextCompact)
      setCompactPanelState(null)

      if (nextCompact) {
        desktopOpenRef.current = isOpenRef.current
        isOpenRef.current = false
        setIsOpenState(false)
      } else {
        isOpenRef.current = desktopOpenRef.current
        setIsOpenState(desktopOpenRef.current)
      }
    }

    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  return (
    <SidebarContext.Provider value={{ isOpen, isCompact, compactPanel, toggle, setOpen, setCompactPanel }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function Sidebar({ children, className }: { children: React.ReactNode; className?: string }) {
  const { isOpen, isCompact, setOpen } = useSidebar()

  return (
    <>
      {isCompact && isOpen ? (
        <button
          type="button"
          aria-label="Close navigation sidebar"
          className="fixed inset-x-0 bottom-0 top-12 z-40 bg-black/80 animate-in fade-in-0"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <div
        className={cn(
          'h-full select-none overflow-hidden text-neutral-900 transition-all duration-200 ease-in-out dark:text-neutral-100',
          isCompact
            ? cn(
                'fixed bottom-2 left-2 top-12 z-50 h-auto',
                isOpen
                  ? 'w-56 rounded-lg border border-neutral-300/70 bg-white/95 shadow-2xl backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/95'
                  : 'pointer-events-none w-0 border-0 bg-transparent',
              )
            : isOpen
              ? 'w-56 rounded-lg border border-neutral-300/70 bg-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_18px_46px_-34px_rgba(15,23,42,0.5)] backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/80 dark:shadow-none'
              : 'w-0 border-0 bg-transparent',
          className,
        )}
      >
        <div className="flex h-full min-h-0 flex-col select-none">{children}</div>
      </div>
    </>
  )
}

export function SidebarTrigger({ className }: { className?: string }) {
  const sidebarContext = useSidebarOptional()
  if (!sidebarContext) return null

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => sidebarContext.toggle()}
      className={cn(
        'flex h-8 items-center gap-2 rounded-full px-2 text-xs',
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
  return <div className={cn('border-t border-neutral-200 dark:border-white/10', className)}>{children}</div>
}
