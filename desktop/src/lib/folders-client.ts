import type { FolderRecord } from '@/types/folder'
import { authenticatedFetch } from '@/lib/auth-session'
import { API_BASE_URL } from '@/lib/api-config'


type ApiFolder = {
  id: string
  user_id: string
  name: string
  note_count?: number
  created_at: string
  updated_at: string
}

function toFolderRecord(folder: ApiFolder): FolderRecord {
  return {
    id: folder.id,
    name: folder.name,
    noteCount: folder.note_count ?? 0,
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

export async function listFolders(userId?: string): Promise<FolderRecord[]> {
  void userId
  const payload = await fetchJson<{ folders: ApiFolder[] }>(`${API_BASE_URL}/folders`, {
    headers: {
      Accept: 'application/json',
    },
  })
  return (payload.folders ?? []).map(toFolderRecord)
}

export async function createFolder(userId: string | undefined, name: string): Promise<FolderRecord> {
  void userId
  const payload = await fetchJson<{ folder: ApiFolder }>(`${API_BASE_URL}/folders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ name }),
  })
  return toFolderRecord(payload.folder)
}

export async function renameFolder(
  userId: string | undefined,
  folderId: string,
  name: string,
): Promise<FolderRecord | null> {
  void userId
  const payload = await fetchJson<{ folder?: ApiFolder }>(`${API_BASE_URL}/folders/${folderId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ name }),
  })
  return payload.folder ? toFolderRecord(payload.folder) : null
}

export async function deleteFolder(userId: string | undefined, folderId: string): Promise<boolean> {
  void userId
  await fetchJson(`${API_BASE_URL}/folders/${folderId}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
    },
  })
  return true
}
