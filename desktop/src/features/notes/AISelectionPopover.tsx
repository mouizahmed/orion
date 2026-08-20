import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Loader2, Sparkles, CheckCheck, ArrowDown, ArrowUp, Mic } from 'lucide-react'
import { transformText, type TransformAction } from '@/features/notes/api/ai-transform-client'

type Action = {
  id: TransformAction
  label: string
  icon: React.ReactNode
}

const ACTIONS: Action[] = [
  { id: 'improve', label: 'Improve', icon: <Sparkles className="h-3.5 w-3.5" /> },
  { id: 'fix_grammar', label: 'Grammar', icon: <CheckCheck className="h-3.5 w-3.5" /> },
  { id: 'make_shorter', label: 'Shorter', icon: <ArrowUp className="h-3.5 w-3.5" /> },
  { id: 'make_longer', label: 'Longer', icon: <ArrowDown className="h-3.5 w-3.5" /> },
  { id: 'change_tone', label: 'Tone', icon: <Mic className="h-3.5 w-3.5" /> },
]

type Props = {
  editorContainerRef: RefObject<HTMLElement | null>
  getMarkdown: () => string
  setMarkdown: (md: string) => void
  onChange: (md: string) => void
  noteId?: string
}

type PopoverState = {
  visible: boolean
  x: number
  y: number
  selectedText: string
  below: boolean
}

const HIDDEN: PopoverState = { visible: false, x: 0, y: 0, selectedText: '', below: false }

export default function AISelectionPopover({ editorContainerRef, getMarkdown, setMarkdown, onChange, noteId }: Props) {
  const [popover, setPopover] = useState<PopoverState>(HIDDEN)
  const [loading, setLoading] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  const hide = useCallback(() => setPopover(HIDDEN), [])

  const checkSelection = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      hide()
      return
    }

    const selectedText = selection.toString().trim()
    if (!selectedText) { hide(); return }

    const container = editorContainerRef.current
    if (!container) { hide(); return }

    // Ensure selection is inside the editor container
    const range = selection.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) {
      hide()
      return
    }

    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) { hide(); return }

    const POPOVER_HEIGHT = 40
    const MARGIN = 8
    const below = rect.top < POPOVER_HEIGHT + MARGIN
    const y = below
      ? rect.bottom + MARGIN
      : rect.top - POPOVER_HEIGHT - MARGIN

    setPopover({
      visible: true,
      x: rect.left + rect.width / 2,
      y,
      selectedText,
      below,
    })
  }, [editorContainerRef, hide])

  // Listen for selection changes
  useEffect(() => {
    const onMouseUp = () => setTimeout(checkSelection, 10)
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey) setTimeout(checkSelection, 10)
    }

    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('keyup', onKeyUp)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('keyup', onKeyUp)
    }
  }, [checkSelection])

  // Dismiss on Escape or click outside
  useEffect(() => {
    if (!popover.visible) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }

    const onMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        hide()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [popover.visible, hide])

  const handleAction = useCallback(async (action: TransformAction) => {
    if (!popover.selectedText || loading) return
    setLoading(true)
    try {
      const result = await transformText(action, popover.selectedText)
      const fullMarkdown = getMarkdown()
      const newMarkdown = fullMarkdown.replace(popover.selectedText, result)
      setMarkdown(newMarkdown)
      onChange(newMarkdown)
      hide()
    } catch (err) {
      console.error('AI transform failed:', err)
    } finally {
      setLoading(false)
    }
  }, [popover.selectedText, loading, getMarkdown, setMarkdown, onChange, hide])

  // Clamp after render so the popover never overflows the viewport edges
  useLayoutEffect(() => {
    if (!popoverRef.current || !popover.visible) return
    const el = popoverRef.current
    const MARGIN = 8
    const popoverWidth = el.offsetWidth
    const vw = window.innerWidth
    const desired = popover.x - popoverWidth / 2
    const clamped = Math.max(MARGIN, Math.min(desired, vw - popoverWidth - MARGIN))
    el.style.left = `${clamped}px`
    el.style.transform = 'none'
  }, [popover.x, popover.y, popover.visible])

  if (!popover.visible || !noteId) return null

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        left: popover.x,
        top: popover.y,
        transform: 'translateX(-50%)',
        zIndex: 9999,
      }}
      className="flex items-center gap-0.5 rounded-full border border-neutral-700 bg-neutral-900 px-1.5 py-1 shadow-lg"
      onMouseDown={(e) => e.preventDefault()}
    >
      {loading ? (
        <div className="flex items-center gap-2 px-2 py-0.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />
          <span className="text-xs text-neutral-400">Transforming…</span>
        </div>
      ) : (
        ACTIONS.map((action) => (
          <button
            key={action.id}
            onClick={() => void handleAction(action.id)}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white"
          >
            {action.icon}
            {action.label}
          </button>
        ))
      )}
    </div>
  )
}
