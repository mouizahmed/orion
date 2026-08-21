import { API_BASE_URL } from '@/lib/api-config'
import { authenticatedFetch } from '@/features/auth/auth-session'
import type { SummaryTemplate, SummaryTemplateInput } from '@/features/settings/sections/summary-templates/types'

type ApiSummaryTemplate = {
  id: string
  name: string
  prompt: string
  folders?: Array<{ id: string; name: string | null; available: boolean }>
  created_at: string
  updated_at: string
}

type ApiError = { code?: string; error?: string }

export class SummaryTemplateApiError extends Error {
  constructor(public readonly code: string | undefined, message: string) {
    super(message)
    this.name = 'SummaryTemplateApiError'
  }
}

function toSummaryTemplate(template: ApiSummaryTemplate): SummaryTemplate {
  return {
    id: template.id,
    name: template.name,
    prompt: template.prompt,
    folders: (template.folders ?? []).map((folder) => ({ ...folder })),
    createdAt: template.created_at,
    updatedAt: template.updated_at,
  }
}

async function readError(response: Response, fallback: string): Promise<never> {
  const payload = await response.json().catch(() => ({})) as ApiError
  throw new SummaryTemplateApiError(payload.code, payload.error || fallback)
}

export async function listSummaryTemplates(signal?: AbortSignal): Promise<SummaryTemplate[]> {
  const response = await authenticatedFetch(`${API_BASE_URL}/summary-templates`, {
    headers: { Accept: 'application/json' }, signal,
  })
  if (!response.ok) return readError(response, 'Summary templates are unavailable')
  const payload = await response.json() as { templates?: ApiSummaryTemplate[] }
  return (payload.templates ?? []).map(toSummaryTemplate)
}

export async function createSummaryTemplate(input: SummaryTemplateInput): Promise<SummaryTemplate> {
  const response = await authenticatedFetch(`${API_BASE_URL}/summary-templates`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: input.name, prompt: input.prompt, folder_ids: input.folderIds }),
  })
  if (!response.ok) return readError(response, 'Failed to create summary template')
  const payload = await response.json() as { template: ApiSummaryTemplate }
  return toSummaryTemplate(payload.template)
}

export async function updateSummaryTemplate(id: string, input: SummaryTemplateInput): Promise<SummaryTemplate> {
  const response = await authenticatedFetch(`${API_BASE_URL}/summary-templates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: input.name, prompt: input.prompt, folder_ids: input.folderIds }),
  })
  if (!response.ok) return readError(response, 'Failed to update summary template')
  const payload = await response.json() as { template: ApiSummaryTemplate }
  return toSummaryTemplate(payload.template)
}

export async function deleteSummaryTemplate(id: string): Promise<void> {
  const response = await authenticatedFetch(`${API_BASE_URL}/summary-templates/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Accept: 'application/json' },
  })
  if (!response.ok) await readError(response, 'Failed to delete summary template')
}
