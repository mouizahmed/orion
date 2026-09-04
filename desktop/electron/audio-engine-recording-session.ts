import { getCurrentAuthTokenForRequest } from './auth-handlers'
import { config } from './config'

const RECORDINGS_PATH = '/api/recordings'
const REQUEST_TIMEOUT_MS = 10_000
const RECOVERY_REQUEST_TIMEOUT_MS = 30 * 60 * 1_000
const MAX_ERROR_BODY_BYTES = 64 * 1024
const MAX_RESPONSE_BODY_BYTES = 64 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type BackendRecordingStatus =
  | 'starting'
  | 'recording'
  | 'finalizing'
  | 'complete'
  | 'failed'
  | 'abandoned'

export type BackendRecordingAudioStored = 'none' | 'local' | 'cloud'

export type BackendRecordingSession = {
  id: string
  noteId: string
  userId: string
  clientSessionId: string
  status: BackendRecordingStatus
  startedAt: string
  stoppedAt: string | null
  lastActivityAt: string
  finalizedAt: string | null
  audioStored: BackendRecordingAudioStored
}

export type BackendRecordingTransition =
  | { status: 'recording' }
  | { status: 'failed' }

export type AudioEngineRecordingSessionClient = {
  create(noteId: string, clientSessionId: string): Promise<BackendRecordingSession>
  getActive(): Promise<BackendRecordingSession | null>
  recover(session: BackendRecordingSession): Promise<BackendRecordingSession>
  finalize(
    session: BackendRecordingSession,
    audioStored: BackendRecordingAudioStored,
  ): Promise<BackendRecordingSession>
  transition(
    session: BackendRecordingSession,
    transition: BackendRecordingTransition,
  ): Promise<BackendRecordingSession>
}

export class RecordingSessionRequestError extends Error {
  readonly status: number | null
  readonly code: string

  constructor(message: string, code: string, status: number | null = null) {
    super(message)
    this.name = 'RecordingSessionRequestError'
    this.code = code
    this.status = status
  }
}

export function createAudioEngineRecordingSessionClient(): AudioEngineRecordingSessionClient {
  return {
    async getActive() {
      const response = await authenticatedRecordingRequest(`${RECORDINGS_PATH}/active`, {
        method: 'GET',
      })
      return readOptionalRecordingSessionResponse(response)
    },

    async create(noteId, clientSessionId) {
      assertUUID(noteId, 'note ID')
      assertUUID(clientSessionId, 'client session ID')
      const response = await authenticatedRecordingRequest(RECORDINGS_PATH, {
        method: 'POST',
        body: JSON.stringify({
          note_id: noteId,
          client_session_id: clientSessionId,
        }),
      })
      const session = await readRecordingSessionResponse(response)
      if (
        session.noteId !== noteId.toLowerCase()
        || session.clientSessionId !== clientSessionId.toLowerCase()
        || session.status !== 'starting'
      ) {
        throw invalidResponse('Created recording session does not match the request')
      }
      return session
    },

    finalize(session, audioStored) {
      return finalizeRecordingSession(session, audioStored, REQUEST_TIMEOUT_MS)
    },

    recover(session) {
      return finalizeRecordingSession(session, 'cloud', RECOVERY_REQUEST_TIMEOUT_MS)
    },

    async transition(session, transition) {
      assertRecordingSession(session)
      const response = await authenticatedRecordingRequest(
        `${RECORDINGS_PATH}/${encodeURIComponent(session.id)}`,
        { method: 'PATCH', body: JSON.stringify({ status: transition.status }) },
      )
      const updated = await readRecordingSessionResponse(response)
      if (
        updated.id !== session.id
        || updated.noteId !== session.noteId
        || updated.userId !== session.userId
        || updated.clientSessionId !== session.clientSessionId
        || updated.status !== transition.status
      ) {
        throw invalidResponse('Updated recording session does not match the request')
      }
      return updated
    },
  }
}

