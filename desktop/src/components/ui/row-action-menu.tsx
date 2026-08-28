import * as React from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

import { SidebarIconButton } from '@/components/ui/sidebar-button'
import { cn } from '@/lib/utils'

type RowActionMenuContextValue = {
  toggle: (event: React.MouseEvent) => void
}

const RowActionMenuContext = React.createContext<RowActionMenuContextValue | null>(null)

function useRowActionMenu() {
  const context = React.useContext(RowActionMenuContext)
  if (!context) throw new Error('RowActionMenuTrigger must be used within RowActionMenu')
  return context
}

export function RowActionMenu({
  menuContent,
  onClose,
  placement = 'below',
  className,
  children,
  ...props
}: Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'onContextMenu'> & {
  menuContent?: (close: () => void) => React.ReactNode
  onClose?: () => void
  placement?: 'below' | 'row-end'
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [cursorPosition, setCursorPosition] = React.useState<{ x: number; y: number } | null>(null)
  const [popupPosition, setPopupPosition] = React.useState<{ x: number; y: number } | null>(null)
  const popupRef = React.useRef<HTMLDivElement | null>(null)

  const close = React.useCallback(() => {
    setOpen(false)
    setCursorPosition(null)
    setPopupPosition(null)
    onClose?.()
  }, [onClose])

  React.useEffect(() => {
    if (!open) return
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', handleKeyDown)
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [close, open])

  React.useLayoutEffect(() => {
    if (!open || !cursorPosition || !popupRef.current) return
    const bounds = popupRef.current.getBoundingClientRect()
    const viewportPadding = 8
    setPopupPosition({
      x: Math.max(viewportPadding, Math.min(cursorPosition.x, window.innerWidth - bounds.width - viewportPadding)),
      y: Math.max(viewportPadding, Math.min(cursorPosition.y, window.innerHeight - bounds.height - viewportPadding)),
    })
  }, [cursorPosition, open])

  const toggle = React.useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (open) close()
    else {
      setCursorPosition(null)
      setPopupPosition(null)
      setOpen(true)
    }
  }, [close, open])

  const contextValue = React.useMemo(() => ({ toggle }), [toggle])
  const popup = open && menuContent ? (
    <div
      ref={popupRef}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      style={cursorPosition && popupPosition ? {
        left: popupPosition.x,
        top: popupPosition.y,
      } : undefined}
      className={cn(
        'z-50 min-w-[160px] rounded-xl border border-neutral-200 bg-white/95 p-1 text-neutral-900 shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/95 dark:text-neutral-100',
        cursorPosition
          ? 'fixed'
          : cn('absolute right-0', placement === 'row-end' ? 'top-8' : 'top-full'),
      )}
    >
      {menuContent(close)}
    </div>
  ) : null

  return (
    <RowActionMenuContext.Provider value={contextValue}>
      <div
        className={cn('relative', className)}
        onContextMenu={menuContent ? (event) => {
          event.preventDefault()
          event.stopPropagation()
          const requestedPosition = { x: event.clientX, y: event.clientY + 4 }
          setCursorPosition(requestedPosition)
          setPopupPosition(requestedPosition)
          setOpen(true)
        } : undefined}
        {...props}
      >
        {children}
        {cursorPosition && popup && typeof document !== 'undefined'
          ? createPortal(popup, document.body)
          : popup}
      </div>
    </RowActionMenuContext.Provider>
  )
}

export function RowActionMenuTrigger({
  variant = 'card',
  suppressHoverBackground = false,
  className,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  variant?: 'card' | 'sidebar'
  suppressHoverBackground?: boolean
}) {
  const { toggle } = useRowActionMenu()

  if (variant === 'sidebar') {
    return (
      <SidebarIconButton
        type="button"
        {...props}
        revealOnRowHover
        suppressHoverBackground={suppressHoverBackground}
        className={className}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={toggle}
      >
        <MoreHorizontal size={14} />
      </SidebarIconButton>
    )
  }

  return (
    <button
      type="button"
      {...props}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-neutral-200 dark:hover:bg-white/10',
        className,
      )}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={toggle}
    >
      <MoreHorizontal size={14} className="text-neutral-500 dark:text-neutral-400" />
    </button>
  )
}
