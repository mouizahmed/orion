import type {
  RecordingPhase,
  RecordingSessionSnapshot,
  RecordingTranscriptSegment,
  TranscriptPhase,
} from '@/features/recording/recording-types'

export type StartRecordingInput = {
  sessionId: string
  noteId: string
  noteTitle: string
  startedAt: number
}

export type RecordingSessionAction =
  | { type: 'started' }
  | { type: 'stop'; now: number }
  | { type: 'finalize' }
  | { type: 'complete' }
  | { type: 'fail'; message: string }
  | { type: 'set-transcript-phase'; phase: TranscriptPhase }
  | { type: 'set-microphone-muted'; muted: boolean }
  | { type: 'set-system-audio-muted'; muted: boolean }

export type RecordingTranscriptUpdate = RecordingTranscriptSegment

export function createStartingRecording(input: StartRecordingInput): RecordingSessionSnapshot {
  return {
    sessionId: input.sessionId,
    noteId: input.noteId,
    noteTitle: input.noteTitle,
    phase: 'starting',
    transcriptPhase: 'connecting',
    startedAt: input.startedAt,
    stoppedAt: null,
    micMuted: false,
    systemAudioMuted: false,
    recoverableError: null,
  }
}

function canStop(phase: RecordingPhase) {
  return phase === 'starting' || phase === 'recording' || phase === 'error'
}

export function recordingSessionReducer(
  state: RecordingSessionSnapshot,
  action: RecordingSessionAction,
): RecordingSessionSnapshot {
  switch (action.type) {
    case 'started':
      return state.phase === 'starting'
        ? { ...state, phase: 'recording', recoverableError: null }
        : state
    case 'stop': {
      if (!canStop(state.phase)) return state
      return {
        ...state,
        phase: 'stopping',
        stoppedAt: action.now,
        recoverableError: null,
      }
    }
    case 'finalize':
      return state.phase === 'stopping'
        ? { ...state, phase: 'finalizing', transcriptPhase: 'finalizing' }
        : state
    case 'complete':
      return state.phase === 'finalizing'
        ? { ...state, phase: 'complete', transcriptPhase: 'complete' }
        : state
    case 'fail':
      if (state.phase === 'complete') return state
      return { ...state, phase: 'error', recoverableError: action.message }
    case 'set-transcript-phase':
      return state.phase === 'complete' && action.phase !== 'complete'
        ? state
        : { ...state, transcriptPhase: action.phase }
    case 'set-microphone-muted':
      return { ...state, micMuted: action.muted }
    case 'set-system-audio-muted':
      return { ...state, systemAudioMuted: action.muted }
  }
}

export function getRecordingElapsedMs(session: RecordingSessionSnapshot, now: number): number {
  const end = session.stoppedAt ?? now
  return Math.max(0, end - session.startedAt)
}

export function isRecordingCaptureActive(session: RecordingSessionSnapshot | null): boolean {
  return session !== null && (
    session.phase === 'starting'
    || session.phase === 'recording'
    || session.phase === 'stopping'
  )
}

export function isRecordingForNote(
  session: RecordingSessionSnapshot | null,
  noteId: string | null | undefined,
): boolean {
  return Boolean(noteId && session?.noteId === noteId && isRecordingCaptureActive(session))
}

export function applyRecordingTranscriptUpdate(
  segments: readonly RecordingTranscriptSegment[],
  update: RecordingTranscriptUpdate,
): readonly RecordingTranscriptSegment[] {
  const existingIndex = segments.findIndex((segment) => segment.id === update.id)
  if (existingIndex >= 0 && segments[existingIndex] === update) return segments

  const next = existingIndex >= 0
    ? segments.map((segment, index) => index === existingIndex ? update : segment)
    : [...segments, update]

  return next.sort((left, right) => (
    left.sequence - right.sequence
    || left.createdAt - right.createdAt
    || left.id.localeCompare(right.id)
  ))
}
