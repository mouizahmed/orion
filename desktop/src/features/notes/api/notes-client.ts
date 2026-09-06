import type { NoteAttendee, NoteDetail, NoteRecord, NoteSort, NoteSortDirection, NoteSummary } from '@/features/notes/types'
import { authenticatedFetch, getAuthenticatedAccessToken } from '@/features/auth/auth-session'
import { API_BASE_URL } from '@/lib/api-config'

const NOTE_IMAGE_PREVIEW_CACHE_MS = 50 * 60 * 1000

type NoteImagePreviewCacheEntry = {
  expiresAt: number
  promise: Promise<string>
}

const noteImagePreviewCache = new Map<string, NoteImagePreviewCacheEntry>()

type ApiAttendee = {
  name?: string
  email: string
  response_status?: string
  attendee_type?: string
  optional?: boolean
  organizer?: boolean
  self?: boolean
  resource?: boolean
}

type ApiLinkedEvent = {
  id: string
  provider_event_id: string
  connection_id: string
  calendar_id: string
  provider: string
  title: string
  start: string
  end?: string
  all_day?: boolean
  color?: string
  calendar_name?: string
  meeting_link?: string
  event_link?: string
  location?: string
  organizer_name?: string
  organizer_email?: string
  historical?: boolean
  attendees?: ApiAttendee[]
}

type ApiNote = {
  id: string
  user_id: string
  folder_id?: string | null
  title: string
  note_markdown: string
  created_at: string
  updated_at: string
  calendar_event_id?: string | null
  linked_event?: ApiLinkedEvent | null
  attendees?: ApiNoteAttendee[]
  revision: number
}

type ApiNoteSummary = {
  id: string
  folder_id?: string | null
  title: string
  created_at: string
  updated_at: string
  calendar_event_id?: string | null
}

function toNoteSummary(note: ApiNoteSummary | ApiNote): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    folderId: note.folder_id ?? undefined,
    createdAt: Date.parse(note.created_at),
    updatedAt: Date.parse(note.updated_at),
    calendarEventId: note.calendar_event_id ?? undefined,
  }
}

function toNoteRecord(note: ApiNote): NoteRecord {
  if (!Number.isSafeInteger(note.revision) || note.revision < 1) {
    throw new Error('Invalid note revision')
  }
  return {
    ...toNoteSummary(note),
    noteMarkdown: note.note_markdown ?? '',
    revision: note.revision,
  }
}

function toNoteDetail(note: ApiNote): NoteDetail {
  const le = note.linked_event
  return {
    ...toNoteRecord(note),
    linkedEvent: le
      ? {
          id: le.id,
          providerEventId: le.provider_event_id,
          connectionId: le.connection_id,
          calendarId: le.calendar_id,
          provider: le.provider ?? '',
          title: le.title,
          start: le.start,
          end: le.end,
          allDay: le.all_day,
          color: le.color ?? '#9f73f2',
          calendarName: le.calendar_name,
          meetingLink: le.meeting_link,
          eventLink: le.event_link,
          location: le.location,
          organizerName: le.organizer_name,
          organizerEmail: le.organizer_email,
          historical: Boolean(le.historical),
          attendees: (le.attendees ?? []).map((a) => ({
            name: a.name,
            email: a.email,
            responseStatus: a.response_status,
            attendeeType: a.attendee_type,
            optional: Boolean(a.optional),
            organizer: Boolean(a.organizer),
            self: Boolean(a.self),
            resource: Boolean(a.resource),
          })),
        }
      : null,
    attendees: (note.attendees ?? []).map(toNoteAttendee),
  }
}

async function getAccessToken() {
  return getAuthenticatedAccessToken()
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(input, init)
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string
    }
    throw new Error(payload.error || 'Request failed')
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export async function listNotes(userId?: string): Promise<NoteSummary[]> {
  void userId
  const collected: NoteSummary[] = []
  let cursor: string | null = null
  do {
    const page = await listNotesPage({ limit: 100, cursor })
    collected.push(...page.notes)
    cursor = page.nextCursor ?? null
  } while (cursor)
  return collected
}

