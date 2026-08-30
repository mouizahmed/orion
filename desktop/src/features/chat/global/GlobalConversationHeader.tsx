import { useEffect, useMemo, useRef, useState } from 'react'
import { History, SquarePen } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DropdownItem, DropdownLabel, DropdownPopover } from '@/components/ui/dropdown-list'
import type { ChatConversationSummary } from '@/features/chat/chat-ui-types'
import { groupConversationsByDate } from '@/features/chat/global/conversation-history'
import { cn } from '@/lib/utils'

type GlobalConversationHeaderProps = {
  title: string
  activeConversationId: string
  conversations: ChatConversationSummary[]
  onSelectConversation: (conversation: ChatConversationSummary) => void
  onNewChat: () => void
}

export default function GlobalConversationHeader({
  title,
  activeConversationId,
  conversations,
  onSelectConversation,
  onNewChat,
}: GlobalConversationHeaderProps) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyRef = useRef<HTMLDivElement | null>(null)
  const groupedConversations = useMemo(() => groupConversationsByDate(conversations), [conversations])

  useEffect(() => {
    if (!historyOpen) return
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!historyRef.current?.contains(event.target as Node)) setHistoryOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [historyOpen])

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-200 px-3 dark:border-white/10">
      <div ref={historyRef} className="relative">
        <Button type="button" variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}>
          <History className="h-3.5 w-3.5" />
          History
        </Button>
        {historyOpen ? (
          <DropdownPopover align="start" width="lg" role="menu" aria-label="Conversation history" className="max-h-[min(420px,calc(100vh-7rem))] w-80 overflow-y-auto sidebar-scrollbar">
            {groupedConversations.map((group) => (
              <div key={group.label}>
                <DropdownLabel>{group.label}</DropdownLabel>
                {group.conversations.map((conversation) => (
                  <DropdownItem
                    key={conversation.id}
                    role="menuitem"
                    className={cn('justify-start rounded-lg px-2.5', conversation.id === activeConversationId && 'bg-neutral-100 text-neutral-950 dark:bg-white/10 dark:text-white')}
                    onClick={() => {
                      setHistoryOpen(false)
                      onSelectConversation(conversation)
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate text-left">{conversation.title}</span>
                    <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">{conversation.updatedLabel}</span>
                  </DropdownItem>
                ))}
              </div>
            ))}
          </DropdownPopover>
        ) : null}
      </div>
      <div className="min-w-0 flex-1 text-center">
        <h1 className="truncate !text-sm !leading-5 font-medium text-neutral-700 dark:text-neutral-200">{title}</h1>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={onNewChat}>
        <SquarePen className="h-3.5 w-3.5" />
        New chat
      </Button>
    </header>
  )
}
