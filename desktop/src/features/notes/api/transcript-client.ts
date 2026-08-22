import { authenticatedFetch } from '@/features/auth/auth-session'
import { API_BASE_URL } from '@/lib/api-config'


async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(input, init)
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error || 'Request failed')
  }
  return (await response.json()) as T
}

export interface TranscriptSegmentPayload {
  channel: number
  text: string
  start_time?: number
  end_time?: number
  segment_index: number
}

export interface TranscriptSegment {
  id: string
  note_id: string
  channel: number
  text: string
  start_time?: number
  end_time?: number
  segment_index: number
  created_at: string
}

export async function saveTranscriptSegments(
  noteId: string,
  segments: TranscriptSegmentPayload[],
): Promise<{ status: string; saved_count: number }> {
  return fetchJson(`${API_BASE_URL}/notes/${noteId}/transcript/segments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ segments }),
  })
}

export async function getTranscriptSegments(
  noteId: string,
  signal?: AbortSignal,
): Promise<{ segments: TranscriptSegment[] }> {
  return fetchJson(`${API_BASE_URL}/notes/${noteId}/transcript/segments`, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  })
}

export async function searchTranscripts(
  query: string,
  limit?: number,
): Promise<{ segments: TranscriptSegment[] }> {
  const url = new URL(`${API_BASE_URL}/transcript/search`)
  url.searchParams.set('q', query)
  if (limit !== undefined) url.searchParams.set('limit', String(limit))
  return fetchJson(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  })
}
