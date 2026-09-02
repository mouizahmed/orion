import { useEffect, useState } from 'react'

import { getRecordingElapsedMs } from '@/features/recording/recording-state'
import type { RecordingSessionSnapshot } from '@/features/recording/recording-types'

export function useRecordingElapsedTime(session: RecordingSessionSnapshot) {
  const [now, setNow] = useState(Date.now)
  const ticking = session.phase === 'starting'
    || session.phase === 'recording'
    || (session.phase === 'error' && session.stoppedAt === null)

  useEffect(() => {
    setNow(Date.now())
    if (!ticking) return

    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [session.phase, ticking])

  return getRecordingElapsedMs(session, now)
}
