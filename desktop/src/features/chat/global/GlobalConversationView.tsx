import { useCallback, useEffect, useRef, useState } from 'react'

import ChatComposer from '@/features/chat/components/ChatComposer'
import ChatThread from '@/features/chat/components/ChatThread'
import GlobalConversationHeader from '@/features/chat/global/GlobalConversationHeader'
import type { ChatMessageData } from '@/features/chat/chat-ui-types'
import type { ChatConversationSummary } from '@/features/chat/chat-ui-types'

type GlobalConversationViewProps = {
  conversationId: string
  title: string
  initialMessages: ChatMessageData[]
  initialPrompt?: string
  conversations: ChatConversationSummary[]
  onSelectConversation: (conversation: ChatConversationSummary) => void
  onNewChat: () => void
}

const fixtureResponse = 'I found related notes and meetings in your Orion workspace. This fixture response demonstrates the active conversation layout; grounded AI results will be connected in the backend phase.'

export default function GlobalConversationView({
  conversationId,
  title,
  initialMessages,
  initialPrompt,
  conversations,
  onSelectConversation,
  onNewChat,
}: GlobalConversationViewProps) {
  const initialRequestIdRef = useRef(`initial-${Date.now()}`)
  const initialAssistantMessageId = initialPrompt ? `fixture-assistant-${initialRequestIdRef.current}` : null
  const [messages, setMessages] = useState<ChatMessageData[]>(() => initialPrompt ? [
    ...initialMessages,
    { id: `fixture-user-${initialRequestIdRef.current}`, role: 'user', state: 'complete', content: initialPrompt },
    {
      id: initialAssistantMessageId!,
      role: 'assistant',
      state: 'streaming',
      content: '',
      activities: [{ id: `${initialAssistantMessageId}-thinking`, kind: 'thinking', state: 'running', label: 'Thinking' }],
    },
  ] : initialMessages)
  const [draft, setDraft] = useState('')
  const responseTimerRef = useRef<number | null>(null)

  const clearResponseTimer = useCallback(() => {
    if (responseTimerRef.current != null) {
      window.clearTimeout(responseTimerRef.current)
      responseTimerRef.current = null
    }
  }, [])

  const completeFixtureResponse = useCallback((messageId: string) => {
    clearResponseTimer()
    responseTimerRef.current = window.setTimeout(() => {
      setMessages((current) => current.map((message) => message.id === messageId
        ? {
            ...message,
            state: 'complete',
            content: fixtureResponse,
            activities: [{ id: `${messageId}-search`, kind: 'workspace_search', state: 'complete', label: 'Searched Orion workspace' }],
          }
        : message))
      responseTimerRef.current = null
    }, 900)
  }, [clearResponseTimer])

  const submitPrompt = useCallback((prompt: string) => {
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) return

    const requestId = `${Date.now()}`
    const assistantMessageId = `fixture-assistant-${requestId}`
    setMessages((current) => [
      ...current,
      { id: `fixture-user-${requestId}`, role: 'user', state: 'complete', content: normalizedPrompt },
      {
        id: assistantMessageId,
        role: 'assistant',
        state: 'streaming',
        content: '',
        activities: [{ id: `${assistantMessageId}-thinking`, kind: 'thinking', state: 'running', label: 'Thinking' }],
      },
    ])
    setDraft('')
    completeFixtureResponse(assistantMessageId)
  }, [completeFixtureResponse])

  useEffect(() => {
    if (initialAssistantMessageId) completeFixtureResponse(initialAssistantMessageId)
  }, [completeFixtureResponse, initialAssistantMessageId])

  useEffect(() => () => clearResponseTimer(), [clearResponseTimer])

  const stopResponse = () => {
    clearResponseTimer()
    setMessages((current) => current.map((message) => message.state === 'streaming'
      ? { ...message, state: 'failed', error: 'Response stopped. Your message was preserved.', activities: undefined }
      : message))
  }

  const retryMessage = (failedMessage: ChatMessageData) => {
    setMessages((current) => current.map((message) => message.id === failedMessage.id
      ? {
          ...message,
          state: 'streaming',
          content: '',
          error: undefined,
          activities: [{ id: `${message.id}-thinking`, kind: 'thinking', state: 'running', label: 'Thinking' }],
        }
      : message))
    completeFixtureResponse(failedMessage.id)
  }

  const submitting = messages.some((message) => message.state === 'streaming')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <GlobalConversationHeader
        title={title}
        activeConversationId={conversationId}
        conversations={conversations}
        onSelectConversation={onSelectConversation}
        onNewChat={onNewChat}
      />
      <ChatThread messages={messages} onRetryMessage={retryMessage} />
      <footer className="shrink-0 border-t border-neutral-200/70 bg-white/70 px-4 pb-3 pt-2 backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/70 sm:px-6">
        <div className="mx-auto w-full max-w-[720px]">
          <ChatComposer
            value={draft}
            onValueChange={setDraft}
            onSubmit={() => submitPrompt(draft)}
            variant="page"
            placeholder="Ask anything..."
            submitting={submitting}
            onStop={stopResponse}
            onAttach={() => undefined}
            limits={{ maxPromptLength: 20_000, maxAttachments: 10, maxAttachmentSizeBytes: 25_000_000 }}
          />
          <p className="mt-1.5 text-center text-[10px] text-neutral-400 dark:text-neutral-500">Orion can make mistakes. Check important information.</p>
        </div>
      </footer>
    </div>
  )
}
