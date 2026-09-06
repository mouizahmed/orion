import * as React from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

import { SidebarIconButton } from '@/components/ui/sidebar-button'
import { cn } from '@/lib/utils'

type RowActionMenuContextValue = {
  toggle: (event: React.MouseEvent) => void
}

type PopupAnchor =
  | { kind: 'pointer'; x: number; y: number }
  | { kind: 'trigger'; element: HTMLElement }

const RowActionMenuContext = React.createContext<RowActionMenuContextValue | null>(null)
const ROW_ACTION_MENU_OPEN_EVENT = 'orion:row-action-menu-open'

const activeMenuScrollRegions = new Set<HTMLElement>()
let activeMenuScrollLocks = 0
let previousRootOverflow = ''
let previousBodyOverflow = ''

function activeMenuForEvent(event: Event) {
  const target = event.target
  if (!(target instanceof Node)) return null
  return Array.from(activeMenuScrollRegions).find((region) => region.contains(target)) ?? null
}

function menuCanConsumeWheel(event: WheelEvent, menu: HTMLElement) {
  const target = event.target
  let element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null

  while (element && menu.contains(element)) {
    const styles = window.getComputedStyle(element)
    const canScrollVertically = /(auto|scroll|overlay)/.test(styles.overflowY)
      && element.scrollHeight > element.clientHeight
      && ((event.deltaY < 0 && element.scrollTop > 0)
        || (event.deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight))
    const canScrollHorizontally = /(auto|scroll|overlay)/.test(styles.overflowX)
      && element.scrollWidth > element.clientWidth
      && ((event.deltaX < 0 && element.scrollLeft > 0)
        || (event.deltaX > 0 && element.scrollLeft + element.clientWidth < element.scrollWidth))

    if (canScrollVertically || canScrollHorizontally) return true
    if (element === menu) break
    element = element.parentElement
  }

  return false
}

function preventBackgroundScroll(event: Event) {
  const menu = activeMenuForEvent(event)
  if (event instanceof WheelEvent && menu && menuCanConsumeWheel(event, menu)) return
  event.preventDefault()
}

function preventBackgroundKeyboardScroll(event: KeyboardEvent) {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
  }
}

function lockBackgroundScroll(menu: HTMLElement) {
  activeMenuScrollRegions.add(menu)
  activeMenuScrollLocks += 1

  if (activeMenuScrollLocks === 1) {
    previousRootOverflow = document.documentElement.style.overflow
    previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    document.addEventListener('wheel', preventBackgroundScroll, { capture: true, passive: false })
    document.addEventListener('touchmove', preventBackgroundScroll, { capture: true, passive: false })
    document.addEventListener('keydown', preventBackgroundKeyboardScroll, true)
  }

  return () => {
    activeMenuScrollRegions.delete(menu)
    activeMenuScrollLocks = Math.max(0, activeMenuScrollLocks - 1)
    if (activeMenuScrollLocks > 0) return

    document.documentElement.style.overflow = previousRootOverflow
    document.body.style.overflow = previousBodyOverflow
    document.removeEventListener('wheel', preventBackgroundScroll, true)
    document.removeEventListener('touchmove', preventBackgroundScroll, true)
    document.removeEventListener('keydown', preventBackgroundKeyboardScroll, true)
  }
}

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
  const [popupAnchor, setPopupAnchor] = React.useState<PopupAnchor | null>(null)
  const [popupPosition, setPopupPosition] = React.useState<{ x: number; y: number } | null>(null)
  const popupRef = React.useRef<HTMLDivElement | null>(null)
  const menuId = React.useRef(Symbol('row-action-menu'))

  const close = React.useCallback(() => {
    setOpen(false)
    setPopupAnchor(null)
    setPopupPosition(null)
    onClose?.()
  }, [onClose])

  React.useEffect(() => {
    if (!open) return
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener(ROW_ACTION_MENU_OPEN_EVENT, handleAnotherMenuOpen)
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }
    function handleAnotherMenuOpen(event: Event) {
      if ((event as CustomEvent<symbol>).detail !== menuId.current) close()
    }
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener(ROW_ACTION_MENU_OPEN_EVENT, handleAnotherMenuOpen)
    }
  }, [close, open])

  React.useEffect(() => {
    if (!open || !popupRef.current) return
    return lockBackgroundScroll(popupRef.current)
  }, [open])

  React.useLayoutEffect(() => {
    if (!open || !popupAnchor || !popupRef.current) return
    const popup = popupRef.current
    const updatePosition = () => {
      const bounds = popup.getBoundingClientRect()
      const viewportPadding = 8
      let desiredX: number
      let desiredY: number
      if (popupAnchor.kind === 'trigger') {
        const triggerBounds = popupAnchor.element.getBoundingClientRect()
        desiredX = triggerBounds.right - bounds.width
        desiredY = triggerBounds.bottom + 4
      } else {
        desiredX = popupAnchor.x
        desiredY = popupAnchor.y
      }
      const position = {
        x: Math.max(viewportPadding, Math.min(desiredX, window.innerWidth - bounds.width - viewportPadding)),
        y: Math.max(viewportPadding, Math.min(desiredY, window.innerHeight - bounds.height - viewportPadding)),
      }
      setPopupPosition((current) => current?.x === position.x && current.y === position.y ? current : position)
    }

    updatePosition()
    const resizeObserver = new ResizeObserver(updatePosition)
    resizeObserver.observe(popup)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, popupAnchor])

  const openMenu = React.useCallback((anchor: PopupAnchor | null) => {
    document.dispatchEvent(new CustomEvent(ROW_ACTION_MENU_OPEN_EVENT, { detail: menuId.current }))
    setPopupAnchor(anchor)
    setPopupPosition(null)
    setOpen(true)
  }, [])

  const toggle = React.useCallback((event: React.MouseEvent) => {
    event.stopPropagation()
    if (open) close()
    else openMenu(
      placement === 'row-end'
        ? { kind: 'trigger', element: event.currentTarget as HTMLElement }
        : null,
    )
  }, [close, open, openMenu, placement])

  const contextValue = React.useMemo(() => ({ toggle }), [toggle])
  const popup = open && menuContent ? (
    <div
      ref={popupRef}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      style={popupAnchor && popupPosition ? {
        left: popupPosition.x,
        top: popupPosition.y,
      } : undefined}
      className={cn(
        'z-[70] min-w-[160px] overscroll-contain rounded-lg border border-neutral-200 bg-white/95 p-1 text-neutral-900 shadow-xl backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/95 dark:text-neutral-100',
        popupAnchor
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
        className={cn('group/row-action-menu relative', className)}
        data-state={open ? 'open' : 'closed'}
        onContextMenu={menuContent ? (event) => {
          event.preventDefault()
          event.stopPropagation()
          const requestedPosition = { x: event.clientX, y: event.clientY + 4 }
          openMenu({ kind: 'pointer', ...requestedPosition })
        } : undefined}
        {...props}
      >
        {children}
        {popupAnchor && popup && typeof document !== 'undefined'
          ? createPortal(popup, document.body)
          : popup}
      </div>
    </RowActionMenuContext.Provider>
  )
}

export function RowActionMenuTrigger({
  variant = 'card',
  suppressHoverBackground = false,
  active = false,
  className,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  variant?: 'card' | 'sidebar'
  suppressHoverBackground?: boolean
  active?: boolean
}) {
  const { toggle } = useRowActionMenu()

  if (variant === 'sidebar') {
    return (
      <SidebarIconButton
        type="button"
        {...props}
        revealOnRowHover
        suppressHoverBackground={suppressHoverBackground}
        active={active}
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
