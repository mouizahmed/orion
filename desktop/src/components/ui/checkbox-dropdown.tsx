import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

import { DropdownIconSlot, DropdownItem, DropdownSurface } from '@/components/ui/dropdown-list'
import { cn } from '@/lib/utils'

export type CheckboxDropdownOption = {
  value: string
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  description?: string
}

type DropdownPosition = {
  left: number
  top: number
  width: number
  maxHeight: number
}

export function CheckboxDropdown({
  value,
  options,
  exclusiveValue,
  disabled = false,
  formatValue,
  onValueChange,
  ariaLabel,
}: {
  value: string[]
  options: CheckboxDropdownOption[]
  exclusiveValue?: string
  disabled?: boolean
  formatValue: (selected: CheckboxDropdownOption[]) => string
  onValueChange: (value: string[]) => void
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<DropdownPosition | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback(() => {
    const trigger = rootRef.current?.getBoundingClientRect()
    if (!trigger) return

    const viewportPadding = 8
    const sideOffset = 4
    const preferredHeight = Math.min(224, 8 + options.length * 34)
    const availableBelow = window.innerHeight - trigger.bottom - sideOffset - viewportPadding
    const availableAbove = trigger.top - sideOffset - viewportPadding
    const openAbove = availableBelow < preferredHeight && availableAbove > availableBelow
    const maxHeight = Math.max(80, Math.min(preferredHeight, openAbove ? availableAbove : availableBelow))

    setPosition({
      left: Math.max(viewportPadding, Math.min(trigger.left, window.innerWidth - trigger.width - viewportPadding)),
      top: openAbove
        ? Math.max(viewportPadding, trigger.top - sideOffset - maxHeight)
        : trigger.bottom + sideOffset,
      width: trigger.width,
      maxHeight,
    })
  }, [options.length])

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePress = (event: MouseEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  const selected = options.filter((option) => value.includes(option.value))

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-full border border-neutral-200 bg-white/70 px-3 py-1 text-xs text-neutral-900 outline-none transition-[border-color,box-shadow,background-color] hover:bg-neutral-100 focus-visible:border-neutral-300 focus-visible:ring-2 focus-visible:ring-neutral-900/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/12 dark:bg-white/5 dark:text-neutral-100 dark:hover:bg-white/8 dark:focus-visible:border-white/20 dark:focus-visible:ring-white/10"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected[0]?.icon ? <span className="shrink-0">{selected[0].icon}</span> : null}
          <span className="truncate">{formatValue(selected)}</span>
        </span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-neutral-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && position && typeof document !== 'undefined' ? createPortal(
        <DropdownSurface
          ref={menuRef}
          role="listbox"
          aria-multiselectable="true"
          className="sidebar-scrollbar fixed z-[60] overflow-y-auto"
          style={{
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight,
          }}
        >
          {options.map((option) => {
            const checked = value.includes(option.value)
            return (
              <DropdownItem
                key={option.value}
                role="option"
                aria-selected={checked}
                aria-disabled={option.disabled || undefined}
                disabled={option.disabled}
                layout={option.description ? 'multiline' : 'single'}
                onClick={() => {
                  if (option.value === exclusiveValue) {
                    onValueChange([option.value])
                    return
                  }
                  const withoutExclusive = value.filter((item) => item !== exclusiveValue)
                  onValueChange(checked
                    ? withoutExclusive.filter((item) => item !== option.value)
                    : [...withoutExclusive, option.value])
                }}
              >
                <DropdownIconSlot>{checked ? <Check className="size-3.5" /> : null}</DropdownIconSlot>
                {option.icon}
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate">{option.label}</span>
                  {option.description ? <span className="block truncate text-[10px] text-neutral-400 dark:text-neutral-500">{option.description}</span> : null}
                </span>
              </DropdownItem>
            )
          })}
        </DropdownSurface>,
        document.body,
      ) : null}
    </div>
  )
}
