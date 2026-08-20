import { API_BASE_URL } from '@/lib/api-config'
import { authenticatedFetch } from '@/features/auth/auth-session'
import type { ExtractField, ExtractFieldFolder, ExtractFieldInput } from '@/features/settings/sections/extracts/types'

type ApiExtractFieldFolder = {
  id: string
  name: string | null
  available: boolean
}

type ApiExtractField = {
  id: string
  name: string
  prompt: string
  insight_cardinality: 'single' | 'multiple'
  scope: {
    type: 'all_meetings' | 'folders'
    folders?: ApiExtractFieldFolder[]
  }
  created_at: string
  updated_at: string
}

type ApiError = { code?: string; error?: string }

function toFolder(folder: ApiExtractFieldFolder): ExtractFieldFolder {
  return { id: folder.id, name: folder.name, available: folder.available }
}

function toExtractField(field: ApiExtractField): ExtractField {
  const folders = (field.scope?.folders ?? []).map(toFolder)
  return {
    id: field.id,
    name: field.name,
    prompt: field.prompt,
    insightCardinality: field.insight_cardinality,
    scope: field.scope?.type === 'folders'
      ? { type: 'folders', folders }
      : { type: 'allMeetings', folders: [] },
    createdAt: field.created_at,
    updatedAt: field.updated_at,
  }
}

function toApiInput(input: ExtractFieldInput) {
  return {
    name: input.name,
    prompt: input.prompt,
    insight_cardinality: input.insightCardinality,
    scope: input.scope.type === 'allMeetings'
      ? { type: 'all_meetings', folder_ids: [] }
      : { type: 'folders', folder_ids: input.scope.folderIds },
  }
}

async function readError(response: Response, fallback: string): Promise<never> {
  const payload = await response.json().catch(() => ({})) as ApiError
  throw new Error(payload.error || fallback)
}

export async function listExtractFields(signal?: AbortSignal): Promise<ExtractField[]> {
  const response = await authenticatedFetch(`${API_BASE_URL}/extract-fields`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) return readError(response, 'Extract fields are unavailable')
  const payload = await response.json() as { fields?: ApiExtractField[] }
  return (payload.fields ?? []).map(toExtractField)
}

export async function createExtractField(input: ExtractFieldInput): Promise<ExtractField> {
  const response = await authenticatedFetch(`${API_BASE_URL}/extract-fields`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(toApiInput(input)),
  })
  if (!response.ok) return readError(response, 'Failed to create extract field')
  const payload = await response.json() as { field: ApiExtractField }
  return toExtractField(payload.field)
}

export async function updateExtractField(id: string, input: ExtractFieldInput): Promise<ExtractField> {
  const response = await authenticatedFetch(`${API_BASE_URL}/extract-fields/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(toApiInput(input)),
  })
  if (!response.ok) return readError(response, 'Failed to update extract field')
  const payload = await response.json() as { field: ApiExtractField }
  return toExtractField(payload.field)
}

export async function deleteExtractField(id: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE_URL}/extract-fields/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) await readError(response, 'Failed to delete extract field')
}
