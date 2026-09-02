import {
  applyRecordingTranscriptUpdate,
  createStartingRecording,
  recordingSessionReducer,
} from '@/features/recording/recording-state'
import type {
  RecordingSessionListener,
  RecordingSessionSnapshot,
  RecordingSurface,
  RecordingTranscriptListener,
  RecordingTranscriptScope,
  RecordingTranscriptSegment,
  RecordingUiController,
  TranscriptPhase,
} from '@/features/recording/recording-types'

const FIXTURE_TRANSCRIPT = [
  { source: 'system', text: 'Let us review the launch timeline and the remaining dependencies.' },
  { source: 'microphone', text: 'The design review is complete, so engineering can begin this week.' },
  { source: 'system', text: 'I will confirm the rollout date with the customer success team.' },
  { source: 'microphone', text: 'Great. I will capture that as the next action item.' },
] as const
const EMPTY_TRANSCRIPT = [] as const

type FixtureTimer = ReturnType<typeof setTimeout>

export type StartFixtureRecordingInput = {
  sessionId?: string
  noteId?: string
  noteTitle?: string
  startedAt?: number
}

export interface RecordingUiFixtureController extends RecordingUiController {
  start(input?: StartFixtureRecordingInput): void
  pushInterim(text: string, source?: 'microphone' | 'system'): string
  commitInterim(id: string, text?: string): void
  simulateTranscriptPhase(phase: TranscriptPhase): void
  fail(message: string): void
  getVisibleSurface(): RecordingSurface
  dispose(): void
}

export type RecordingUiFixtureOptions = {
  now?: () => number
  autoTranscript?: boolean
  startDelayMs?: number
  transcriptIntervalMs?: number
  finalizationDelayMs?: number
  onShowDashboard?: (noteId: string) => void
}

function scopeKey(scope: RecordingTranscriptScope) {
  return `${scope.sessionId}:${scope.noteId}`
}

