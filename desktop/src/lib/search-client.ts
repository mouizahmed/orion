import { authenticatedFetch } from '@/lib/auth-session'
import type { FolderRecord } from '@/types/folder'
import type { NoteSummary } from '@/types/note'
import { API_BASE_URL } from '@/lib/api-config'


type ApiNote = {
  id: string
  user_id: string
  folder_id?: string | null
  title: string
  note_markdown: string
  created_at: string
  updated_at: string
}

type ApiFolder = {
  id: string
  user_id: string
  name: string
  created_at: string
  updated_at: string
}

type SearchResponse = {
  query: string
  notes: ApiNote[]
  folders: ApiFolder[]
  pagination?: {
    limit?: number
    notes?: {
      offset?: number
      next_offset?: number
      has_more?: boolean
    }
    folders?: {
      offset?: number
      next_offset?: number
      has_more?: boolean
    }
  }
}

export type SearchResultPage = {
  notes: NoteSummary[]
  folders: FolderRecord[]
  pagination: {
    limit: number
    notes: {
      offset: number
      nextOffset: number
      hasMore: boolean
    }
    folders: {
      offset: number
      nextOffset: number
      hasMore: boolean
    }
  }
}

function toNoteSummary(note: ApiNote): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    folderId: note.folder_id ?? undefined,
    createdAt: Date.parse(note.created_at),
    updatedAt: Date.parse(note.updated_at),
  }
}

function toFolderRecord(folder: ApiFolder): FolderRecord {
  return {
    id: folder.id,
    name: folder.name,
    noteCount: 0,
    createdAt: Date.parse(folder.created_at),
    updatedAt: Date.parse(folder.updated_at),
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

export async function searchAll(params: {
  query: string
  limit?: number
  noteOffset?: number
  folderOffset?: number
  noteLimit?: number
  folderLimit?: number
}): Promise<SearchResultPage> {
  const limit = params.limit ?? 12
  const noteOffset = params.noteOffset ?? 0
  const folderOffset = params.folderOffset ?? 0
  const noteLimit = params.noteLimit
  const folderLimit = params.folderLimit
  const q = params.query.trim()
  if (!q) {
    return {
      notes: [],
      folders: [],
      pagination: {
        limit,
        notes: { offset: 0, nextOffset: 0, hasMore: false },
        folders: { offset: 0, nextOffset: 0, hasMore: false },
      },
    }
  }

  const url = new URL(`${API_BASE_URL}/search`)
  url.searchParams.set('q', q)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('note_offset', String(noteOffset))
  url.searchParams.set('folder_offset', String(folderOffset))
  if (typeof noteLimit === 'number') {
    url.searchParams.set('note_limit', String(noteLimit))
  }
  if (typeof folderLimit === 'number') {
    url.searchParams.set('folder_limit', String(folderLimit))
  }

  const payload = await fetchJson<SearchResponse>(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  })

  return {
    notes: (payload.notes ?? []).map(toNoteSummary),
    folders: (payload.folders ?? []).map(toFolderRecord),
    pagination: {
      limit: payload.pagination?.limit ?? limit,
      notes: {
        offset: payload.pagination?.notes?.offset ?? noteOffset,
        nextOffset: payload.pagination?.notes?.next_offset ?? noteOffset,
        hasMore: Boolean(payload.pagination?.notes?.has_more),
      },
      folders: {
        offset: payload.pagination?.folders?.offset ?? folderOffset,
        nextOffset: payload.pagination?.folders?.next_offset ?? folderOffset,
        hasMore: Boolean(payload.pagination?.folders?.has_more),
      },
    },
  }
}
