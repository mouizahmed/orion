import { useEffect, useMemo, useRef, useState } from 'react'
import { History, SquarePen, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DropdownItem, DropdownLabel, DropdownPopover } from '@/components/ui/dropdown-list'
import { groupConversationsByDate } from '@/features/chat/global/conversation-history'
import type { NoteChatConversation } from '@/features/chat/note/note-chat-fixtures'
import { cn } from '@/lib/utils'

type NoteChatHeaderProps = {
  activeConversationId: string | null
  conversations: NoteChatConversation[]
  onSelectConversation: (conversation: NoteChatConversation) => void
  onNewChat: () => void
  onClose?: () => void
}

export default function NoteChatHeader({
  activeConversationId,
  conversations,
  onSelectConversation,
  onNewChat,
  onClose,
}: NoteChatHeaderProps) {
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
    <header className="flex h-10 shrink-0 items-center gap-1 px-2">
      <div ref={historyRef} className="relative shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Note chat history"
          aria-haspopup="menu"
          aria-expanded={historyOpen}
          title="History"
          onClick={() => setHistoryOpen((open) => !open)}
          className="h-7 w-7"
        >
          <History className="h-3.5 w-3.5" />
        </Button>
        {historyOpen ? (
          <DropdownPopover
            align="start"
            width="lg"
            role="menu"
            aria-label="Note chat history"
            className="max-h-80 w-[336px] min-w-0 overflow-y-auto sidebar-scrollbar"
          >
            {groupedConversations.map((group) => (
              <div key={group.label}>
                <DropdownLabel>{group.label}</DropdownLabel>
                {group.conversations.map((summary) => {
                  const conversation = conversations.find((candidate) => candidate.id === summary.id)
                  if (!conversation) return null
                  return (
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
                  )
                })}
              </div>
            ))}
          </DropdownPopover>
        ) : null}
      </div>

      <div className="flex-1" />

      <Button type="button" variant="ghost" size="icon-sm" aria-label="New note chat" title="New chat" onClick={onNewChat} className="h-7 w-7 shrink-0">
        <SquarePen className="h-3.5 w-3.5" />
      </Button>
      {onClose ? (
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close note chat" title="Close chat" onClick={onClose} className="h-7 w-7 shrink-0">
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </header>
  )
}
