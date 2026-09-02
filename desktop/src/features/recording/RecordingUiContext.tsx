import {
  createContext,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from 'react'

import type {
  RecordingTranscriptScope,
  RecordingUiController,
} from '@/features/recording/recording-types'

const RecordingUiContext = createContext<RecordingUiController | null>(null)
const EMPTY_TRANSCRIPT = [] as const

export function RecordingUiProvider({
  children,
  controller,
}: {
  children: ReactNode
  controller: RecordingUiController
}) {
  return (
    <RecordingUiContext.Provider value={controller}>
      {children}
    </RecordingUiContext.Provider>
  )
}

export function useRecordingUiController() {
  const controller = useContext(RecordingUiContext)
  if (!controller) throw new Error('useRecordingUiController must be used within RecordingUiProvider')
  return controller
}

export function useRecordingSessionSnapshot() {
  const controller = useRecordingUiController()
  return useSyncExternalStore(
    (listener) => controller.subscribeSession(listener),
    () => controller.getSessionSnapshot(),
    () => null,
  )
}

export function useRecordingTranscriptSnapshot(scope: RecordingTranscriptScope | null) {
  const controller = useRecordingUiController()
  return useSyncExternalStore(
    (listener) => scope ? controller.subscribeTranscript(scope, listener) : () => undefined,
    () => scope ? controller.getTranscriptSnapshot(scope) : EMPTY_TRANSCRIPT,
    () => EMPTY_TRANSCRIPT,
  )
}