export async function listNotesPage(params: {
  folderId?: string
  unfiled?: boolean
  limit?: number
  cursor?: string | null
  sort?: NoteSort
  direction?: NoteSortDirection
  signal?: AbortSignal
}): Promise<{ notes: NoteSummary[]; nextCursor?: string; hasMore: boolean }> {
  const accessToken = await getAccessToken()
  const limit = params.limit ?? 20
  const url = new URL(`${API_BASE_URL}/notes`)
  url.searchParams.set('limit', String(limit))
  if (params.cursor) url.searchParams.set('cursor', params.cursor)
  if (params.sort) url.searchParams.set('sort', params.sort)
  if (params.direction) url.searchParams.set('direction', params.direction)
  if (params.folderId) url.searchParams.set('folder_id', params.folderId)
  if (params.unfiled) url.searchParams.set('unfiled', 'true')

  const payload = await fetchJson<{
    notes: ApiNoteSummary[]
    pagination?: { has_more?: boolean; next_cursor?: string | null }
  }>(url.toString(), {
    signal: params.signal,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })

  const notes = (payload.notes ?? []).map(toNoteSummary)
  const hasMore = Boolean(payload.pagination?.has_more)
  const nextCursor = payload.pagination?.next_cursor ?? undefined

  return { notes, hasMore, nextCursor }
}

export async function getNote(
  userId: string | undefined,
  noteId: string,
  signal?: AbortSignal,
): Promise<NoteDetail | null> {
  void userId
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ note?: ApiNote }>(`${API_BASE_URL}/notes/${noteId}`, {
    signal,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!payload.note) return null
  return toNoteDetail(payload.note)
}

export async function createNote(
  userId?: string,
  initial?: {
    id?: string
    title?: string
    folderId?: string | null
    noteMarkdown?: string
    calendarEventId?: string
  },
): Promise<NoteDetail> {
  void userId
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ note?: ApiNote }>(`${API_BASE_URL}/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      title: initial?.title,
      folder_id: initial?.folderId ?? null,
      note_markdown: initial?.noteMarkdown,
      calendar_event_id: initial?.calendarEventId,
    }),
  })
  if (!payload.note) throw new Error('Failed to create note')
  return toNoteDetail(payload.note)
}

export async function updateNote(
  userId: string | undefined,
  noteId: string,
  patch: {
    title?: string
    folderId?: string | null
    noteMarkdown?: string
    calendarEventId?: string | null
    expectedRevision: number
  },
): Promise<NoteRecord | null> {
  void userId
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ note?: ApiNote }>(`${API_BASE_URL}/notes/${noteId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      title: patch.title,
      folder_id: 'folderId' in patch ? (patch.folderId ?? '') : undefined,
      note_markdown: patch.noteMarkdown,
      calendar_event_id: 'calendarEventId' in patch ? (patch.calendarEventId ?? '') : undefined,
      expected_revision: patch.expectedRevision,
    }),
  })
  return payload.note ? toNoteRecord(payload.note) : null
}

export async function updateCalendarLink(
  userId: string | undefined,
  noteId: string,
  calendarEventId: string | null,
  expectedRevision: number,
): Promise<NoteRecord> {
  void userId
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ note?: ApiNote }>(`${API_BASE_URL}/notes/${noteId}/calendar-link`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      calendar_event_id: calendarEventId,
      expected_revision: expectedRevision,
    }),
  })
  if (!payload.note) throw new Error('Failed to update calendar link')
  return toNoteRecord(payload.note)
}

