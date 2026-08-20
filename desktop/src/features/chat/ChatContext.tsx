import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  createConversation as apiCreateConversation,
  deleteConversation as apiDeleteConversation,
  getMessages as apiGetMessages,
  listConversations as apiListConversations,
  renameConversation as apiRenameConversation,
  sendMessage as apiSendMessage,
  type ChatMessage,
  type Conversation,
} from '@/features/chat/chat-client'
import { useAuth } from '@/features/auth/AuthContext'

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
const LS_ACTIVE_CONV = 'chat:activeConversationId'

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [thinkingText, setThinkingText] = useState('')
  const [lastError, setLastError] = useState<string | null>(null)
  const [completedThinking, setCompletedThinking] = useState<Record<string, string>>({})
  const [thinkingDuration, setThinkingDuration] = useState<Record<string, number>>({})
  const [toolUsage, setToolUsage] = useState<Record<string, ToolUsage[]>>({})
  const [currentTools, setCurrentTools] = useState<ToolUsage[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const skipMessageLoadRef = useRef(false)
  const toggleOpen = useCallback(() => setIsOpen((v) => !v), [])

  const loadConversations = useCallback(async (noteId?: string | null, folderId?: string | null) => {
    const convs = await apiListConversations(noteId ?? undefined, folderId ?? undefined)
    setConversations(convs)
    setActiveConversationId(prev =>
      prev && convs.some(c => c.id === prev) ? prev : (convs[0]?.id ?? null)
    )
  }, [])

  // Load conversations on auth
  useEffect(() => {
    if (!user) return
    void loadConversations()
  }, [user, loadConversations])

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([])
      return
    }
    // Skip loading when we just created this conversation (messages are managed by sendMessage)
    if (skipMessageLoadRef.current) {
      skipMessageLoadRef.current = false
      return
    }
    void apiGetMessages(activeConversationId)
      .then((msgs) => {
        setMessages(msgs)
        // Restore thinking and tool usage from persisted messages
        const thinking: Record<string, string> = {}
        const duration: Record<string, number> = {}
        const tools: Record<string, ToolUsage[]> = {}
        for (const msg of msgs) {
          if (msg.role === 'assistant') {
            if (msg.thinking) thinking[msg.id] = msg.thinking
            if (msg.thinkingDuration) duration[msg.id] = msg.thinkingDuration
            if (msg.toolCalls && msg.toolCalls.length > 0) tools[msg.id] = msg.toolCalls
          }
        }
        setCompletedThinking(thinking)
        setThinkingDuration(duration)
        setToolUsage(tools)
      })
      .catch(() => setMessages([]))
  }, [activeConversationId])

  const selectConversation = useCallback((id: string | null) => {
    setActiveConversationId(id)
    if (id) localStorage.setItem(LS_ACTIVE_CONV, id)
    else localStorage.removeItem(LS_ACTIVE_CONV)
    setStreamingText('')
    setThinkingText('')
    setLastError(null)
    setCompletedThinking({})
    setCurrentTools([])
  }, [])

  const createConversation = useCallback(async () => {
    const conv = await apiCreateConversation()
    setConversations((prev) => [conv, ...prev])
    setActiveConversationId(conv.id)
    setMessages([])
  }, [])

  const deleteConversation = useCallback(
    async (id: string) => {
      await apiDeleteConversation(id)
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (activeConversationId === id) {
        setActiveConversationId(null)
        setMessages([])
        localStorage.removeItem(LS_ACTIVE_CONV)
      }
    },
    [activeConversationId],
  )

  const renameConversation = useCallback(async (id: string, title: string) => {
    const updated = await apiRenameConversation(id, title)
    setConversations((prev) => prev.map((c) => (c.id === id ? updated : c)))
  }, [])

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
        const conv = await apiCreateConversation(
          undefined,
          noteId ?? undefined,
          folderId ?? undefined,
        )
        setConversations((prev) => [conv, ...prev])
        skipMessageLoadRef.current = true
        setActiveConversationId(conv.id)
        localStorage.setItem(LS_ACTIVE_CONV, conv.id)
        setMessages([])
        convId = conv.id
        wasCreated = true
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
        conversationId: convId,
        role: 'user',
        content,
        tokenCount: 0,
        createdAt: Date.now(),
      }
      setMessages((prev) => [...prev, tempUserMsg])

      let fullText = ''
      let fullThinking = ''
      let thinkingStartTime: number | null = null
      // Track tools locally to avoid stale closure over React state
      let localTools: ToolUsage[] = []

      try {

        for await (const event of apiSendMessage(convId, content, abortController.signal)) {
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
              setMessages((prev) => {
                const filtered = prev.filter((m) => m.id !== tempUserMsg.id)
                const newMessages = [...filtered]
                if (event.user_message) {
                  newMessages.push(event.user_message)
                } else {
                  newMessages.push(tempUserMsg)
                }
                const assistantMsg = event.message || (fullText ? {
                  id: `assistant-${Date.now()}`,
                  conversationId: convId,
                  role: 'assistant' as const,
                  content: fullText,
                  tokenCount: 0,
                  createdAt: Date.now(),
                } : null)

                if (assistantMsg) {
                  newMessages.push(assistantMsg)
                  // Save thinking text associated with this message
                  if (fullThinking) {
                    setCompletedThinking(prev => ({ ...prev, [assistantMsg.id]: fullThinking }))
                    // Calculate thinking duration in seconds
                    if (thinkingStartTime) {
                      const duration = Math.round((Date.now() - thinkingStartTime) / 1000)
                      setThinkingDuration(prev => ({ ...prev, [assistantMsg.id]: duration }))
                    }
                  }
                  // Save tool usage associated with this message (uses local variable, not stale state)
                  if (localTools.length > 0) {
                    setToolUsage(prev => ({ ...prev, [assistantMsg.id]: localTools }))
                  }
                }
                return newMessages
              })
              break
            }
            case 'note_updated':
              window.dispatchEvent(new CustomEvent('note-updated-by-ai', {
                detail: { noteId: event.note_id, content: event.content },
              }))
              break
            case 'title':
              setConversations((prev) =>
                prev.map((c) => c.id === convId ? { ...c, title: event.title } : c)
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
            setMessages((prev) => {
              const filtered = prev.filter((m) => m.id !== tempUserMsg.id)
              return [
                ...filtered,
                tempUserMsg,
                {
                  id: `assistant-${Date.now()}`,
                  conversationId: convId!,
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
          setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id))
          // If we just created this conversation and message failed, delete it
          if (wasCreated) {
            await apiDeleteConversation(convId).catch(() => {})
            setConversations((prev) => prev.filter((c) => c.id !== convId))
            setActiveConversationId(null)
          }
        }
      } finally {
        abortRef.current = null
        setIsStreaming(false)
        setStreamingText('')
        setThinkingText('')
      }
    },
    [activeConversationId, isStreaming],
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
