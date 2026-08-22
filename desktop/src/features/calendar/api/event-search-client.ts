import { authenticatedFetch } from '@/features/auth/auth-session'
import { API_BASE_URL } from '@/lib/api-config'

export type CalendarEventSearchResult = {
  id: string
  title: string
  start: string
  color: string
}

export async function searchCalendarEvents(params: {
  query: string
  noteID: string
  signal?: AbortSignal
}): Promise<CalendarEventSearchResult[]> {
  const url = new URL(`${API_BASE_URL}/calendar/events/search`)
  url.searchParams.set('limit', '20')
  if (params.query) url.searchParams.set('q', params.query)
  if (params.noteID) url.searchParams.set('note_id', params.noteID)
  const response = await authenticatedFetch(url.toString(), {
    signal: params.signal,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Calendar event search failed: ${response.status}`)
  const data = await response.json() as {
    status: string
    events?: Array<{ id: string; title: string; start: string; color?: string }>
  }
  if (data.status !== 'success') return []
  return (data.events ?? []).map((event) => ({
    id: event.id,
    title: event.title || 'Untitled event',
    start: event.start,
    color: event.color ?? '#9f73f2',
  }))
}
