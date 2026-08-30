import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { DropdownItem, DropdownSeparator, DropdownSurface } from '@/components/ui/dropdown-list'

export type EditorCommand = 'cut' | 'copy' | 'paste' | 'selectAll'

type EditorContextMenuProps = {
  x: number
  y: number
  hasSelection: boolean
  onCommand: (command: EditorCommand) => void
  onClose: () => void
}

const menuItems: Array<{ command: EditorCommand; label: string; shortcut: string; needsSelection?: boolean }> = [
  { command: 'cut', label: 'Cut', shortcut: 'X', needsSelection: true },
  { command: 'copy', label: 'Copy', shortcut: 'C', needsSelection: true },
  { command: 'paste', label: 'Paste', shortcut: 'V' },
  { command: 'selectAll', label: 'Select all', shortcut: 'A' },
]

export default function EditorContextMenu({ x, y, hasSelection, onCommand, onClose }: EditorContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ x, y })
  const shortcutPrefix = window.env?.platform === 'darwin' ? '⌘' : 'Ctrl '

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const bounds = menu.getBoundingClientRect()
    const margin = 8
    setPosition({
      x: Math.max(margin, Math.min(x, window.innerWidth - bounds.width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - bounds.height - margin)),
    })
  }, [x, y])

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    const closeOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', closeOnPointerDown)
    window.addEventListener('keydown', closeOnKeyDown)
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown)
      window.removeEventListener('keydown', closeOnKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Editor actions"
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: position.x, top: position.y }}
      className="fixed z-[9999] w-44 min-w-44"
    >
      <DropdownSurface width="md" className="w-full min-w-0">
        {menuItems.map((item, index) => {
          const disabled = Boolean(item.needsSelection && !hasSelection)
          return (
            <div key={item.command}>
              {index === 3 ? <DropdownSeparator /> : null}
              <DropdownItem
                role="menuitem"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  onCommand(item.command)
                  onClose()
                }}
                className="justify-between"
              >
                <span>{item.label}</span>
                <span className="ml-6 text-[10px] text-neutral-400 dark:text-neutral-500">{shortcutPrefix}{item.shortcut}</span>
              </DropdownItem>
            </div>
          )
        })}
      </DropdownSurface>
    </div>,
    document.body,
  )
}
