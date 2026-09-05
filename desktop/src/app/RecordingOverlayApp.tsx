import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

import RecordingOverlay from '@/features/recording/components/RecordingOverlay'
import {
  RecordingUiProvider,
  useRecordingSessionSnapshot,
  useRecordingTranscriptSnapshot,
} from '@/features/recording/RecordingUiContext'
import { createRecordingUiFixture } from '@/features/recording/dev/recording-ui-fixture'
import { desktopApi } from '@/lib/desktop-api'
import type { RecordingTranscriptSegment } from '@/features/recording/recording-types'

const OVERLAY_WINDOW_INSET = 20

function RecordingSnapshotPublisher() {
  const session = useRecordingSessionSnapshot()
  const sessionId = session?.sessionId
  const noteId = session?.noteId
  const scope = useMemo(
    () => sessionId && noteId ? { sessionId, noteId } : null,
    [noteId, sessionId],
  )
  const transcript = useRecordingTranscriptSnapshot(scope)
  const publishedSegmentsRef = useRef(new Map<string, RecordingTranscriptSegment>())

  useEffect(() => {
    if (!session) return
    desktopApi.recording.publishSession(session)
  }, [session])

  useEffect(() => {
    if (!session) return
    if (publishedSegmentsRef.current.values().next().value?.sessionId !== session.sessionId) {
      publishedSegmentsRef.current.clear()
    }
    for (const segment of transcript) {
      if (publishedSegmentsRef.current.get(segment.id) === segment) continue
      publishedSegmentsRef.current.set(segment.id, segment)
      desktopApi.recording.publishTranscriptUpdate(segment)
    }
  }, [session, transcript])

  return null
}

function RecordingSurfaceReadyPublisher({ rootRef }: { rootRef: RefObject<HTMLDivElement> }) {
  const session = useRecordingSessionSnapshot()
  const sessionId = session?.sessionId

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !sessionId) return
    const bounds = root.getBoundingClientRect()
    // IPC messages from one renderer are ordered: main applies these bounds
    // before it handles the ready signal and reveals the hidden overlay.
    desktopApi.window.setWindowSize(Math.ceil(bounds.width), Math.ceil(bounds.height))
    desktopApi.recording.markSurfaceReady(sessionId)
  }, [rootRef, sessionId])

  return null
}

export default function RecordingOverlayApp() {
  const [controller] = useState(() => createRecordingUiFixture({
    autoTranscript: true,
    onShowDashboard: (noteId) => desktopApi.dashboard.open(noteId),
  }))
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => desktopApi.recording.onStart((input) => {
    controller.start(input)
  }), [controller])

  useEffect(() => desktopApi.recording.onStop(({ stoppedAt }) => {
    void controller.stop(stoppedAt)
  }), [controller])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const updateWindowBounds = () => {
      const bounds = root.getBoundingClientRect()
      desktopApi.window.setWindowSize(Math.ceil(bounds.width), Math.ceil(bounds.height))
    }

    updateWindowBounds()
    const observer = new ResizeObserver(updateWindowBounds)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const dispose = () => controller.dispose()
    window.addEventListener('beforeunload', dispose)
    return () => window.removeEventListener('beforeunload', dispose)
  }, [controller])

  return (
    <RecordingUiProvider controller={controller}>
      <RecordingSnapshotPublisher />
      <RecordingSurfaceReadyPublisher rootRef={rootRef} />
      <div ref={rootRef} className="w-max" style={{ padding: OVERLAY_WINDOW_INSET }}>
        <RecordingOverlay />
      </div>
    </RecordingUiProvider>
  )
}
