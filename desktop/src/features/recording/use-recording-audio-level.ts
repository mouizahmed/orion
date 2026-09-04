import { useSyncExternalStore } from 'react'

import type { RecordingAudioLevels } from '@/features/recording/recording-types'
import { desktopApi } from '@/lib/desktop-api'

let latestLevels: RecordingAudioLevels | null = null
let unsubscribeFromIpc: (() => void) | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!unsubscribeFromIpc) {
    unsubscribeFromIpc = desktopApi.recording.onAudioLevels((levels) => {
      latestLevels = levels
      for (const notify of listeners) notify()
    })
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      unsubscribeFromIpc?.()
      unsubscribeFromIpc = null
      latestLevels = null
    }
  }
}

const getSnapshot = () => latestLevels
const getServerSnapshot = () => null

export function useRecordingAudioLevel(sessionId: string | null) {
  const levels = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  if (!levels || levels.sessionId !== sessionId) return 0
  return Math.max(levels.microphoneRms, levels.systemRms)
}
