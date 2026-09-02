import { describe, expect, it } from 'vitest'

import {
  applyRecordingTranscriptUpdate,
  createStartingRecording,
  getRecordingElapsedMs,
  isRecordingCaptureActive,
  isRecordingForNote,
  recordingSessionReducer,
} from '@/features/recording/recording-state'
import type { RecordingTranscriptSegment } from '@/features/recording/recording-types'

describe('recording session state', () => {
  it('follows the complete recording lifecycle', () => {
    const starting = createStartingRecording({
      sessionId: 'session-1',
      noteId: 'note-1',
      noteTitle: 'Planning',
      startedAt: 1_000,
    })
    const recording = recordingSessionReducer(starting, { type: 'started' })
    expect(getRecordingElapsedMs(recording, 11_000)).toBe(10_000)

    const stopping = recordingSessionReducer(recording, { type: 'stop', now: 12_000 })
    expect(stopping.phase).toBe('stopping')
    expect(getRecordingElapsedMs(stopping, 20_000)).toBe(11_000)

    const finalizing = recordingSessionReducer(stopping, { type: 'finalize' })
    expect(finalizing).toMatchObject({ phase: 'finalizing', transcriptPhase: 'finalizing' })
    expect(recordingSessionReducer(finalizing, { type: 'complete' })).toMatchObject({
      phase: 'complete',
      transcriptPhase: 'complete',
    })
  })

  it('keeps duplicate and illegal commands idempotent', () => {
    const starting = createStartingRecording({
      sessionId: 'session-1',
      noteId: 'note-1',
      noteTitle: 'Planning',
      startedAt: 1_000,
    })

    const recording = recordingSessionReducer(starting, { type: 'started' })
    expect(recordingSessionReducer(recording, { type: 'started' })).toBe(recording)
    const stopping = recordingSessionReducer(recording, { type: 'stop', now: 3_000 })
    expect(recordingSessionReducer(stopping, { type: 'stop', now: 4_000 })).toBe(stopping)
  })

  it('matches live dock state only to the active recording note', () => {
    const session = recordingSessionReducer(createStartingRecording({
      sessionId: 'session-1',
      noteId: 'note-1',
      noteTitle: 'Planning',
      startedAt: 1_000,
    }), { type: 'started' })

    expect(isRecordingCaptureActive(session)).toBe(true)
    expect(isRecordingForNote(session, 'note-1')).toBe(true)
    expect(isRecordingForNote(session, 'note-2')).toBe(false)

    const stopping = recordingSessionReducer(session, { type: 'stop', now: 2_000 })
    const finalizing = recordingSessionReducer(stopping, { type: 'finalize' })
    expect(isRecordingForNote(finalizing, 'note-1')).toBe(false)
  })
})

describe('recording transcript state', () => {
  const segment = (overrides: Partial<RecordingTranscriptSegment>): RecordingTranscriptSegment => ({
    id: 'segment-1',
    sessionId: 'session-1',
    noteId: 'note-1',
    sequence: 1,
    source: 'system',
    text: 'Interim words',
    startTime: 1,
    endTime: null,
    createdAt: 1_000,
    isFinal: false,
    ...overrides,
  })

  it('replaces interim text in place when the final segment arrives', () => {
    const interim = segment({})
    const withInterim = applyRecordingTranscriptUpdate([], interim)
    const committed = segment({ text: 'Final sentence.', endTime: 2.5, isFinal: true })
    const withFinal = applyRecordingTranscriptUpdate(withInterim, committed)

    expect(withFinal).toEqual([committed])
    expect(withFinal).toHaveLength(1)
    expect(applyRecordingTranscriptUpdate(withFinal, committed)).toBe(withFinal)
  })

  it('deduplicates by id and maintains deterministic sequence order', () => {
    const second = segment({ id: 'segment-2', sequence: 2, createdAt: 2_000 })
    const first = segment({ id: 'segment-1', sequence: 1, createdAt: 1_000 })
    const updates = applyRecordingTranscriptUpdate(
      applyRecordingTranscriptUpdate([], second),
      first,
    )

    expect(updates.map((item) => item.id)).toEqual(['segment-1', 'segment-2'])
  })
})
