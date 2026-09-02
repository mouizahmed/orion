import type {
  RecordingPhase,
  RecordingSessionSnapshot,
  TranscriptPhase,
} from '@/features/recording/recording-types'

export type RecordingStatusTone = 'live' | 'working' | 'warning' | 'error' | 'complete'

export type RecordingOverlayStatus = {
  label: string
  tone: RecordingStatusTone
  activityActive: boolean
}

const RECORDING_PHASE_STATUS: Record<RecordingPhase, RecordingOverlayStatus> = {
  starting: { label: 'Starting', tone: 'working', activityActive: false },
  recording: { label: 'Listening', tone: 'live', activityActive: true },
  stopping: { label: 'Stopping', tone: 'working', activityActive: false },
  finalizing: { label: 'Finalizing', tone: 'working', activityActive: false },
  complete: { label: 'Complete', tone: 'complete', activityActive: false },
  error: { label: 'Recording interrupted', tone: 'error', activityActive: false },
}

export function getRecordingOverlayStatus(
  session: RecordingSessionSnapshot,
): RecordingOverlayStatus {
  if (session.phase !== 'recording') return RECORDING_PHASE_STATUS[session.phase]

  if (session.transcriptPhase === 'connecting') {
    return { label: 'Connecting transcript', tone: 'working', activityActive: true }
  }
  if (session.transcriptPhase === 'reconnecting') {
    return { label: 'Reconnecting transcript', tone: 'warning', activityActive: true }
  }
  if (session.transcriptPhase === 'unavailable') {
    return { label: 'Recording without transcript', tone: 'warning', activityActive: true }
  }

  return RECORDING_PHASE_STATUS.recording
}

export function getTranscriptEmptyMessage(phase: TranscriptPhase): string {
  switch (phase) {
    case 'idle':
    case 'connecting':
      return 'Getting the transcript ready...'
    case 'live':
      return 'Start speaking...'
    case 'reconnecting':
      return 'Transcript will continue when the connection returns.'
    case 'unavailable':
      return 'Audio is still recording. Live transcript is unavailable.'
    case 'finalizing':
      return 'Finishing the transcript...'
    case 'complete':
      return 'No transcript was captured.'
  }
}

export function formatRecordingElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const mm = minutes.toString().padStart(2, '0')
  const ss = seconds.toString().padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

export function shouldFollowLiveTranscript(
  scrollHeight: number,
  scrollTop: number,
  clientHeight: number,
) {
  return scrollHeight - scrollTop - clientHeight <= 28
}
