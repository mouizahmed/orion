import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

import RecordingOverlay from '@/features/recording/components/RecordingOverlay'
import {
  RecordingUiProvider,
  useRecordingSessionSnapshot,
} from '@/features/recording/RecordingUiContext'
import { createRecordingUiFixture } from '@/features/recording/dev/recording-ui-fixture'
import { createRecordingIpcController } from '@/features/recording/recording-ipc-controller'
import { desktopApi } from '@/lib/desktop-api'
import type { RecordingUiController } from '@/features/recording/recording-types'

type OverlayRecordingController = RecordingUiController & { dispose(): void }

function useOverlayWindowBounds(rootRef: RefObject<HTMLDivElement>) {
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
  }, [rootRef])
}

function useDisposeControllerBeforeUnload(controller: OverlayRecordingController) {
  useEffect(() => {
    const dispose = () => controller.dispose()
    window.addEventListener('beforeunload', dispose)
    return () => window.removeEventListener('beforeunload', dispose)
  }, [controller])
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
  const [controller] = useState<OverlayRecordingController>(createRecordingIpcController)
  const rootRef = useRef<HTMLDivElement>(null)

  useOverlayWindowBounds(rootRef)
  useDisposeControllerBeforeUnload(controller)

  return (
    <RecordingUiProvider controller={controller}>
      <RecordingSurfaceReadyPublisher rootRef={rootRef} />
      <div ref={rootRef} className="w-max p-3">
        <RecordingOverlay />
      </div>
    </RecordingUiProvider>
  )
}

export function RecordingOverlayFixtureApp() {
  const [controller] = useState(() => createRecordingUiFixture({
    autoTranscript: true,
    onShowDashboard: (noteId) => desktopApi.dashboard.open(noteId),
  }))
  const rootRef = useRef<HTMLDivElement>(null)

  useOverlayWindowBounds(rootRef)
  useDisposeControllerBeforeUnload(controller)
  useEffect(() => controller.start(), [controller])

  return (
    <RecordingUiProvider controller={controller}>
      <div ref={rootRef} className="w-max p-3">
        <RecordingOverlay />
      </div>
    </RecordingUiProvider>
  )
}
