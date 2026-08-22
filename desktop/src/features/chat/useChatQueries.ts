import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createConversation,
  deleteConversation,
  getMessages,
  listConversations,
  renameConversation,
  type Conversation,
} from '@/features/chat/chat-client'
import { queryKeys } from '@/lib/query-keys'
import { isActiveServerStateAccount } from '@/lib/query-client'

export type ConversationScope = { noteID: string | null; folderID: string | null }

export function useConversationsQuery(accountID: string | undefined, scope: ConversationScope) {
  return useQuery({
    queryKey: queryKeys.conversationsScoped(accountID ?? 'anonymous', scope),
    queryFn: ({ signal }) => listConversations(scope.noteID ?? undefined, scope.folderID ?? undefined, signal),
    enabled: Boolean(accountID),
    staleTime: 15_000,
  })
}

export function useMessagesQuery(accountID: string | undefined, conversationID: string | null) {
  return useQuery({
    queryKey: queryKeys.messages(accountID ?? 'anonymous', conversationID ?? ''),
    queryFn: ({ signal }) => getMessages(conversationID ?? '', signal),
    enabled: Boolean(accountID && conversationID),
    staleTime: 15_000,
  })
}

export function useCreateConversationMutation(accountID: string, scope: ConversationScope) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input?: { title?: string; noteID?: string | null; folderID?: string | null }) => createConversation(
      input?.title,
      input?.noteID ?? scope.noteID ?? undefined,
      input?.folderID ?? scope.folderID ?? undefined,
    ),
    onSuccess: (conversation) => {
      if (!isActiveServerStateAccount(accountID)) return
      queryClient.setQueryData<Conversation[]>(queryKeys.conversationsScoped(accountID, scope), (current = []) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ])
      queryClient.setQueryData(queryKeys.messages(accountID, conversation.id), [])
    },
  })
}

export function useDeleteConversationMutation(accountID: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_data, conversationID) => {
      if (!isActiveServerStateAccount(accountID)) return
      queryClient.setQueriesData<Conversation[]>(
        { queryKey: queryKeys.conversations(accountID) },
        (current) => current?.filter((item) => item.id !== conversationID),
      )
      queryClient.removeQueries({ queryKey: queryKeys.messages(accountID, conversationID), exact: true })
    },
  })
}

export function useRenameConversationMutation(accountID: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ conversationID, title }: { conversationID: string; title: string }) => renameConversation(conversationID, title),
    onSuccess: (updated) => {
      if (!isActiveServerStateAccount(accountID)) return
      queryClient.setQueriesData<Conversation[]>(
        { queryKey: queryKeys.conversations(accountID) },
        (current) => current?.map((item) => item.id === updated.id ? updated : item),
      )
    },
  })
}
