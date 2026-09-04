import { applyRecordingTranscriptUpdate } from '@/features/recording/recording-state'
import type {
  RecordingSessionListener,
  RecordingSessionSnapshot,
  RecordingTranscriptListener,
  RecordingTranscriptScope,
  RecordingTranscriptSegment,
  RecordingUiController,
} from '@/features/recording/recording-types'
import { desktopApi } from '@/lib/desktop-api'

const EMPTY_TRANSCRIPT = [] as const

type SourceMuteCommand = (muted: boolean) => Promise<void>

export type RecordingIpcControllerOptions = {
  setMicrophoneMuted?: SourceMuteCommand
  setSystemAudioMuted?: SourceMuteCommand
  onLoadError?: (error: unknown) => void
}

export type RecordingIpcController = RecordingUiController & {
  dispose(): void
}

function scopeKey(scope: RecordingTranscriptScope) {
  return `${scope.sessionId}:${scope.noteId}`
}

function sameScope(
  session: RecordingSessionSnapshot | null,
  scope: RecordingTranscriptScope,
) {
  return session?.sessionId === scope.sessionId && session.noteId === scope.noteId
}

/**
 * Renderer mirror of the main-owned recording session. It subscribes before
 * requesting the initial snapshot so updates cannot be lost during renderer
 * startup, then merges newer event deltas over that initial snapshot.
 */
export function createRecordingIpcController(
  options: RecordingIpcControllerOptions = {},
): RecordingIpcController {
  const sessionListeners = new Set<RecordingSessionListener>()
  const transcriptListeners = new Map<string, Set<RecordingTranscriptListener>>()
  const transcriptSnapshots = new Map<string, readonly RecordingTranscriptSegment[]>()
  let session: RecordingSessionSnapshot | null = null
  let receivedSessionEvent = false
  let disposed = false

  const notifySession = () => {
    for (const listener of sessionListeners) listener()
  }

  const notifyTranscript = (scope: RecordingTranscriptScope) => {
    for (const listener of transcriptListeners.get(scopeKey(scope)) ?? []) listener()
  }

  const putTranscriptUpdate = (segment: RecordingTranscriptSegment) => {
    const scope = { sessionId: segment.sessionId, noteId: segment.noteId }
    const key = scopeKey(scope)
    const current = transcriptSnapshots.get(key) ?? EMPTY_TRANSCRIPT
    const next = applyRecordingTranscriptUpdate(current, segment)
    if (next === current) return
    transcriptSnapshots.set(key, next)
    notifyTranscript(scope)
  }

  const unsubscribeSession = desktopApi.recording.onSession((next) => {
    if (disposed) return
    receivedSessionEvent = true
    session = next
    notifySession()
  })

  const unsubscribeTranscript = desktopApi.recording.onTranscriptUpdate((segment) => {
    if (disposed) return
    if (session && !sameScope(session, segment)) return
    putTranscriptUpdate(segment)
  })

  void desktopApi.recording.getSnapshot().then((initial) => {
    if (disposed) return

    if (!receivedSessionEvent) {
      session = initial.session
      notifySession()
    }

    if (!initial.session || !sameScope(session, initial.session)) return
    const scope = {
      sessionId: initial.session.sessionId,
      noteId: initial.session.noteId,
    }
    const key = scopeKey(scope)
    const eventUpdates = transcriptSnapshots.get(key) ?? EMPTY_TRANSCRIPT
    let merged = initial.transcript
    for (const segment of eventUpdates) {
      merged = applyRecordingTranscriptUpdate(merged, segment)
    }
    if (merged === transcriptSnapshots.get(key)) return
    transcriptSnapshots.set(key, merged)
    notifyTranscript(scope)
  }).catch((error: unknown) => {
    if (disposed) return
    if (options.onLoadError) {
      options.onLoadError(error)
      return
    }
    console.error('Failed to load recording UI snapshot', error)
  })

  const setMicrophoneMuted = options.setMicrophoneMuted
    ?? desktopApi.recording.setMicrophoneMuted
  const setSystemAudioMuted = options.setSystemAudioMuted
    ?? desktopApi.recording.setSystemAudioMuted

  return {
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
    stop: () => desktopApi.recording.stop(),
    setMicrophoneMuted,
    setSystemAudioMuted,
    showOverlay: () => desktopApi.recording.showOverlay(),
    async showDashboard() {
      desktopApi.dashboard.open(session?.noteId)
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribeSession()
      unsubscribeTranscript()
      sessionListeners.clear()
      transcriptListeners.clear()
      transcriptSnapshots.clear()
      session = null
    },
  }
}
