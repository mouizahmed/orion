import { describe, expect, it } from 'vitest'

import {
  canApplyRecordingUiSnapshot,
  isRecordingUiSnapshot,
} from '@/features/recording/recording-snapshot'
import type { RecordingUiSnapshot } from '@/features/recording/recording-types'

const starting: RecordingUiSnapshot = {
  session: {
    sessionId: 'session-1',
    noteId: 'note-1',
    noteTitle: 'Planning',
    phase: 'starting',
    transcriptPhase: 'connecting',
    startedAt: 1_000,
    stoppedAt: null,
    micMuted: false,
    systemAudioMuted: false,
    recoverableError: null,
  },
  transcript: [],
}

describe('recording IPC snapshots', () => {
  it('validates transcript scope and required fields', () => {
    expect(isRecordingUiSnapshot(starting)).toBe(true)
    expect(isRecordingUiSnapshot({ session: null, transcript: [] })).toBe(true)
    expect(isRecordingUiSnapshot({ session: null, transcript: [{}] })).toBe(false)
    expect(isRecordingUiSnapshot({
      ...starting,
      transcript: [{
        id: 'segment-1',
        sessionId: 'another-session',
        noteId: 'note-1',
        sequence: 0,
        source: 'system',
        text: 'Hello',
        startTime: 0,
        endTime: null,
        createdAt: 1_000,
        isFinal: false,
      }],
    })).toBe(false)
  })

  it('rejects session replacement and backwards phase transitions', () => {
    const recording: RecordingUiSnapshot = {
      ...starting,
      session: { ...starting.session!, phase: 'recording', transcriptPhase: 'live' },
    }
    const stopping: RecordingUiSnapshot = {
      ...recording,
      session: { ...recording.session!, phase: 'stopping', stoppedAt: 2_000 },
    }

    expect(canApplyRecordingUiSnapshot(starting, recording)).toBe(true)
    expect(canApplyRecordingUiSnapshot(recording, stopping)).toBe(true)
    expect(canApplyRecordingUiSnapshot(stopping, recording)).toBe(false)
    expect(canApplyRecordingUiSnapshot(recording, {
      ...recording,
      session: { ...recording.session!, sessionId: 'session-2' },
    })).toBe(false)
  })

  it('does not let the overlay initial render cancel a starting session', () => {
    expect(canApplyRecordingUiSnapshot(starting, { session: null, transcript: [] })).toBe(false)
    expect(canApplyRecordingUiSnapshot({ session: null, transcript: [] }, starting)).toBe(true)
  })
})