export async function uploadNoteImage(noteId: string, file: File): Promise<string> {
  const accessToken = await getAccessToken()
  const form = new FormData()
  form.append('file', file)
  const res = await authenticatedFetch(`${API_BASE_URL}/notes/${noteId}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })
  if (!res.ok) throw new Error('Upload failed')
  const data = (await res.json()) as { url: string }
  return data.url
}

function isAuthenticatedNoteImageUrl(source: string): boolean {
  try {
    const sourceUrl = new URL(source)
    const apiUrl = new URL(API_BASE_URL)
    const apiPath = apiUrl.pathname.replace(/\/+$/, '')
    const relativePath = sourceUrl.pathname.slice(apiPath.length)
    return sourceUrl.origin === apiUrl.origin
      && sourceUrl.pathname.startsWith(`${apiPath}/`)
      && /^\/notes\/[^/]+\/images\/[^/]+$/.test(relativePath)
  } catch {
    return false
  }
}

/**
 * MDXEditor renders images with a plain <img>, which cannot attach Orion's
 * bearer token. Resolve only Orion-owned image proxy URLs through an
 * authenticated fetch and leave external/data/blob URLs untouched.
 */
export function resolveNoteImagePreview(source: string): Promise<string> {
  if (!isAuthenticatedNoteImageUrl(source)) return Promise.resolve(source)

  const cached = noteImagePreviewCache.get(source)
  if (cached && cached.expiresAt > Date.now()) return cached.promise
  noteImagePreviewCache.delete(source)

  const pending = authenticatedFetch(source, {
    headers: { Accept: 'application/json' },
  }).then(async (response) => {
    if (!response.ok) throw new Error('Failed to load note image')
    const payload = (await response.json()) as { url?: unknown }
    if (typeof payload.url !== 'string') throw new Error('Invalid note image response')

    const previewUrl = new URL(payload.url)
    if (previewUrl.protocol !== 'https:' || previewUrl.username || previewUrl.password) {
      throw new Error('Invalid note image URL')
    }
    return previewUrl.toString()
  }).catch((error) => {
    noteImagePreviewCache.delete(source)
    throw error
  })

  noteImagePreviewCache.set(source, {
    expiresAt: Date.now() + NOTE_IMAGE_PREVIEW_CACHE_MS,
    promise: pending,
  })
  return pending
}

export async function listNotesByEvent(
  calendarEventId: string,
  cursor?: string | null,
  limit = 20,
  signal?: AbortSignal,
): Promise<{ notes: NoteRecord[]; hasMore: boolean; nextCursor?: string }> {
  const accessToken = await getAccessToken()
  const url = new URL(`${API_BASE_URL}/notes/by-event`)
  url.searchParams.set('calendar_event_id', calendarEventId)
  url.searchParams.set('limit', String(limit))
  if (cursor) url.searchParams.set('cursor', cursor)
  const payload = await fetchJson<{
    notes: ApiNote[]
    pagination?: { has_more?: boolean; next_cursor?: string | null }
  }>(url.toString(), {
    signal,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })
  return {
    notes: (payload.notes ?? []).map(toNoteRecord),
    hasMore: Boolean(payload.pagination?.has_more),
    nextCursor: payload.pagination?.next_cursor ?? undefined,
  }
}

export async function deleteNote(userId: string | undefined, noteId: string): Promise<boolean> {
  void userId
  const accessToken = await getAccessToken()
  await fetchJson(`${API_BASE_URL}/notes/${noteId}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })
  return true
}

// ── Note attendees ────────────────────────────────────────────────────────────

type ApiNoteAttendee = {
  id: string
  note_id: string
  email: string
  name: string
  source: 'manual' | 'calendar'
  created_at: string
}

function toNoteAttendee(a: ApiNoteAttendee): NoteAttendee {
  return {
    id: a.id,
    noteId: a.note_id,
    email: a.email,
    name: a.name,
    source: a.source,
    createdAt: a.created_at,
  }
}

export async function listNoteAttendees(noteId: string): Promise<NoteAttendee[]> {
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ attendees: ApiNoteAttendee[] }>(`${API_BASE_URL}/notes/${noteId}/attendees`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })
  return (payload.attendees ?? []).map(toNoteAttendee)
}

export async function addNoteAttendee(noteId: string, email: string, name?: string): Promise<NoteAttendee> {
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ attendee: ApiNoteAttendee }>(`${API_BASE_URL}/notes/${noteId}/attendees`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ email, name: name?.trim() || undefined }),
  })
  return toNoteAttendee(payload.attendee)
}

export async function removeNoteAttendee(noteId: string, email: string): Promise<void> {
  const accessToken = await getAccessToken()
  await fetchJson(`${API_BASE_URL}/notes/${noteId}/attendees/${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })
}
