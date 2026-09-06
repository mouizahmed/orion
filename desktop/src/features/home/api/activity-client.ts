import { authenticatedFetch } from '@/features/auth/auth-session'
import type { ActivityRecord, ActivitySort, ActivitySortDirection } from '@/features/home/types'
import { API_BASE_URL } from '@/lib/api-config'


type ApiActivity = {
  id: string
  title: string
  actor_label?: string
  timestamp: string
  note_id?: string | null
  folder_id?: string | null
  created_at: string
  updated_at: string
}

function toActivityRecord(activity: ApiActivity): ActivityRecord {
  return {
    id: activity.id,
    title: activity.title,
    actorLabel: activity.actor_label,
    timestamp: Date.parse(activity.timestamp),
    noteId: activity.note_id ?? undefined,
    folderId: activity.folder_id ?? undefined,
    createdAt: Date.parse(activity.created_at),
    updatedAt: Date.parse(activity.updated_at),
  }
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(input, init)
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error || 'Request failed')
  }
  return (await response.json()) as T
}

export async function listActivityPage(params: {
  limit?: number
  cursor?: string | null
  sort?: ActivitySort
  direction?: ActivitySortDirection
  signal?: AbortSignal
} = {}): Promise<{ activity: ActivityRecord[]; nextCursor?: string; hasMore: boolean }> {
  const url = new URL(`${API_BASE_URL}/dashboard/activity`)
  url.searchParams.set('limit', String(params.limit ?? 20))
  url.searchParams.set('sort', params.sort ?? 'updated')
  url.searchParams.set('direction', params.direction ?? 'desc')
  if (params.cursor) url.searchParams.set('cursor', params.cursor)

  const payload = await fetchJson<{
    activity: ApiActivity[]
    pagination?: { has_more?: boolean; next_cursor?: string | null }
  }>(url.toString(), {
    signal: params.signal,
    headers: {
      Accept: 'application/json',
    },
  })

  return {
    activity: (payload.activity ?? []).map(toActivityRecord),
    hasMore: Boolean(payload.pagination?.has_more),
    nextCursor: payload.pagination?.next_cursor ?? undefined,
  }
}
