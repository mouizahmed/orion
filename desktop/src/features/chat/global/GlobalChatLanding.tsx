import { useState } from 'react'

import ChatComposer from '@/features/chat/components/ChatComposer'
import ConversationHistory from '@/features/chat/global/ConversationHistory'
import type { ChatConversationSummary } from '@/features/chat/chat-ui-types'

type GlobalChatLandingProps = {
  firstName: string
  conversations: ChatConversationSummary[]
  historyExpanded: boolean
  onHistoryExpandedChange: (expanded: boolean) => void
  onStartConversation: (prompt: string) => void
  onSelectConversation: (conversation: ChatConversationSummary) => void
}

export default function GlobalChatLanding({
  firstName,
  conversations,
  historyExpanded,
  onHistoryExpandedChange,
  onStartConversation,
  onSelectConversation,
}: GlobalChatLandingProps) {
  const [draft, setDraft] = useState('')

  return (
    <div className="h-full min-h-0 overflow-y-auto sidebar-scrollbar">
      <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col px-4 pb-10 pt-[clamp(3.5rem,12vh,7.5rem)] sm:px-6">
        <header className="px-2">
          <h1 className="!text-xl !leading-7 font-medium tracking-[-0.015em] text-neutral-900 dark:text-neutral-100">
            Hi {firstName}, ask anything
          </h1>
        </header>

        <div className="mt-6">
          <ChatComposer
            value={draft}
            onValueChange={setDraft}
            onSubmit={() => onStartConversation(draft)}
            variant="page"
            placeholder="Ask about your notes, meetings, people, or events..."
            onAttach={() => undefined}
            limits={{ maxPromptLength: 20_000, maxAttachments: 10, maxAttachmentSizeBytes: 25_000_000 }}
          />
        </div>

        <div className="mt-8">
          <ConversationHistory
            conversations={conversations}
            expanded={historyExpanded}
            onExpandedChange={onHistoryExpandedChange}
            onSelectConversation={onSelectConversation}
          />
        </div>
      </div>
    </div>
  )
}
