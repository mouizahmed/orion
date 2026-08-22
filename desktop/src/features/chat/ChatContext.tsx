import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  sendMessage as apiSendMessage,
  type ChatMessage,
  type Conversation,
} from '@/features/chat/chat-client'
import { useAuth } from '@/features/auth/AuthContext'
import { useQueryClient } from '@tanstack/react-query'
import {
  useConversationsQuery,
  useCreateConversationMutation,
  useDeleteConversationMutation,
  useMessagesQuery,
  useRenameConversationMutation,
  type ConversationScope,
} from '@/features/chat/useChatQueries'
import { queryKeys } from '@/lib/query-keys'
import { patchNoteEverywhere } from '@/features/notes/queries/note-cache-transforms'
import { isActiveServerStateAccount } from '@/lib/query-client'

type ToolUsage = {
  tool_name: string
  result?: string
}

type ChatContextType = {
  isOpen: boolean
  toggleOpen: () => void
  conversations: Conversation[]
  activeConversationId: string | null
  selectConversation: (id: string | null) => void
  createConversation: () => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>
  messages: ChatMessage[]
  isStreaming: boolean
  streamingText: string
  thinkingText: string
  lastError: string | null
  completedThinking: Record<string, string>
  thinkingDuration: Record<string, number>
  toolUsage: Record<string, ToolUsage[]>
  currentTools: ToolUsage[]
  sendMessage: (content: string, noteId?: string | null, folderId?: string | null) => Promise<void>
  stopStreaming: () => void
  loadConversations: (noteId?: string | null, folderId?: string | null) => Promise<void>
}

