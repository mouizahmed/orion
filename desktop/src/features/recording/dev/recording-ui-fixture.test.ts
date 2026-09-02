import { afterEach, describe, expect, it, vi } from 'vitest'

import { getRecordingElapsedMs } from '@/features/recording/recording-state'
import { createRecordingUiFixture } from '@/features/recording/dev/recording-ui-fixture'

afterEach(() => {
  vi.useRealTimers()
})

describe('recording UI fixture', () => {
  it('simulates commands and window changes without changing recording ownership', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T16:00:00Z'))
    const fixture = createRecordingUiFixture({
      autoTranscript: false,
      startDelayMs: 100,
      finalizationDelayMs: 500,
    })
    const sessionListener = vi.fn()
    fixture.subscribeSession(sessionListener)

    fixture.start({ sessionId: 'session-1', noteId: 'note-1', noteTitle: 'Planning' })
    expect(fixture.getSessionSnapshot()?.phase).toBe('starting')
    expect(fixture.getVisibleSurface()).toBe('overlay')

    vi.advanceTimersByTime(100)
    expect(fixture.getSessionSnapshot()).toMatchObject({
      phase: 'recording',
      transcriptPhase: 'live',
    })

    const beforeWindowChange = fixture.getSessionSnapshot()
    await fixture.showDashboard()
    expect(fixture.getVisibleSurface()).toBe('dashboard')
    expect(fixture.getSessionSnapshot()).toBe(beforeWindowChange)
    await fixture.showOverlay()
    expect(fixture.getVisibleSurface()).toBe('overlay')

    vi.advanceTimersByTime(3_000)
    const active = fixture.getSessionSnapshot()
    expect(active && getRecordingElapsedMs(active, Date.now())).toBe(3_100)
    expect(sessionListener).toHaveBeenCalled()

    fixture.dispose()
  })

  it('replaces fixture interim text and isolates transcript subscriptions by scope', () => {
    vi.useFakeTimers()
    fixtureWithRecording((fixture) => {
      const matchingListener = vi.fn()
      const unrelatedListener = vi.fn()
      const scope = { sessionId: 'session-1', noteId: 'note-1' }
      fixture.subscribeTranscript(scope, matchingListener)
      fixture.subscribeTranscript({ sessionId: 'session-2', noteId: 'note-2' }, unrelatedListener)

      const id = fixture.pushInterim('Partial sentence')
      fixture.commitInterim(id, 'Complete sentence.')

      expect(fixture.getTranscriptSnapshot(scope)).toMatchObject([{
        id,
        text: 'Complete sentence.',
        isFinal: true,
      }])
      expect(matchingListener).toHaveBeenCalledTimes(2)
      expect(unrelatedListener).not.toHaveBeenCalled()
    })
  })

  it('runs deterministic automatic transcript and finalization states', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T16:00:00Z'))
    const fixture = createRecordingUiFixture({
      startDelayMs: 100,
      transcriptIntervalMs: 1_000,
      finalizationDelayMs: 500,
    })
    fixture.start({ sessionId: 'session-1', noteId: 'note-1' })
    vi.advanceTimersByTime(1_100)

    const scope = { sessionId: 'session-1', noteId: 'note-1' }
    expect(fixture.getTranscriptSnapshot(scope)).toMatchObject([{ isFinal: false }])
    vi.advanceTimersByTime(350)
    expect(fixture.getTranscriptSnapshot(scope)).toMatchObject([{ isFinal: true }])

    fixture.simulateTranscriptPhase('reconnecting')
    expect(fixture.getSessionSnapshot()?.transcriptPhase).toBe('reconnecting')
    fixture.simulateTranscriptPhase('unavailable')
    expect(fixture.getSessionSnapshot()?.transcriptPhase).toBe('unavailable')

    await fixture.stop()
    expect(fixture.getSessionSnapshot()?.phase).toBe('stopping')
    await fixture.stop()
    vi.advanceTimersByTime(0)
    expect(fixture.getSessionSnapshot()?.phase).toBe('finalizing')
    expect(fixture.getVisibleSurface()).toBe('dashboard')
    vi.advanceTimersByTime(500)
    expect(fixture.getSessionSnapshot()).toMatchObject({
      phase: 'complete',
      transcriptPhase: 'complete',
    })
    expect(fixture.getVisibleSurface()).toBe('dashboard')

    fixture.dispose()
  })
})

function fixtureWithRecording(
  run: (fixture: ReturnType<typeof createRecordingUiFixture>) => void,
) {
  const fixture = createRecordingUiFixture({ autoTranscript: false, startDelayMs: 0 })
  fixture.start({ sessionId: 'session-1', noteId: 'note-1' })
  vi.advanceTimersByTime(0)
  try {
    run(fixture)
  } finally {
    fixture.dispose()
  }
}
