import { authenticatedFetch } from '@/features/auth/auth-session'
import { API_BASE_URL } from '@/lib/api-config'

export type EmailDraftSettings = {
  enabled: boolean
  includeSharingLink: boolean
  draftPrompt: string
  createdAt?: string
  updatedAt?: string
}

export type EmailDraftSettingsPatch = Partial<Pick<
  EmailDraftSettings,
  'enabled' | 'includeSharingLink' | 'draftPrompt'
>>

type ApiEmailDraftSettings = {
  enabled?: unknown
  include_sharing_link?: unknown
  draft_prompt?: unknown
  created_at?: unknown
  updated_at?: unknown
}

type EmailDraftSettingsResponse = {
  settings?: ApiEmailDraftSettings
  error?: string
}

function toEmailDraftSettings(value: ApiEmailDraftSettings): EmailDraftSettings {
  if (
    typeof value.enabled !== 'boolean'
    || typeof value.include_sharing_link !== 'boolean'
    || typeof value.draft_prompt !== 'string'
  ) {
    throw new Error('Email draft settings are unavailable')
  }
  return {
    enabled: value.enabled,
    includeSharingLink: value.include_sharing_link,
    draftPrompt: value.draft_prompt,
    ...(typeof value.created_at === 'string' ? { createdAt: value.created_at } : {}),
    ...(typeof value.updated_at === 'string' ? { updatedAt: value.updated_at } : {}),
  }
}

async function readEmailDraftSettingsResponse(response: Response): Promise<EmailDraftSettings> {
  const payload = await response.json().catch(() => ({})) as EmailDraftSettingsResponse
  if (!response.ok || !payload.settings) {
    throw new Error(payload.error || 'Email draft settings are unavailable')
  }
  return toEmailDraftSettings(payload.settings)
}

function toApiPatch(patch: EmailDraftSettingsPatch) {
  return {
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.includeSharingLink !== undefined ? { include_sharing_link: patch.includeSharingLink } : {}),
    ...(patch.draftPrompt !== undefined ? { draft_prompt: patch.draftPrompt } : {}),
  }
}

export async function getEmailDraftSettings(signal?: AbortSignal): Promise<EmailDraftSettings> {
  const response = await authenticatedFetch(`${API_BASE_URL}/email-draft-settings`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  return readEmailDraftSettingsResponse(response)
}

export async function patchEmailDraftSettings(patch: EmailDraftSettingsPatch): Promise<EmailDraftSettings> {
  const response = await authenticatedFetch(`${API_BASE_URL}/email-draft-settings`, {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(toApiPatch(patch)),
  })
  return readEmailDraftSettingsResponse(response)
}