const ChatContext = createContext<ChatContextType | null>(null)
export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const accountID = user?.id ?? ''
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  const [scope, setScope] = useState<ConversationScope>({ noteID: null, folderID: null })
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [thinkingText, setThinkingText] = useState('')
  const [lastError, setLastError] = useState<string | null>(null)
  const [currentTools, setCurrentTools] = useState<ToolUsage[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const conversationsQuery = useConversationsQuery(user?.id, scope)
  const messagesQuery = useMessagesQuery(user?.id, activeConversationId)
  const conversations = useMemo(() => conversationsQuery.data ?? [], [conversationsQuery.data])
  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data])
  const createConversationMutation = useCreateConversationMutation(accountID, scope)
  const deleteConversationMutation = useDeleteConversationMutation(accountID)
  const renameConversationMutation = useRenameConversationMutation(accountID)
  const completedThinking = useMemo(() => Object.fromEntries(
    messages.filter((message) => message.role === 'assistant' && message.thinking)
      .map((message) => [message.id, message.thinking as string]),
  ), [messages])
  const thinkingDuration = useMemo(() => Object.fromEntries(
    messages.filter((message) => message.role === 'assistant' && message.thinkingDuration)
      .map((message) => [message.id, message.thinkingDuration as number]),
  ), [messages])
  const toolUsage = useMemo(() => Object.fromEntries(
    messages.filter((message) => message.role === 'assistant' && message.toolCalls?.length)
      .map((message) => [message.id, message.toolCalls as ToolUsage[]]),
  ), [messages])
  const toggleOpen = useCallback(() => setIsOpen((v) => !v), [])

  const loadConversations = useCallback(async (noteId?: string | null, folderId?: string | null) => {
    setScope({ noteID: noteId ?? null, folderID: folderId ?? null })
  }, [])

  useEffect(() => {
    setActiveConversationId((current) => current && conversations.some((item) => item.id === current)
      ? current
      : conversations[0]?.id ?? null)
  }, [conversations])

  const selectConversation = useCallback((id: string | null) => {
    setActiveConversationId(id)
    setStreamingText('')
    setThinkingText('')
    setLastError(null)
    setCurrentTools([])
  }, [])

  const createConversation = useCallback(async () => {
    const conv = await createConversationMutation.mutateAsync(undefined)
    setActiveConversationId(conv.id)
  }, [createConversationMutation])

  const deleteConversation = useCallback(
    async (id: string) => {
      await deleteConversationMutation.mutateAsync(id)
      if (activeConversationId === id) {
        setActiveConversationId(null)
      }
    },
    [activeConversationId, deleteConversationMutation],
  )

  const renameConversation = useCallback(async (id: string, title: string) => {
    await renameConversationMutation.mutateAsync({ conversationID: id, title })
  }, [renameConversationMutation])

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const sendMessage = useCallback(
    async (content: string, noteId?: string | null, folderId?: string | null) => {
      if (isStreaming) return

      // Create conversation if needed
      let convId = activeConversationId
      let wasCreated = false
      if (!convId) {
        const conv = await createConversationMutation.mutateAsync({ noteID: noteId, folderID: folderId })
        setActiveConversationId(conv.id)
        convId = conv.id
        wasCreated = true
      }
      const conversationID = convId
      const messageKey = queryKeys.messages(accountID, conversationID)
      const setCachedMessages = (updater: (current: ChatMessage[]) => ChatMessage[]) => {
        if (!isActiveServerStateAccount(accountID)) return
        queryClient.setQueryData<ChatMessage[]>(messageKey, (current = []) => updater(current))
      }

      const abortController = new AbortController()
      abortRef.current = abortController

      setIsStreaming(true)
      setStreamingText('')
      setThinkingText('')
      setLastError(null)
      setCurrentTools([])

      // Optimistically add user message
      const tempUserMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        conversationId: conversationID,
        role: 'user',
        content,
        tokenCount: 0,
        createdAt: Date.now(),
      }
      setCachedMessages((current) => [...current, tempUserMsg])

      let fullText = ''
      let fullThinking = ''
      let thinkingStartTime: number | null = null
      // Track tools locally to avoid stale closure over React state
      let localTools: ToolUsage[] = []

      try {

        for await (const event of apiSendMessage(conversationID, content, abortController.signal)) {
          switch (event.type) {
            case 'text_delta':
              fullText += event.text
              setStreamingText(fullText)
              break
            case 'thinking':
              if (!thinkingStartTime) {
                thinkingStartTime = Date.now()
              }
              fullThinking += event.text
              setThinkingText(fullThinking)
              break
            case 'tool_use':
              localTools = [...localTools, { tool_name: event.tool_name }]
              setCurrentTools(localTools)
              break
            case 'tool_result':
              localTools = localTools.map(t =>
                t.tool_name === event.tool_name && !t.result
                  ? { ...t, result: event.result }
                  : t
              )
              setCurrentTools(localTools)
              break
            case 'done': {
              // Clear streaming display — the real message is now saved
              setStreamingText('')
              setIsStreaming(false)

              // Replace temp user message with real one, add assistant message
              setCachedMessages((prev) => {
                const filtered = prev.filter((m) => m.id !== tempUserMsg.id)
                const newMessages = [...filtered]
                if (event.user_message) {
                  newMessages.push(event.user_message)
                } else {
                  newMessages.push(tempUserMsg)
                }
                const baseAssistantMsg = event.message || (fullText ? {
                  id: `assistant-${Date.now()}`,
                  conversationId: conversationID,
                  role: 'assistant' as const,
                  content: fullText,
                  tokenCount: 0,
                  createdAt: Date.now(),
                } : null)

                if (baseAssistantMsg) {
                  const assistantMsg: ChatMessage = {
                    ...baseAssistantMsg,
                    thinking: baseAssistantMsg.thinking ?? (fullThinking || undefined),
                    thinkingDuration: baseAssistantMsg.thinkingDuration ?? (thinkingStartTime
                      ? Math.round((Date.now() - thinkingStartTime) / 1000)
                      : undefined),
                    toolCalls: baseAssistantMsg.toolCalls ?? (localTools.length ? localTools : undefined),
                  }
                  newMessages.push(assistantMsg)
                }
                return newMessages
              })
              break
            }
            case 'note_updated':
              if (!isActiveServerStateAccount(accountID)) break
              patchNoteEverywhere(queryClient, accountID, event.note_id, { updatedAt: Date.now() })
              void queryClient.invalidateQueries({ queryKey: queryKeys.note(accountID, event.note_id) })
              void queryClient.invalidateQueries({ queryKey: queryKeys.notes(accountID) })
              void queryClient.invalidateQueries({ queryKey: queryKeys.activity(accountID) })
              break
            case 'title':
              if (!isActiveServerStateAccount(accountID)) break
              queryClient.setQueriesData<Conversation[]>(
                { queryKey: queryKeys.conversations(accountID) },
                (current) => current?.map((conversation) => conversation.id === conversationID
                  ? { ...conversation, title: event.title }
                  : conversation),
              )
              break
            case 'error':
              console.error('Chat stream error:', event.error)
              setLastError(event.error)
              break
          }
        }
      } catch (error) {
        // Don't treat abort as an error
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Stopped by user — keep whatever content was streamed so far
          if (fullText) {
            setCachedMessages((prev) => {
              const filtered = prev.filter((m) => m.id !== tempUserMsg.id)
              return [
                ...filtered,
                tempUserMsg,
                {
                  id: `assistant-${Date.now()}`,
                  conversationId: conversationID,
                  role: 'assistant' as const,
                  content: fullText,
                  tokenCount: 0,
                  createdAt: Date.now(),
                },
              ]
            })
          }
        } else {
          const errorMsg = error instanceof Error ? error.message : 'Failed to send message'
          console.error('Failed to send message:', error)
          setLastError(errorMsg)
          // Remove optimistic message on failure
          setCachedMessages((prev) => prev.filter((message) => message.id !== tempUserMsg.id))
          // If we just created this conversation and message failed, delete it
          if (wasCreated) {
            await deleteConversationMutation.mutateAsync(conversationID).catch(() => {})
            setActiveConversationId(null)
          }
        }
      } finally {
        abortRef.current = null
        setIsStreaming(false)
        setStreamingText('')
        setThinkingText('')
        if (isActiveServerStateAccount(accountID)) {
          void queryClient.invalidateQueries({ queryKey: messageKey })
          void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(accountID) })
        }
      }
    },
    [accountID, activeConversationId, createConversationMutation, deleteConversationMutation, isStreaming, queryClient],
  )

  return (
    <ChatContext.Provider
      value={{
        isOpen,
        toggleOpen,
        conversations,
        activeConversationId,
        selectConversation,
        createConversation,
        deleteConversation,
        renameConversation,
        messages,
        isStreaming,
        streamingText,
        thinkingText,
        lastError,
        completedThinking,
        thinkingDuration,
        toolUsage,
        currentTools,
        sendMessage,
        stopStreaming,
        loadConversations,
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within ChatProvider')
  return ctx
}
