import { useCallback, useSyncExternalStore } from 'react'

import { createNoteChatHistoryFixtures } from '@/features/chat/note/note-chat-fixtures'
import {
  getNoteChatSession,
  getOrCreateNoteChatSession,
  subscribeToNoteChatSession,
  type NoteChatSession,
} from '@/features/chat/note/note-chat-session-store'

export function useNoteChatSession(noteId: string, noteTitle: string): NoteChatSession {
  getOrCreateNoteChatSession(noteId, () => ({
    activeConversationId: null,
    conversations: createNoteChatHistoryFixtures(noteId, noteTitle),
    draft: '',
    messages: [],
  }))

  const subscribe = useCallback(
    (listener: () => void) => subscribeToNoteChatSession(noteId, listener),
    [noteId],
  )
  const getSnapshot = useCallback(() => getNoteChatSession(noteId), [noteId])
  const session = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  if (!session) throw new Error(`Missing note chat session for ${noteId}`)
  return session
}
