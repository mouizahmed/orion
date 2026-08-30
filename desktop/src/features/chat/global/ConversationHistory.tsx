import { Button } from '@/components/ui/button'
import type { ChatConversationSummary } from '@/features/chat/chat-ui-types'
import { groupConversationsByDate, sortConversationsByRecent } from '@/features/chat/global/conversation-history'

type ConversationHistoryProps = {
  conversations: ChatConversationSummary[]
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  onSelectConversation?: (conversation: ChatConversationSummary) => void
}

function ConversationRow({
  conversation,
  onSelect,
}: {
  conversation: ChatConversationSummary
  onSelect?: (conversation: ChatConversationSummary) => void
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate text-left text-xs font-medium text-neutral-800 dark:text-neutral-200">
        {conversation.title}
      </span>
      <time dateTime={conversation.updatedAt} className="shrink-0 text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
        {conversation.updatedLabel}
      </time>
    </>
  )

  return onSelect ? (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onSelect(conversation)}
      className="flex h-auto w-full min-w-0 items-center justify-start gap-2.5 whitespace-normal rounded-xl px-3 py-2.5 outline-none hover:bg-neutral-200/50 focus-visible:ring-2 focus-visible:ring-neutral-900/10 dark:hover:bg-white/[0.05] dark:focus-visible:ring-white/20"
    >
      {content}
    </Button>
  ) : (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5">{content}</div>
  )
}

export default function ConversationHistory({
  conversations,
  expanded,
  onExpandedChange,
  onSelectConversation,
}: ConversationHistoryProps) {
  const recentConversations = sortConversationsByRecent(conversations).slice(0, 3)
  const groupedConversations = groupConversationsByDate(conversations)

  return (
    <section aria-labelledby="global-chat-history-title">
      <div className="mb-2 flex items-center justify-between gap-3 px-2">
        <h2 id="global-chat-history-title" className="text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {expanded ? 'All conversations' : 'Recents'}
        </h2>
        {conversations.length > 3 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onExpandedChange(!expanded)}
            className="rounded-md px-1.5 py-1 text-[11px] font-medium text-neutral-500 outline-none hover:bg-neutral-200/60 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/10 dark:text-neutral-400 dark:hover:bg-white/8 dark:hover:text-white dark:focus-visible:ring-white/20"
          >
            {expanded ? 'Show recent' : 'See all'}
          </Button>
        ) : null}
      </div>

      {conversations.length ? (
        expanded ? (
          <div className="space-y-4">
            {groupedConversations.map((group) => (
              <div key={group.label}>
                <h3 className="px-3 pb-1 text-[11px] font-medium text-neutral-400 dark:text-neutral-500">{group.label}</h3>
                <div className="space-y-1">
                  {group.conversations.map((conversation) => (
                    <ConversationRow key={conversation.id} conversation={conversation} onSelect={onSelectConversation} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {recentConversations.map((conversation) => (
              <ConversationRow key={conversation.id} conversation={conversation} onSelect={onSelectConversation} />
            ))}
          </div>
        )
      ) : (
        <div className="rounded-xl border border-dashed border-neutral-300 px-4 py-8 text-center text-xs text-neutral-500 dark:border-white/15 dark:text-neutral-400">
          No conversations yet. Ask Orion anything to begin.
        </div>
      )}
    </section>
  )
}
