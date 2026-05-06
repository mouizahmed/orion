import type { NoteRecord, NoteVersion } from '@/types/note'
import { auth } from '@/config/firebase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'

type ApiNote = {
  id: string
  user_id: string
  folder_id?: string | null
  title: string
  note_markdown: string
  created_at: string
  updated_at: string
  provider_event_id?: string | null
  connection_id?: string | null
  calendar_id?: string | null
}

function toNoteRecord(note: ApiNote): NoteRecord {
  return {
    id: note.id,
    title: note.title,
    folderId: note.folder_id ?? undefined,
    noteMarkdown: note.note_markdown ?? '',
    createdAt: Date.parse(note.created_at),
    updatedAt: Date.parse(note.updated_at),
    providerEventId: note.provider_event_id ?? undefined,
    connectionId: note.connection_id ?? undefined,
    calendarId: note.calendar_id ?? undefined,
  }
}

async function getIdToken() {
  const currentUser = auth.currentUser
  if (!currentUser) {
    throw new Error('Not authenticated')
  }
  return await currentUser.getIdToken()
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error || 'Request failed')
  }
  return (await response.json()) as T
}

export async function listNotes(userId?: string): Promise<NoteRecord[]> {
  void userId
  const collected: NoteRecord[] = []
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
}): Promise<{ notes: NoteRecord[]; nextCursor?: string; hasMore: boolean }> {
  const idToken = await getIdToken()
  const limit = params.limit ?? 20
  const url = new URL(`${API_BASE_URL}/notes`)
  url.searchParams.set('limit', String(limit))
  if (params.cursor) url.searchParams.set('cursor', params.cursor)
  if (params.folderId) url.searchParams.set('folder_id', params.folderId)
  if (params.unfiled) url.searchParams.set('unfiled', 'true')

  const payload = await fetchJson<{
    notes: ApiNote[]
    pagination?: { has_more?: boolean; next_cursor?: string | null }
  }>(url.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  })

  const notes = (payload.notes ?? []).map(toNoteRecord)
  const hasMore = Boolean(payload.pagination?.has_more)
  const nextCursor = payload.pagination?.next_cursor ?? undefined

  return { notes, hasMore, nextCursor }
}

export async function getNote(userId: string | undefined, noteId: string): Promise<NoteRecord | null> {
  void userId
  const idToken = await getIdToken()
  const payload = await fetchJson<{ note?: ApiNote }>(`${API_BASE_URL}/notes/${noteId}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  })
  return payload.note ? toNoteRecord(payload.note) : null
}

export async function createNote(
  userId?: string,
  initial?: {
    id?: string
    title?: string
    folderId?: string | null
    noteMarkdown?: string
    providerEventId?: string
    connectionId?: string
    calendarId?: string
  },
): Promise<NoteRecord> {
  void userId
  const idToken = await getIdToken()
  const payload = await fetchJson<{ note?: ApiNote }>(`${API_BASE_URL}/notes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      title: initial?.title,
      folder_id: initial?.folderId ?? null,
      note_markdown: initial?.noteMarkdown,
      provider_event_id: initial?.providerEventId,
      connection_id: initial?.connectionId,
      calendar_id: initial?.calendarId,
    }),
  })
  if (!payload.note) {
    throw new Error('Failed to create note')
  }
  return toNoteRecord(payload.note)
}

export async function updateNote(
  userId: string | undefined,
  noteId: string,
  patch: {
    title?: string
    folderId?: string | null
    noteMarkdown?: string
    providerEventId?: string | null
    connectionId?: string | null
    calendarId?: string | null
  },
): Promise<NoteRecord | null> {
  void userId
  const idToken = await getIdToken()
  const payload = await fetchJson<{ note?: ApiNote }>(`${API_BASE_URL}/notes/${noteId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      title: patch.title,
      folder_id: 'folderId' in patch ? (patch.folderId ?? '') : undefined,
      note_markdown: patch.noteMarkdown,
      provider_event_id: 'providerEventId' in patch ? (patch.providerEventId ?? '') : undefined,
      connection_id: 'connectionId' in patch ? (patch.connectionId ?? '') : undefined,
      calendar_id: 'calendarId' in patch ? (patch.calendarId ?? '') : undefined,
    }),
  })
  return payload.note ? toNoteRecord(payload.note) : null
}

export async function enhanceNote(noteId: string): Promise<{ note: NoteRecord; versionId: string }> {
  const idToken = await getIdToken()
  const payload = await fetchJson<{ note?: ApiNote; version_id?: string }>(
    `${API_BASE_URL}/notes/${noteId}/enhance`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: '{}',
    },
  )
  if (!payload.note) throw new Error('Failed to enhance note')
  return { note: toNoteRecord(payload.note), versionId: payload.version_id ?? '' }
}


export async function listVersions(noteId: string): Promise<NoteVersion[]> {
  const idToken = await getIdToken()
  const payload = await fetchJson<{ versions: NoteVersion[] }>(
    `${API_BASE_URL}/notes/${noteId}/versions`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    },
  )
  return payload.versions ?? []
}

export async function revertToVersion(noteId: string, versionId: string): Promise<NoteRecord> {
  const idToken = await getIdToken()
  const payload = await fetchJson<{ note?: ApiNote }>(
    `${API_BASE_URL}/notes/${noteId}/revert/${versionId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: '{}',
    },
  )
  if (!payload.note) throw new Error('Failed to revert note')
  return toNoteRecord(payload.note)
}

export async function uploadNoteImage(noteId: string, file: File): Promise<string> {
  const idToken = await getIdToken()
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE_URL}/notes/${noteId}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${idToken}` },
    body: form,
  })
  if (!res.ok) throw new Error('Upload failed')
  const data = (await res.json()) as { url: string }
  return data.url
}

export async function listNotesByEvent(
  connectionId: string,
  calendarId: string,
  providerEventId: string,
  cursor?: string | null,
  limit = 20,
): Promise<{ notes: NoteRecord[]; hasMore: boolean; nextCursor?: string }> {
  const idToken = await getIdToken()
  const url = new URL(`${API_BASE_URL}/notes/by-event`)
  url.searchParams.set('connection_id', connectionId)
  url.searchParams.set('calendar_id', calendarId)
  url.searchParams.set('provider_event_id', providerEventId)
  url.searchParams.set('limit', String(limit))
  if (cursor) url.searchParams.set('cursor', cursor)
  const payload = await fetchJson<{
    notes: ApiNote[]
    pagination?: { has_more?: boolean; next_cursor?: string | null }
  }>(url.toString(), {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
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
  const idToken = await getIdToken()
  await fetchJson(`${API_BASE_URL}/notes/${noteId}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  })
  return true
}
