import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearNoteChatSessions,
  getNoteChatSession,
  getOrCreateNoteChatSession,
  subscribeToNoteChatSession,
  updateNoteChatSession,
} from '@/features/chat/note/note-chat-session-store'

afterEach(clearNoteChatSessions)

describe('note chat session store', () => {
  it('keeps sessions isolated by note', () => {
    const firstSession = {
      activeConversationId: 'conversation-1',
      conversations: [],
      draft: 'first draft',
      messages: [],
    }
    const secondSession = {
      activeConversationId: 'conversation-2',
      conversations: [],
      draft: 'second draft',
      messages: [],
    }

    getOrCreateNoteChatSession('note-1', () => firstSession)
    getOrCreateNoteChatSession('note-2', () => secondSession)

    expect(getNoteChatSession('note-1')).toBe(firstSession)
    expect(getNoteChatSession('note-2')).toBe(secondSession)
  })

  it('notifies subscribers when a session changes', () => {
    getOrCreateNoteChatSession('note-1', () => ({
      activeConversationId: null,
      conversations: [],
      draft: '',
      messages: [],
    }))
    const listener = vi.fn()
    const unsubscribe = subscribeToNoteChatSession('note-1', listener)

    updateNoteChatSession('note-1', (session) => ({ ...session, draft: 'Remember this' }))

    expect(listener).toHaveBeenCalledOnce()
    expect(getNoteChatSession('note-1')?.draft).toBe('Remember this')
    unsubscribe()
  })
})
