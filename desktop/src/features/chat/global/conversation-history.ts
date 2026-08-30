import type { ChatConversationSummary } from '@/features/chat/chat-ui-types'

export type ConversationHistoryGroup = {
  label: string
  conversations: ChatConversationSummary[]
}

export function sortConversationsByRecent(conversations: ChatConversationSummary[]) {
  return [...conversations].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

export function groupConversationsByDate(
  conversations: ChatConversationSummary[],
  now = new Date(),
): ConversationHistoryGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const groups: ConversationHistoryGroup[] = []

  for (const conversation of sortConversationsByRecent(conversations)) {
    const updatedAt = new Date(conversation.updatedAt)
    const updatedDay = new Date(updatedAt.getFullYear(), updatedAt.getMonth(), updatedAt.getDate()).getTime()
    const daysAgo = Math.floor((startOfToday - updatedDay) / 86_400_000)
    const label = daysAgo >= 0 && daysAgo <= 3
      ? 'Last 3 days'
      : updatedAt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    const currentGroup = groups[groups.length - 1]
    if (currentGroup?.label === label) currentGroup.conversations.push(conversation)
    else groups.push({ label, conversations: [conversation] })
  }

  return groups
}
