import { describe, expect, it } from 'vitest'

import {
  formatRecordingElapsedTime,
  getRecordingOverlayStatus,
  getTranscriptEmptyMessage,
  shouldFollowLiveTranscript,
} from '@/features/recording/recording-overlay-presenter'
import { createStartingRecording, recordingSessionReducer } from '@/features/recording/recording-state'

describe('recording overlay presentation', () => {
  const starting = createStartingRecording({
    sessionId: 'session-1',
    noteId: 'note-1',
    noteTitle: 'Planning',
    startedAt: 1_000,
  })

  it('formats short and long recording durations', () => {
    expect(formatRecordingElapsedTime(3_000)).toBe('00:03')
    expect(formatRecordingElapsedTime(754_000)).toBe('12:34')
    expect(formatRecordingElapsedTime(3_754_000)).toBe('1:02:34')
  })

  it('distinguishes capture state from degraded transcription', () => {
    const recording = recordingSessionReducer(starting, { type: 'started' })
    const reconnecting = recordingSessionReducer(recording, {
      type: 'set-transcript-phase',
      phase: 'reconnecting',
    })
    const unavailable = recordingSessionReducer(recording, {
      type: 'set-transcript-phase',
      phase: 'unavailable',
    })

    expect(getRecordingOverlayStatus(recording)).toMatchObject({
      label: 'Connecting transcript',
      activityActive: true,
    })
    expect(getRecordingOverlayStatus(reconnecting)).toMatchObject({
      label: 'Reconnecting transcript',
      tone: 'warning',
      activityActive: true,
    })
    expect(getRecordingOverlayStatus(unavailable)).toMatchObject({
      label: 'Recording without transcript',
      activityActive: true,
    })
  })

  it('provides state-specific empty transcript messages', () => {
    expect(getTranscriptEmptyMessage('live')).toBe('Start speaking...')
    expect(getTranscriptEmptyMessage('reconnecting')).toContain('connection returns')
    expect(getTranscriptEmptyMessage('unavailable')).toContain('still recording')
  })

  it('follows new transcript only while the viewport remains near the bottom', () => {
    expect(shouldFollowLiveTranscript(500, 272, 200)).toBe(true)
    expect(shouldFollowLiveTranscript(500, 271, 200)).toBe(false)
  })
})
