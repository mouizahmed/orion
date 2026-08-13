import type { NoteAttendee, NoteDetail, NoteRecord, NoteShare, NoteSummary, NoteVersion } from '@/types/note'
import { authenticatedFetch, getAuthenticatedAccessToken } from '@/lib/auth-session'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'

type ApiAttendee = {
  name?: string
  email: string
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
  organizer_email?: string
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
}

type ApiNoteSummary = {
  id: string
  folder_id?: string | null
  title: string
  created_at: string
  updated_at: string
  calendar_event_id?: string | null
}

type ApiNoteShare = {
  id: string
  note_id: string
  shared_by: string
  email: string
  user_id?: string | null
  role: 'viewer' | 'editor'
  status: 'pending' | 'active'
  created_at: string
  updated_at: string
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
  return {
    ...toNoteSummary(note),
    noteMarkdown: note.note_markdown ?? '',
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
          organizerEmail: le.organizer_email,
          attendees: (le.attendees ?? []).map((a) => ({ name: a.name, email: a.email })),
        }
      : null,
    attendees: (note.attendees ?? []).map(toNoteAttendee),
  }
}

function toNoteShare(s: ApiNoteShare): NoteShare {
  return {
    id: s.id,
    noteId: s.note_id,
    sharedBy: s.shared_by,
    email: s.email,
    userId: s.user_id ?? undefined,
    role: s.role,
    status: s.status,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
  }
}

async function getAccessToken() {
  return getAuthenticatedAccessToken()
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(input, init)
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error || 'Request failed')
  }
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
}): Promise<{ notes: NoteSummary[]; nextCursor?: string; hasMore: boolean }> {
  const accessToken = await getAccessToken()
  const limit = params.limit ?? 20
  const url = new URL(`${API_BASE_URL}/notes`)
  url.searchParams.set('limit', String(limit))
  if (params.cursor) url.searchParams.set('cursor', params.cursor)
  if (params.folderId) url.searchParams.set('folder_id', params.folderId)
  if (params.unfiled) url.searchParams.set('unfiled', 'true')

  const payload = await fetchJson<{
    notes: ApiNoteSummary[]
    pagination?: { has_more?: boolean; next_cursor?: string | null }
  }>(url.toString(), {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  })

  const notes = (payload.notes ?? []).map(toNoteSummary)
  const hasMore = Boolean(payload.pagination?.has_more)
  const nextCursor = payload.pagination?.next_cursor ?? undefined

  return { notes, hasMore, nextCursor }
}

export async function getNote(userId: string | undefined, noteId: string): Promise<NoteDetail | null> {
  void userId
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ note?: ApiNote }>(`${API_BASE_URL}/notes/${noteId}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
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
): Promise<NoteRecord> {
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
  return toNoteRecord(payload.note)
}

export async function updateNote(
  userId: string | undefined,
  noteId: string,
  patch: {
    title?: string
    folderId?: string | null
    noteMarkdown?: string
    calendarEventId?: string | null
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
    }),
  })
  return payload.note ? toNoteRecord(payload.note) : null
}

export async function enhanceNote(noteId: string): Promise<{ note: NoteRecord; versionId: string }> {
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ note?: ApiNote; version_id?: string }>(
    `${API_BASE_URL}/notes/${noteId}/enhance`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: '{}',
    },
  )
  if (!payload.note) throw new Error('Failed to enhance note')
  return { note: toNoteRecord(payload.note), versionId: payload.version_id ?? '' }
}

export async function listVersions(noteId: string): Promise<NoteVersion[]> {
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ versions: NoteVersion[] }>(
    `${API_BASE_URL}/notes/${noteId}/versions`,
    {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    },
  )
  return payload.versions ?? []
}

export async function revertToVersion(noteId: string, versionId: string): Promise<NoteRecord> {
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ note?: ApiNote }>(
    `${API_BASE_URL}/notes/${noteId}/revert/${versionId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: '{}',
    },
  )
  if (!payload.note) throw new Error('Failed to revert note')
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

export async function listNotesByEvent(
  calendarEventId: string,
  cursor?: string | null,
  limit = 20,
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
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
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
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  })
  return true
}

// ── Note shares ──────────────────────────────────────────────────────────────

export async function listNoteShares(noteId: string): Promise<NoteShare[]> {
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ shares: ApiNoteShare[] }>(
    `${API_BASE_URL}/notes/${noteId}/shares`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } },
  )
  return (payload.shares ?? []).map(toNoteShare)
}

export async function createNoteShare(
  noteId: string,
  email: string,
  role: 'viewer' | 'editor',
): Promise<NoteShare> {
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ share: ApiNoteShare }>(
    `${API_BASE_URL}/notes/${noteId}/shares`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ email, role }),
    },
  )
  return toNoteShare(payload.share)
}

export async function updateNoteShare(
  noteId: string,
  email: string,
  role: 'viewer' | 'editor',
): Promise<NoteShare> {
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ share: ApiNoteShare }>(
    `${API_BASE_URL}/notes/${noteId}/shares/${encodeURIComponent(email)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ role }),
    },
  )
  return toNoteShare(payload.share)
}

export async function deleteNoteShare(noteId: string, email: string): Promise<boolean> {
  const accessToken = await getAccessToken()
  await fetchJson(`${API_BASE_URL}/notes/${noteId}/shares/${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  })
  return true
}

// ── Note attendees ────────────────────────────────────────────────────────────

type ApiNoteAttendee = {
  id: string
  note_id: string
  user_id?: string
  email: string
  name: string
  avatar_url?: string
  created_at: string
}

function toNoteAttendee(a: ApiNoteAttendee): NoteAttendee {
  return { id: a.id, noteId: a.note_id, userId: a.user_id, email: a.email, name: a.name, avatarUrl: a.avatar_url || undefined, createdAt: a.created_at }
}

export async function listNoteAttendees(noteId: string): Promise<NoteAttendee[]> {
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ attendees: ApiNoteAttendee[] }>(
    `${API_BASE_URL}/notes/${noteId}/attendees`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` } },
  )
  return (payload.attendees ?? []).map(toNoteAttendee)
}

export async function addNoteAttendee(noteId: string, email: string): Promise<NoteAttendee> {
  const accessToken = await getAccessToken()
  const payload = await fetchJson<{ attendee: ApiNoteAttendee }>(
    `${API_BASE_URL}/notes/${noteId}/attendees`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ email }),
    },
  )
  return toNoteAttendee(payload.attendee)
}

export async function removeNoteAttendee(noteId: string, email: string): Promise<void> {
  const accessToken = await getAccessToken()
  await fetchJson(`${API_BASE_URL}/notes/${noteId}/attendees/${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  })
}
