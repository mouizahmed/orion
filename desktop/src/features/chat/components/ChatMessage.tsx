import { Check, Copy, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import ChatActionCard from '@/features/chat/components/ChatActionCard'
import ChatActivityRow from '@/features/chat/components/ChatActivityRow'
import ChatResponse from '@/features/chat/components/ChatResponse'
import ChatSourceChip from '@/features/chat/components/ChatSourceChip'
import type { ChatMessageData, ChatNoteAction, ChatSource } from '@/features/chat/chat-ui-types'
import { cn } from '@/lib/utils'

type ChatMessageProps = {
  message: ChatMessageData
  density?: 'page' | 'panel'
  onRetry?: (message: ChatMessageData) => void
  onOpenSource?: (source: ChatSource) => void
  onApplyAction?: (action: ChatNoteAction) => void
  onCancelAction?: (action: ChatNoteAction) => void
  onRetryAction?: (action: ChatNoteAction) => void
  onViewAction?: (action: ChatNoteAction) => void
  onUndoAction?: (action: ChatNoteAction) => void
  className?: string
}

export function dedupeChatSources(sources: ChatSource[]) {
  const deduped = new Map<string, ChatSource>()

  for (const source of sources) {
    const current = deduped.get(source.id)
    if (!current) {
      deduped.set(source.id, {
        ...source,
        citationIndices: source.citationIndices ?? (source.citationIndex ? [source.citationIndex] : undefined),
      })
      continue
    }

    const indices = new Set([
      ...(current.citationIndices ?? (current.citationIndex ? [current.citationIndex] : [])),
      ...(source.citationIndices ?? (source.citationIndex ? [source.citationIndex] : [])),
    ])
    deduped.set(source.id, { ...current, citationIndices: indices.size ? [...indices].sort((a, b) => a - b) : undefined })
  }

  return [...deduped.values()]
}

export default function ChatMessage({
  message,
  density = 'page',
  onRetry,
  onOpenSource,
  onApplyAction,
  onCancelAction,
  onRetryAction,
  onViewAction,
  onUndoAction,
  className,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false)
  const sources = useMemo(() => dedupeChatSources(message.sources ?? []), [message.sources])
  const isUser = message.role === 'user'

  const copyMessage = async () => {
    if (!message.content) return
    await navigator.clipboard?.writeText(message.content)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const openCitation = (citationIndex: number) => {
    const source = sources.find((candidate) =>
      candidate.citationIndex === citationIndex || candidate.citationIndices?.includes(citationIndex),
    )
    if (source) onOpenSource?.(source)
  }

  const copyControl = message.state === 'complete' && message.content ? (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? 'Copied message' : 'Copy message'}
      onClick={() => void copyMessage()}
      className="h-6 w-6 shrink-0 rounded-full text-neutral-400 opacity-0 outline-none transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 focus:opacity-100 focus-visible:ring-2 focus-visible:ring-neutral-900/10 dark:focus-visible:ring-white/20"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  ) : null

  return (
    <article
      aria-label={`${isUser ? 'You' : 'Orion'} message`}
      className={cn('group/message relative flex min-w-0 flex-col', isUser ? 'items-end' : 'items-stretch', className)}
    >
      <div className={cn('flex w-full min-w-0 items-start gap-1', isUser ? 'justify-end' : 'justify-start')}>
        <div
          className={cn(
            'min-w-0',
            isUser && 'max-w-[86%] rounded-2xl bg-neutral-200/80 px-3.5 py-2.5 text-sm leading-6 text-neutral-900 dark:bg-white/10 dark:text-neutral-100',
            !isUser && 'flex-1',
            !isUser && density === 'page' && 'max-w-full',
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <ChatResponse content={message.content} onCitationClick={onOpenSource ? openCitation : undefined} />
          )}
        </div>
      </div>

      {!isUser && message.activities?.length ? (
        <div className="mt-2 space-y-0.5">
          {message.activities.map((activity) => <ChatActivityRow key={activity.id} activity={activity} />)}
        </div>
      ) : null}

      {!isUser && sources.length ? (
        <div aria-label="Sources" className="mt-2 flex min-w-0 flex-wrap gap-1.5">
          {sources.map((source) => (
            <ChatSourceChip key={source.id} source={source} onOpen={onOpenSource} />
          ))}
        </div>
      ) : null}

      {!isUser && message.actions?.length ? (
        <div className="mt-2 space-y-2">
          {message.actions.map((action) => (
            <ChatActionCard
              key={action.id}
              action={action}
              onApply={onApplyAction}
              onCancel={onCancelAction}
              onRetry={onRetryAction}
              onViewChange={onViewAction}
              onUndo={onUndoAction}
            />
          ))}
        </div>
      ) : null}

      {message.state === 'failed' ? (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
          <span className="min-w-0 flex-1">{message.error || 'This response could not be completed.'}</span>
          {onRetry ? <Button size="sm" variant="ghost" onClick={() => onRetry(message)}><RotateCcw />Retry</Button> : null}
        </div>
      ) : null}

      {copyControl ? (
        <div className={cn('absolute top-full mt-0.5', isUser ? 'right-0' : 'left-0')}>
          {copyControl}
        </div>
      ) : null}

    </article>
  )
}
