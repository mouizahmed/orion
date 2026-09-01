import { useCallback, useEffect, useRef, useState } from 'react'

import type { ChatMessageData, ChatNoteAction } from '@/features/chat/chat-ui-types'
import ChatComposer from '@/features/chat/components/ChatComposer'
import ChatThread from '@/features/chat/components/ChatThread'
import NoteChatHeader from '@/features/chat/note/NoteChatHeader'
import {
  createNoteChatHistoryFixtures,
  createNoteFixtureResponse,
  type NoteChatConversation,
} from '@/features/chat/note/note-chat-fixtures'

type NoteChatPanelProps = {
  noteId: string
  noteTitle: string
  onClose?: () => void
  onConversationStateChange?: (hasMessages: boolean) => void
  autoFocus?: boolean
  draft?: string
  onDraftChange?: (value: string) => void
}

const fixtureDelayMs = 700

export default function NoteChatPanel({
  noteId,
  noteTitle,
  onClose,
  onConversationStateChange,
  autoFocus = false,
  draft: controlledDraft,
  onDraftChange,
}: NoteChatPanelProps) {
  const [conversations, setConversations] = useState<NoteChatConversation[]>(() => createNoteChatHistoryFixtures(noteId, noteTitle))
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessageData[]>([])
  const [localDraft, setLocalDraft] = useState('')
  const draft = controlledDraft ?? localDraft
  const setDraft = onDraftChange ?? setLocalDraft
  const messagesRef = useRef<ChatMessageData[]>([])
  const responseTimerRef = useRef<number | null>(null)
  const actionTimersRef = useRef<number[]>([])

  const clearTimers = useCallback(() => {
    if (responseTimerRef.current != null) window.clearTimeout(responseTimerRef.current)
    responseTimerRef.current = null
    actionTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    actionTimersRef.current = []
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  useEffect(() => {
    onConversationStateChange?.(messages.length > 0)
  }, [messages.length, onConversationStateChange])

  const syncConversation = useCallback((conversationId: string, nextMessages: ChatMessageData[], title?: string) => {
    setConversations((current) => {
      const existing = current.find((conversation) => conversation.id === conversationId)
      const updatedAt = new Date().toISOString()
      if (existing) {
        return current.map((conversation) => conversation.id === conversationId
          ? { ...conversation, title: title || conversation.title, updatedAt, updatedLabel: 'now', messages: nextMessages }
          : conversation)
      }
      return [{ id: conversationId, title: title || 'New conversation', updatedAt, updatedLabel: 'now', messages: nextMessages }, ...current]
    })
  }, [])

  const commitMessages = useCallback((nextMessages: ChatMessageData[], conversationId: string, title?: string) => {
    messagesRef.current = nextMessages
    setMessages(nextMessages)
    syncConversation(conversationId, nextMessages, title)
  }, [syncConversation])

  const replaceAction = useCallback((actionId: string, update: (action: ChatNoteAction) => ChatNoteAction) => {
    if (!activeConversationId) return
    const nextMessages = messagesRef.current.map((message) => ({
      ...message,
      actions: message.actions?.map((action) => action.id === actionId ? update(action) : action),
    }))
    commitMessages(nextMessages, activeConversationId)
  }, [activeConversationId, commitMessages])

  const completeResponse = useCallback((messageId: string, prompt: string, conversationId: string) => {
    responseTimerRef.current = window.setTimeout(() => {
      const nextMessages = messagesRef.current.map((message) => message.id === messageId
        ? createNoteFixtureResponse(messageId, prompt, noteId, noteTitle)
        : message)
      commitMessages(nextMessages, conversationId)
      responseTimerRef.current = null
    }, fixtureDelayMs)
  }, [commitMessages, noteId, noteTitle])

  const submitPrompt = useCallback((rawPrompt: string) => {
    const prompt = rawPrompt.trim()
    if (!prompt) return
    const requestId = `${Date.now()}`
    const conversationId = activeConversationId || `note-${noteId}-${requestId}`
    const assistantMessageId = `note-fixture-assistant-${requestId}`
    const nextMessages: ChatMessageData[] = [
      ...messagesRef.current,
      { id: `note-fixture-user-${requestId}`, role: 'user', state: 'complete', content: prompt },
      {
        id: assistantMessageId,
        role: 'assistant',
        state: 'streaming',
        content: '',
        activities: [{ id: `${assistantMessageId}-thinking`, kind: 'thinking', state: 'running', label: 'Thinking' }],
      },
    ]
    if (!activeConversationId) setActiveConversationId(conversationId)
    const title = activeConversationId ? undefined : prompt.length > 36 ? `${prompt.slice(0, 36)}…` : prompt
    commitMessages(nextMessages, conversationId, title)
    setDraft('')
    completeResponse(assistantMessageId, prompt, conversationId)
  }, [activeConversationId, commitMessages, completeResponse, noteId, setDraft])

  const stopResponse = () => {
    if (responseTimerRef.current != null) window.clearTimeout(responseTimerRef.current)
    responseTimerRef.current = null
    if (!activeConversationId) return
    const nextMessages = messagesRef.current.map((message) => message.state === 'streaming'
      ? { ...message, state: 'failed', activities: undefined, error: 'Response stopped. Your message was preserved.' }
      : message) as ChatMessageData[]
    commitMessages(nextMessages, activeConversationId)
  }

  const retryMessage = (message: ChatMessageData) => {
    if (!activeConversationId) return
    const previousUserMessage = [...messagesRef.current]
      .slice(0, messagesRef.current.findIndex((candidate) => candidate.id === message.id))
      .reverse()
      .find((candidate) => candidate.role === 'user')
    const prompt = previousUserMessage?.content || 'Review this note'
    const nextMessages = messagesRef.current.map((candidate) => candidate.id === message.id
      ? { ...candidate, state: 'streaming', content: '', error: undefined, activities: [{ id: `${message.id}-thinking`, kind: 'thinking', state: 'running', label: 'Thinking' }] }
      : candidate) as ChatMessageData[]
    commitMessages(nextMessages, activeConversationId)
    completeResponse(message.id, prompt, activeConversationId)
  }

  const runAction = (action: ChatNoteAction) => {
    replaceAction(action.id, (current) => ({ ...current, state: 'running' }))
    const timer = window.setTimeout(() => {
      replaceAction(action.id, (current) => ({
        ...current,
        state: 'complete',
        description: current.kind === 'summary'
          ? 'The summary was updated with the proposed decisions and next steps.'
          : current.kind === 'event_link'
            ? 'Linked the calendar event to this note.'
            : 'The proposed change was applied to this note.',
      }))
    }, fixtureDelayMs)
    actionTimersRef.current.push(timer)
  }

  const cancelAction = (action: ChatNoteAction) => {
    replaceAction(action.id, (current) => ({ ...current, state: 'undone', description: 'The proposed change was cancelled.' }))
  }

  const undoAction = (action: ChatNoteAction) => {
    replaceAction(action.id, (current) => ({ ...current, state: 'undone', description: 'The fixture change was undone.' }))
  }

  const submitting = messages.some((message) => message.state === 'streaming')
  const selectConversation = (conversation: NoteChatConversation) => {
    clearTimers()
    setActiveConversationId(conversation.id)
    messagesRef.current = conversation.messages
    setMessages(conversation.messages)
    setDraft('')
  }

  const startNewChat = () => {
    clearTimers()
    setActiveConversationId(null)
    messagesRef.current = []
    setMessages([])
    setDraft('')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <NoteChatHeader
        activeConversationId={activeConversationId}
        conversations={conversations}
        onSelectConversation={selectConversation}
        onNewChat={startNewChat}
        onClose={onClose}
      />
      {messages.length ? (
        <ChatThread
          messages={messages}
          density="panel"
          onRetryMessage={retryMessage}
          onApplyAction={runAction}
          onCancelAction={cancelAction}
          onRetryAction={runAction}
          onUndoAction={undoAction}
          className="px-0"
          contentClassName="px-3 py-4"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 text-center">
          <p className="text-sm font-medium text-neutral-800 dark:text-neutral-200">Ask about this note</p>
          <p className="mt-1 max-w-64 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
            Ask a question or prepare a change for the note currently open.
          </p>
        </div>
      )}

      <div className="shrink-0 p-0.5">
        <ChatComposer
          value={draft}
          onValueChange={setDraft}
          onSubmit={() => submitPrompt(draft)}
          onStop={stopResponse}
          submitting={submitting}
          variant="dock"
          placeholder="Ask about this note..."
          onAttach={() => undefined}
          limits={{ maxPromptLength: 10_000 }}
          autoFocus={autoFocus}
        />
      </div>
    </div>
  )
}