async function authenticatedRecordingRequest(
  pathname: string,
  init: Pick<RequestInit, 'method' | 'body'>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const send = async (forceRefresh: boolean) => {
    let token: string
    try {
      token = await getCurrentAuthTokenForRequest(forceRefresh)
    } catch {
      throw new RecordingSessionRequestError(
        'Recording authentication is unavailable',
        'recording_auth_unavailable',
      )
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch(`${config.backendUrl}${pathname}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new RecordingSessionRequestError(
          'Recording service request timed out',
          'recording_request_timeout',
        )
      }
      throw new RecordingSessionRequestError(
        'Recording service is unavailable',
        'recording_service_unavailable',
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  let response = await send(false)
  if (response.status === 401) response = await send(true)
  if (!response.ok) throw await responseError(response)
  return response
}

async function finalizeRecordingSession(
  session: BackendRecordingSession,
  audioStored: BackendRecordingAudioStored,
  timeoutMs: number,
): Promise<BackendRecordingSession> {
  assertRecordingSession(session)
  audioStoredField(audioStored)
  const response = await authenticatedRecordingRequest(
    `${RECORDINGS_PATH}/${encodeURIComponent(session.id)}/finalize`,
    { method: 'POST', body: JSON.stringify({ audio_stored: audioStored }) },
    timeoutMs,
  )
  const finalized = await readRecordingSessionResponse(response)
  if (
    finalized.id !== session.id
    || finalized.noteId !== session.noteId
    || finalized.userId !== session.userId
    || finalized.clientSessionId !== session.clientSessionId
    || finalized.status !== 'complete'
    || !(
      finalized.audioStored === audioStored
      || (audioStored === 'cloud' && finalized.audioStored === 'none')
    )
  ) {
    throw invalidResponse('Finalized recording session does not match the request')
  }
  return finalized
}

async function responseError(response: Response): Promise<RecordingSessionRequestError> {
  const fallback = response.status === 409
    ? 'Recording request conflicts with the current session'
    : response.status === 401 || response.status === 403
      ? 'Recording request is not authorized'
      : 'Recording request failed'
  let code = `recording_http_${response.status}`
  let message = fallback
  try {
    const body = await response.text()
    if (Buffer.byteLength(body, 'utf8') <= MAX_ERROR_BODY_BYTES) {
      const parsed: unknown = JSON.parse(body)
      if (isRecord(parsed)) {
        if (typeof parsed.code === 'string' && parsed.code.trim()) code = parsed.code
        if (typeof parsed.error === 'string' && parsed.error.trim()) message = parsed.error
      }
    }
  } catch {
    // Preserve the sanitized fallback for malformed or oversized error bodies.
  }
  return new RecordingSessionRequestError(message, code, response.status)
}

async function readRecordingSessionResponse(response: Response): Promise<BackendRecordingSession> {
  const session = await readOptionalRecordingSessionResponse(response)
  if (!session) throw invalidResponse('Recording service returned no session')
  return session
}

async function readOptionalRecordingSessionResponse(
  response: Response,
): Promise<BackendRecordingSession | null> {
  let payload: unknown
  try {
    const body = await response.text()
    if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BODY_BYTES) {
      throw invalidResponse('Recording service response exceeds the size limit')
    }
    payload = JSON.parse(body)
  } catch (error) {
    if (error instanceof RecordingSessionRequestError) throw error
    throw invalidResponse('Recording service returned malformed JSON')
  }
  if (!isRecord(payload) || !('session' in payload)) {
    throw invalidResponse('Recording service returned no session field')
  }
  if (payload.session === null) return null
  if (!isRecord(payload.session)) throw invalidResponse('Recording service returned an invalid session')
  return parseRecordingSession(payload.session)
}

function parseRecordingSession(value: Record<string, unknown>): BackendRecordingSession {
  const stoppedAt = nullableTimestamp(value.stopped_at, 'stopped_at')
  const finalizedAt = nullableTimestamp(value.finalized_at, 'finalized_at')
  const session: BackendRecordingSession = {
    id: uuidField(value.id, 'id'),
    noteId: uuidField(value.note_id, 'note_id'),
    userId: uuidField(value.user_id, 'user_id'),
    clientSessionId: uuidField(value.client_session_id, 'client_session_id'),
    status: statusField(value.status),
    startedAt: timestampField(value.started_at, 'started_at'),
    stoppedAt,
    lastActivityAt: timestampField(value.last_activity_at, 'last_activity_at'),
    finalizedAt,
    audioStored: audioStoredField(value.audio_stored),
  }
  assertRecordingSession(session)
  return session
}

function assertRecordingSession(session: BackendRecordingSession): void {
  assertUUID(session.id, 'recording ID')
  assertUUID(session.noteId, 'recording note ID')
  assertUUID(session.userId, 'recording user ID')
  assertUUID(session.clientSessionId, 'recording client session ID')
  statusField(session.status)
  timestampField(session.startedAt, 'recording start time')
  nullableTimestamp(session.stoppedAt, 'recording stop time')
  timestampField(session.lastActivityAt, 'recording activity time')
  nullableTimestamp(session.finalizedAt, 'recording finalization time')
  audioStoredField(session.audioStored)
}

function uuidField(value: unknown, field: string): string {
  if (typeof value !== 'string') throw invalidResponse(`Recording session ${field} is invalid`)
  assertUUID(value, field)
  return value.toLowerCase()
}

function assertUUID(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new RecordingSessionRequestError(
      `Recording ${field} is invalid`,
      'invalid_recording_identity',
    )
  }
}

function statusField(value: unknown): BackendRecordingStatus {
  if (
    value === 'starting'
    || value === 'recording'
    || value === 'finalizing'
    || value === 'complete'
    || value === 'failed'
    || value === 'abandoned'
  ) return value
  throw invalidResponse('Recording session status is invalid')
}

function audioStoredField(value: unknown): BackendRecordingAudioStored {
  if (value === 'none' || value === 'local' || value === 'cloud') return value
  throw invalidResponse('Recording session audio storage state is invalid')
}

function timestampField(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw invalidResponse(`Recording session ${field} is invalid`)
  }
  return value
}

function nullableTimestamp(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null
  return timestampField(value, field)
}

function invalidResponse(message: string): RecordingSessionRequestError {
  return new RecordingSessionRequestError(message, 'invalid_recording_response')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
