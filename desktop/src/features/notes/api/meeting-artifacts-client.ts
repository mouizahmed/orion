import { authenticatedFetch } from '@/features/auth/auth-session'
import { API_BASE_URL } from '@/lib/api-config'

const MAX_ARTIFACT_ITEMS = 100
const MAX_SUMMARY_LENGTH = 16 << 10
const MAX_ITEM_LENGTH = 2_000
const MAX_OWNER_LENGTH = 200
const MAX_DUE_DATE_LENGTH = 100
const MAX_TEMPLATE_NAME_LENGTH = 100
const MAX_ERROR_LENGTH = 500
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface MeetingDecision {
  text: string
}

export interface MeetingActionItem {
  description: string
  owner?: string
  dueDate?: string
}

export interface MeetingArtifacts {
  summary: string
  decisions: MeetingDecision[]
  actionItems: MeetingActionItem[]
}

export interface MeetingArtifactTemplateReference {
  id: string
  name: string
}

export interface MeetingArtifactsResult {
  artifacts: MeetingArtifacts
  summaryTemplate: MeetingArtifactTemplateReference | null
}

export class MeetingArtifactsApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'MeetingArtifactsApiError'
    this.status = status
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function isBoundedString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === 'string' &&
    value === value.trim() &&
    (allowEmpty || value.length > 0) &&
    value.length <= maxLength
}

function decodeDecision(value: unknown): MeetingDecision | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['text']) || !isBoundedString(value.text, MAX_ITEM_LENGTH)) {
    return null
  }
  return { text: value.text }
}

function decodeActionItem(value: unknown): MeetingActionItem | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['description', 'owner', 'due_date']) ||
      !isBoundedString(value.description, MAX_ITEM_LENGTH)) {
    return null
  }
  if (value.owner !== undefined && !isBoundedString(value.owner, MAX_OWNER_LENGTH)) return null
  if (value.due_date !== undefined && !isBoundedString(value.due_date, MAX_DUE_DATE_LENGTH)) return null
  return {
    description: value.description,
    ...(value.owner === undefined ? {} : { owner: value.owner }),
    ...(value.due_date === undefined ? {} : { dueDate: value.due_date }),
  }
}

function decodeArtifacts(value: unknown): MeetingArtifacts | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['summary', 'decisions', 'action_items']) ||
      !isBoundedString(value.summary, MAX_SUMMARY_LENGTH) ||
      !Array.isArray(value.decisions) || value.decisions.length > MAX_ARTIFACT_ITEMS ||
      !Array.isArray(value.action_items) || value.action_items.length > MAX_ARTIFACT_ITEMS) {
    return null
  }
  const decisions = value.decisions.map(decodeDecision)
  const actionItems = value.action_items.map(decodeActionItem)
  if (decisions.some((item) => item === null) || actionItems.some((item) => item === null)) return null
  return {
    summary: value.summary,
    decisions: decisions as MeetingDecision[],
    actionItems: actionItems as MeetingActionItem[],
  }
}

function decodeTemplateReference(value: unknown): MeetingArtifactTemplateReference | null | undefined {
  if (value === null) return null
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'name']) ||
      typeof value.id !== 'string' || !UUID_PATTERN.test(value.id) ||
      !isBoundedString(value.name, MAX_TEMPLATE_NAME_LENGTH)) {
    return undefined
  }
  return { id: value.id, name: value.name }
}

function decodeResponse(value: unknown): MeetingArtifactsResult {
  if (!isRecord(value) || !hasOnlyKeys(value, ['artifacts', 'summary_template'])) {
    throw new Error('Invalid meeting artifact response')
  }
  const artifacts = decodeArtifacts(value.artifacts)
  const summaryTemplate = decodeTemplateReference(value.summary_template)
  if (!artifacts || summaryTemplate === undefined) {
    throw new Error('Invalid meeting artifact response')
  }
  return { artifacts, summaryTemplate }
}

function decodeError(value: unknown): { code?: string; message?: string } {
  if (!isRecord(value)) return {}
  const code = typeof value.code === 'string' && value.code.length <= 100 ? value.code : undefined
  const message = typeof value.error === 'string' && value.error.length <= MAX_ERROR_LENGTH
    ? value.error
    : undefined
  return { code, message }
}

export async function generateMeetingArtifacts(noteId: string, signal?: AbortSignal): Promise<MeetingArtifactsResult> {
  if (!UUID_PATTERN.test(noteId)) throw new Error('Invalid note ID')
  const response = await authenticatedFetch(`${API_BASE_URL}/notes/${encodeURIComponent(noteId)}/meeting-artifacts`, {
    method: 'POST',
    signal,
    headers: { Accept: 'application/json' },
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const failure = decodeError(payload)
    throw new MeetingArtifactsApiError(response.status, failure.message ?? 'Failed to generate meeting artifacts.', failure.code)
  }
  return decodeResponse(payload)
}
