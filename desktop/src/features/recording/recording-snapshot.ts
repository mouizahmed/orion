import type {
  RecordingPhase,
  RecordingSessionSnapshot,
  RecordingTranscriptSegment,
  RecordingUiSnapshot,
  TranscriptPhase,
} from '@/features/recording/recording-types'

const RECORDING_PHASES = new Set<RecordingPhase>([
  'starting',
  'recording',
  'stopping',
  'finalizing',
  'complete',
  'error',
])

const TRANSCRIPT_PHASES = new Set<TranscriptPhase>([
  'idle',
  'connecting',
  'live',
  'reconnecting',
  'unavailable',
  'finalizing',
  'complete',
])

const ALLOWED_PHASE_UPDATES: Record<RecordingPhase, ReadonlySet<RecordingPhase>> = {
  starting: new Set(['starting', 'recording', 'stopping', 'error']),
  recording: new Set(['recording', 'stopping', 'error']),
  stopping: new Set(['stopping', 'finalizing', 'error']),
  finalizing: new Set(['finalizing', 'complete', 'error']),
  complete: new Set(['complete']),
  error: new Set(['error', 'recording', 'stopping']),
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isRecordingSessionSnapshot(value: unknown): value is RecordingSessionSnapshot {
  if (!isRecord(value)) return false
  return typeof value.sessionId === 'string'
    && value.sessionId.length > 0
    && typeof value.noteId === 'string'
    && value.noteId.length > 0
    && typeof value.noteTitle === 'string'
    && RECORDING_PHASES.has(value.phase as RecordingPhase)
    && TRANSCRIPT_PHASES.has(value.transcriptPhase as TranscriptPhase)
    && isFiniteNumber(value.startedAt)
    && (value.stoppedAt === null || isFiniteNumber(value.stoppedAt))
    && typeof value.micMuted === 'boolean'
    && typeof value.systemAudioMuted === 'boolean'
    && (value.recoverableError === null || typeof value.recoverableError === 'string')
}

export function isRecordingTranscriptSegment(value: unknown): value is RecordingTranscriptSegment {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.sessionId === 'string'
    && typeof value.noteId === 'string'
    && Number.isInteger(value.sequence)
    && (value.source === 'microphone' || value.source === 'system')
    && typeof value.text === 'string'
    && isFiniteNumber(value.startTime)
    && (value.endTime === null || isFiniteNumber(value.endTime))
    && isFiniteNumber(value.createdAt)
    && typeof value.isFinal === 'boolean'
}

export function isRecordingUiSnapshot(value: unknown): value is RecordingUiSnapshot {
  if (!isRecord(value) || !Array.isArray(value.transcript)) return false
  const session = value.session
  if (session === null) return value.transcript.length === 0
  if (!isRecordingSessionSnapshot(session)) return false

  return value.transcript.every((segment) => (
    isRecordingTranscriptSegment(segment)
    && segment.sessionId === session.sessionId
    && segment.noteId === session.noteId
  ))
}

export function canApplyRecordingUiSnapshot(
  current: RecordingUiSnapshot,
  next: RecordingUiSnapshot,
): boolean {
  // Renderer lifetime never owns session lifetime. Main performs explicit
  // recovery/reset transitions; a renderer may only advance an existing session.
  if (!next.session) return false
  if (!current.session) return next.session.phase === 'starting'
  if (
    current.session.sessionId !== next.session.sessionId
    || current.session.noteId !== next.session.noteId
    || current.session.startedAt !== next.session.startedAt
  ) {
    return false
  }

  return ALLOWED_PHASE_UPDATES[current.session.phase].has(next.session.phase)
}