export function createRecordingUiFixture(
  options: RecordingUiFixtureOptions = {},
): RecordingUiFixtureController {
  const now = options.now ?? Date.now
  const autoTranscript = options.autoTranscript ?? true
  const startDelayMs = options.startDelayMs ?? 250
  const transcriptIntervalMs = options.transcriptIntervalMs ?? 1_400
  const finalizationDelayMs = options.finalizationDelayMs ?? 600
  const sessionListeners = new Set<RecordingSessionListener>()
  const transcriptListeners = new Map<string, Set<RecordingTranscriptListener>>()
  const transcriptSnapshots = new Map<string, readonly RecordingTranscriptSegment[]>()
  const timers = new Set<FixtureTimer>()
  let session: RecordingSessionSnapshot | null = null
  let visibleSurface: RecordingSurface = 'dashboard'
  let transcriptIndex = 0
  let pendingSequence = 0
  let transcriptLoopPending = false

  const schedule = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      callback()
    }, delay)
    timers.add(timer)
    return timer
  }

  const clearTimers = () => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    transcriptLoopPending = false
  }

  const notifySession = () => {
    for (const listener of sessionListeners) listener()
  }

  const notifyTranscript = (scope: RecordingTranscriptScope) => {
    for (const listener of transcriptListeners.get(scopeKey(scope)) ?? []) listener()
  }

  const updateSession = (action: Parameters<typeof recordingSessionReducer>[1]) => {
    if (!session) return
    const next = recordingSessionReducer(session, action)
    if (next === session) return
    session = next
    notifySession()
  }

  const currentScope = (): RecordingTranscriptScope | null => session
    ? { sessionId: session.sessionId, noteId: session.noteId }
    : null

  const putTranscriptUpdate = (update: RecordingTranscriptSegment) => {
    const scope = { sessionId: update.sessionId, noteId: update.noteId }
    const key = scopeKey(scope)
    const current = transcriptSnapshots.get(key) ?? []
    const next = applyRecordingTranscriptUpdate(current, update)
    if (next === current) return
    transcriptSnapshots.set(key, next)
    notifyTranscript(scope)
  }

  const pushInterim = (
    text: string,
    source: 'microphone' | 'system' = 'system',
  ) => {
    if (!session) throw new Error('Cannot add transcript without a fixture recording')
    const id = `fixture-segment-${pendingSequence}`
    const timestamp = now()
    putTranscriptUpdate({
      id,
      sessionId: session.sessionId,
      noteId: session.noteId,
      sequence: pendingSequence,
      source,
      text,
      startTime: Math.max(0, (timestamp - session.startedAt) / 1_000),
      endTime: null,
      createdAt: timestamp,
      isFinal: false,
    })
    pendingSequence += 1
    return id
  }

  const commitInterim = (id: string, text?: string) => {
    const scope = currentScope()
    if (!scope) return
    const existing = (transcriptSnapshots.get(scopeKey(scope)) ?? [])
      .find((segment) => segment.id === id)
    if (!existing) return
    putTranscriptUpdate({
      ...existing,
      text: text ?? existing.text,
      endTime: Math.max(existing.startTime, (now() - (session?.startedAt ?? now())) / 1_000),
      isFinal: true,
    })
  }

  const queueNextTranscript = () => {
    if (!autoTranscript || transcriptLoopPending || transcriptIndex >= FIXTURE_TRANSCRIPT.length) return
    transcriptLoopPending = true
    schedule(() => {
      if (!session || session.phase === 'stopping' || session.phase === 'finalizing' || session.phase === 'complete') {
        transcriptLoopPending = false
        return
      }
      if (session.transcriptPhase !== 'live') {
        transcriptLoopPending = false
        queueNextTranscript()
        return
      }

      const line = FIXTURE_TRANSCRIPT[transcriptIndex]
      transcriptIndex += 1
      const id = pushInterim(line.text.slice(0, Math.max(12, Math.floor(line.text.length * 0.65))), line.source)
      schedule(() => {
        commitInterim(id, line.text)
        transcriptLoopPending = false
        queueNextTranscript()
      }, 350)
    }, transcriptIntervalMs)
  }

  const controller: RecordingUiFixtureController = {
    getSessionSnapshot: () => session,
    subscribeSession(listener) {
      sessionListeners.add(listener)
      return () => sessionListeners.delete(listener)
    },
    getTranscriptSnapshot(scope) {
      return transcriptSnapshots.get(scopeKey(scope)) ?? EMPTY_TRANSCRIPT
    },
    subscribeTranscript(scope, listener) {
      const key = scopeKey(scope)
      const listeners = transcriptListeners.get(key) ?? new Set<RecordingTranscriptListener>()
      listeners.add(listener)
      transcriptListeners.set(key, listeners)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) transcriptListeners.delete(key)
      }
    },
    start(input = {}) {
      clearTimers()
      transcriptSnapshots.clear()
      transcriptIndex = 0
      pendingSequence = 0
      transcriptLoopPending = false
      const timestamp = input.startedAt ?? now()
      session = createStartingRecording({
        sessionId: input.sessionId ?? 'fixture-recording-session',
        noteId: input.noteId ?? 'fixture-recording-note',
        noteTitle: input.noteTitle ?? 'Weekly product sync',
        startedAt: timestamp,
      })
      visibleSurface = 'overlay'
      notifySession()
      schedule(() => {
        updateSession({ type: 'started' })
        updateSession({ type: 'set-transcript-phase', phase: 'live' })
        queueNextTranscript()
      }, startDelayMs)
    },
    pushInterim,
    commitInterim,
    simulateTranscriptPhase(phase) {
      updateSession({ type: 'set-transcript-phase', phase })
      if (phase === 'live') queueNextTranscript()
    },
    fail(message) {
      updateSession({ type: 'fail', message })
    },
    async stop(stoppedAt) {
      if (!session) return
      const next = recordingSessionReducer(session, { type: 'stop', now: stoppedAt ?? now() })
      if (next === session) return
      clearTimers()
      session = next
      notifySession()
      schedule(() => {
        visibleSurface = 'dashboard'
        updateSession({ type: 'finalize' })
        schedule(() => {
          updateSession({ type: 'complete' })
        }, finalizationDelayMs)
      }, 0)
    },
    async setMicrophoneMuted(muted) {
      updateSession({ type: 'set-microphone-muted', muted })
    },
    async setSystemAudioMuted(muted) {
      updateSession({ type: 'set-system-audio-muted', muted })
    },
    async showOverlay() {
      if (!session || session.phase === 'complete') return
      visibleSurface = 'overlay'
    },
    async showDashboard() {
      visibleSurface = 'dashboard'
      if (session) options.onShowDashboard?.(session.noteId)
    },
    getVisibleSurface: () => visibleSurface,
    dispose() {
      clearTimers()
      sessionListeners.clear()
      transcriptListeners.clear()
      transcriptSnapshots.clear()
      session = null
    },
  }

  return controller
}
