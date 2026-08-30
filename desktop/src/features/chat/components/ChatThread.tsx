import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import ChatMessage from '@/features/chat/components/ChatMessage'
import type { ChatMessageData, ChatNoteAction, ChatSource } from '@/features/chat/chat-ui-types'
import { cn } from '@/lib/utils'

type ChatThreadProps = {
  messages: ChatMessageData[]
  loading?: boolean
  error?: string | null
  onRetryLoad?: () => void
  onRetryMessage?: (message: ChatMessageData) => void
  onOpenSource?: (source: ChatSource) => void
  onApplyAction?: (action: ChatNoteAction) => void
  onCancelAction?: (action: ChatNoteAction) => void
  onRetryAction?: (action: ChatNoteAction) => void
  onViewAction?: (action: ChatNoteAction) => void
  onUndoAction?: (action: ChatNoteAction) => void
  density?: 'page' | 'panel'
  className?: string
  contentClassName?: string
}

export default function ChatThread({
  messages,
  loading = false,
  error,
  onRetryLoad,
  onRetryMessage,
  onOpenSource,
  onApplyAction,
  onCancelAction,
  onRetryAction,
  onViewAction,
  onUndoAction,
  density = 'page',
  className,
  contentClassName,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = scrollRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [messages])

  return (
    <div ref={scrollRef} aria-busy={loading} className={cn('min-h-0 flex-1 overflow-y-auto sidebar-scrollbar', className)}>
      <div className={cn('mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6', density === 'panel' && 'px-3 py-4 sm:px-3', contentClassName)}>
        {loading ? (
          <div aria-label="Loading conversation" className="space-y-5">
            <div className="ml-auto h-10 w-44 animate-pulse rounded-2xl bg-neutral-200 motion-reduce:animate-none dark:bg-white/10" />
            <div className="space-y-2">
              <div className="h-3 w-4/5 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none dark:bg-white/10" />
              <div className="h-3 w-3/5 animate-pulse rounded bg-neutral-200 motion-reduce:animate-none dark:bg-white/10" />
            </div>
          </div>
        ) : error ? (
          <div role="alert" className="mx-auto flex min-h-48 max-w-sm flex-col items-center justify-center text-center">
            <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Could not load this conversation</p>
            <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">{error}</p>
            {onRetryLoad ? <Button className="mt-3" variant="secondary" size="sm" onClick={onRetryLoad}>Retry</Button> : null}
          </div>
        ) : messages.length ? (
          <div className={cn(density === 'page' ? 'space-y-7' : 'space-y-6')}>
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                density={density}
                onRetry={onRetryMessage}
                onOpenSource={onOpenSource}
                onApplyAction={onApplyAction}
                onCancelAction={onCancelAction}
                onRetryAction={onRetryAction}
                onViewAction={onViewAction}
                onUndoAction={onUndoAction}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-48 items-center justify-center text-center text-xs text-neutral-500 dark:text-neutral-400">
            Ask Orion anything to begin this conversation.
          </div>
        )}
      </div>
    </div>
  )
}
