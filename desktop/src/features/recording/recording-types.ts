export type RecordingPhase =
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'finalizing'
  | 'complete'
  | 'error'

export type TranscriptPhase =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'unavailable'
  | 'finalizing'
  | 'complete'

export type RecordingAudioSource = 'microphone' | 'system'

export type RecordingSessionSnapshot = {
  sessionId: string
  noteId: string
  noteTitle: string
  phase: RecordingPhase
  transcriptPhase: TranscriptPhase
  startedAt: number
  stoppedAt: number | null
  micMuted: boolean
  systemAudioMuted: boolean
  recoverableError: string | null
}

export type RecordingTranscriptSegment = {
  id: string
  sessionId: string
  noteId: string
  sequence: number
  source: RecordingAudioSource
  text: string
  startTime: number
  endTime: number | null
  createdAt: number
  isFinal: boolean
}

export type RecordingTranscriptScope = {
  sessionId: string
  noteId: string
}

export type RecordingUiSnapshot = {
  session: RecordingSessionSnapshot | null
  transcript: readonly RecordingTranscriptSegment[]
}

export type RecordingNoteDraft = {
  sessionId: string
  noteId: string
  value: string
  version: number
}

export type RecordingSurface = 'dashboard' | 'overlay'

export type RecordingSessionListener = () => void
export type RecordingTranscriptListener = () => void

export interface RecordingUiController {
  getSessionSnapshot(): RecordingSessionSnapshot | null
  subscribeSession(listener: RecordingSessionListener): () => void
  getTranscriptSnapshot(scope: RecordingTranscriptScope): readonly RecordingTranscriptSegment[]
  subscribeTranscript(scope: RecordingTranscriptScope, listener: RecordingTranscriptListener): () => void
  stop(stoppedAt?: number): Promise<void>
  setMicrophoneMuted(muted: boolean): Promise<void>
  setSystemAudioMuted(muted: boolean): Promise<void>
  showOverlay(): Promise<void>
  showDashboard(): Promise<void>
}
