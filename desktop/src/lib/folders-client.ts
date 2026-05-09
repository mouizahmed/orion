import type { FolderRecord } from '@/types/folder'
import { auth } from '@/config/firebase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'

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

export async function listFolders(userId?: string): Promise<FolderRecord[]> {
  void userId
  const idToken = await getIdToken()
  const payload = await fetchJson<{ folders: ApiFolder[] }>(`${API_BASE_URL}/folders`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  })
  return (payload.folders ?? []).map(toFolderRecord)
}

export async function createFolder(userId: string | undefined, name: string): Promise<FolderRecord> {
  void userId
  const idToken = await getIdToken()
  const payload = await fetchJson<{ folder: ApiFolder }>(`${API_BASE_URL}/folders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
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
  const idToken = await getIdToken()
  const payload = await fetchJson<{ folder?: ApiFolder }>(`${API_BASE_URL}/folders/${folderId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ name }),
  })
  return payload.folder ? toFolderRecord(payload.folder) : null
}

export async function deleteFolder(userId: string | undefined, folderId: string): Promise<boolean> {
  void userId
  const idToken = await getIdToken()
  await fetchJson(`${API_BASE_URL}/folders/${folderId}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  })
  return true
}
