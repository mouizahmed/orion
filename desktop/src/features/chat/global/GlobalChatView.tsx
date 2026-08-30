import { useMemo, useState } from 'react'

import { useAuth } from '@/features/auth/AuthContext'
import { globalConversationFixtures, type GlobalConversationFixture } from '@/features/chat/global/global-chat-fixtures'
import GlobalChatLanding from '@/features/chat/global/GlobalChatLanding'
import GlobalConversationView from '@/features/chat/global/GlobalConversationView'
import type { ChatConversationSummary } from '@/features/chat/chat-ui-types'

function firstName(name?: string, email?: string) {
  const normalizedName = name?.trim()
  if (normalizedName) return normalizedName.split(/\s+/)[0]

  const emailName = email?.split('@')[0]?.trim()
  return emailName || 'there'
}

export default function GlobalChatView() {
  const { user } = useAuth()
  const greetingName = useMemo(() => firstName(user?.name, user?.email), [user?.email, user?.name])
  const [activeConversation, setActiveConversation] = useState<(GlobalConversationFixture & { initialPrompt?: string }) | null>(null)
  const [historyExpanded, setHistoryExpanded] = useState(false)

  const openConversation = (summary: ChatConversationSummary) => {
    const conversation = globalConversationFixtures.find((candidate) => candidate.id === summary.id)
    if (conversation) setActiveConversation(conversation)
  }

  const startConversation = (prompt: string) => {
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) return
    setActiveConversation({
      id: `fixture-${Date.now()}`,
      title: normalizedPrompt.length > 54 ? `${normalizedPrompt.slice(0, 51)}...` : normalizedPrompt,
      updatedAt: new Date().toISOString(),
      updatedLabel: 'now',
      messages: [],
      initialPrompt: normalizedPrompt,
    })
  }

  const startNewChat = () => {
    setHistoryExpanded(false)
    setActiveConversation(null)
  }

  return (
    <div className="h-full min-h-0 overflow-hidden rounded-lg border border-neutral-300/70 bg-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_18px_46px_-34px_rgba(15,23,42,0.5)] backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/80 dark:shadow-none">
      {activeConversation ? (
        <GlobalConversationView
          key={activeConversation.id}
          conversationId={activeConversation.id}
          title={activeConversation.title}
          initialMessages={activeConversation.messages}
          initialPrompt={activeConversation.initialPrompt}
          conversations={globalConversationFixtures}
          onSelectConversation={openConversation}
          onNewChat={startNewChat}
        />
      ) : (
        <GlobalChatLanding
          firstName={greetingName}
          conversations={globalConversationFixtures}
          historyExpanded={historyExpanded}
          onHistoryExpandedChange={setHistoryExpanded}
          onStartConversation={startConversation}
          onSelectConversation={openConversation}
        />
      )}
    </div>
  )
}
