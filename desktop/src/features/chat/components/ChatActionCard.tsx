import { Ban, Check, CircleAlert, Clock3, Eye, Loader2, RotateCcw, ShieldAlert, Sparkles, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChatNoteAction } from '@/features/chat/chat-ui-types'

type ChatActionCardProps = {
  action: ChatNoteAction
  onApply?: (action: ChatNoteAction) => void
  onCancel?: (action: ChatNoteAction) => void
  onRetry?: (action: ChatNoteAction) => void
  onViewChange?: (action: ChatNoteAction) => void
  onUndo?: (action: ChatNoteAction) => void
  className?: string
}

const statusPresentation: Record<ChatNoteAction['state'], { label: string; icon: typeof Check; tone: string }> = {
  proposed: { label: 'Proposed change', icon: Sparkles, tone: 'text-violet-700 dark:text-violet-200' },
  confirmation_required: { label: 'Confirmation required', icon: Clock3, tone: 'text-amber-700 dark:text-amber-200' },
  running: { label: 'Applying change', icon: Loader2, tone: 'text-violet-700 dark:text-violet-200' },
  complete: { label: 'Change applied', icon: Check, tone: 'text-emerald-700 dark:text-emerald-300' },
  failed: { label: 'Change failed', icon: CircleAlert, tone: 'text-red-700 dark:text-red-300' },
  stale: { label: 'Proposal is out of date', icon: Clock3, tone: 'text-amber-700 dark:text-amber-200' },
  permission_denied: { label: 'Change not permitted', icon: ShieldAlert, tone: 'text-neutral-600 dark:text-neutral-300' },
  undone: { label: 'Change undone', icon: RotateCcw, tone: 'text-neutral-600 dark:text-neutral-300' },
  undo_unavailable: { label: 'Undo unavailable', icon: Ban, tone: 'text-neutral-600 dark:text-neutral-300' },
}

export default function ChatActionCard({
  action,
  onApply,
  onCancel,
  onRetry,
  onViewChange,
  onUndo,
  className,
}: ChatActionCardProps) {
  const status = statusPresentation[action.state]
  const StatusIcon = status.icon
  const canApply = (action.state === 'proposed' || action.state === 'confirmation_required') && onApply
  const canCancel = (action.state === 'proposed' || action.state === 'confirmation_required') && onCancel
  const canRetry = (action.state === 'failed' || action.state === 'stale') && onRetry
  const canView = action.state === 'complete' && onViewChange
  const canUndo = action.state === 'complete' && onUndo

  return (
    <section
      aria-label={status.label}
      className={cn(
        'rounded-xl border border-neutral-200 bg-neutral-50/80 p-3 text-xs dark:border-white/10 dark:bg-white/[0.04]',
        className,
      )}
    >
      <div className={cn('flex items-center gap-1.5 font-medium', status.tone)}>
        <StatusIcon className={cn('h-3.5 w-3.5', action.state === 'running' && 'animate-spin motion-reduce:animate-none')} />
        <span>{status.label}</span>
      </div>
      <div className="mt-2 font-medium text-neutral-900 dark:text-neutral-100">{action.title}</div>
      <p className="mt-1 break-words leading-5 text-neutral-600 dark:text-neutral-400">{action.description}</p>
      {action.detail ? (
        <div className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-neutral-200 bg-white/70 p-2 font-mono text-[11px] leading-5 text-neutral-600 sidebar-scrollbar dark:border-white/10 dark:bg-black/20 dark:text-neutral-300">
          {action.detail}
        </div>
      ) : null}
      {canApply || canCancel || canRetry || canView || canUndo ? (
        <div className="mt-3 flex flex-wrap justify-end gap-1.5">
          {canCancel ? <Button size="sm" variant="ghost" onClick={() => onCancel(action)}><X />Cancel</Button> : null}
          {canRetry ? <Button size="sm" variant="secondary" onClick={() => onRetry(action)}><RotateCcw />Retry</Button> : null}
          {canView ? <Button size="sm" variant="secondary" onClick={() => onViewChange(action)}><Eye />View change</Button> : null}
          {canUndo ? <Button size="sm" variant="ghost" onClick={() => onUndo(action)}><RotateCcw />Undo</Button> : null}
          {canApply ? <Button size="sm" variant="brand" onClick={() => onApply(action)}><Check />Apply</Button> : null}
        </div>
      ) : null}
    </section>
  )
}
