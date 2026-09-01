import type { ChatMessageData } from '@/features/chat/chat-ui-types'
import type { NoteChatConversation } from '@/features/chat/note/note-chat-fixtures'

export type NoteChatSession = {
  activeConversationId: string | null
  conversations: NoteChatConversation[]
  draft: string
  messages: ChatMessageData[]
}

type SessionListener = () => void

const sessionsByNoteId = new Map<string, NoteChatSession>()
const listenersByNoteId = new Map<string, Set<SessionListener>>()

function emitSessionChange(noteId: string): void {
  listenersByNoteId.get(noteId)?.forEach((listener) => listener())
}

export function getNoteChatSession(noteId: string): NoteChatSession | undefined {
  return sessionsByNoteId.get(noteId)
}

export function getOrCreateNoteChatSession(
  noteId: string,
  createSession: () => NoteChatSession,
): NoteChatSession {
  const existing = sessionsByNoteId.get(noteId)
  if (existing) return existing

  const session = createSession()
  sessionsByNoteId.set(noteId, session)
  return session
}

export function updateNoteChatSession(
  noteId: string,
  update: (session: NoteChatSession) => NoteChatSession,
): void {
  const current = sessionsByNoteId.get(noteId)
  if (!current) return

  const next = update(current)
  if (next === current) return

  sessionsByNoteId.set(noteId, next)
  emitSessionChange(noteId)
}

export function subscribeToNoteChatSession(noteId: string, listener: SessionListener): () => void {
  const listeners = listenersByNoteId.get(noteId) ?? new Set<SessionListener>()
  listeners.add(listener)
  listenersByNoteId.set(noteId, listeners)

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersByNoteId.delete(noteId)
  }
}

export function clearNoteChatSessions(): void {
  const noteIds = [...sessionsByNoteId.keys()]
  sessionsByNoteId.clear()
  noteIds.forEach(emitSessionChange)
}
