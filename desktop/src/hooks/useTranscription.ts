import { useCallback, useEffect, useRef, useState } from 'react'
import { getAuthenticatedAccessToken } from '@/lib/auth-session'
import { DeepgramClient } from '@/lib/deepgram-client'
import { startMicCapture, startSystemAudioCapture, type AudioCaptureHandle } from '@/lib/audio-capture'
import type { LiveTranscriptSegment } from '@/types/live-insight'
import { saveTranscriptSegments } from '@/lib/transcript-client'
import type { TranscriptSegmentPayload } from '@/lib/transcript-client'
import { API_BASE_URL } from '@/lib/api-config'

const TRANSCRIPTION_WS_URL = (() => {
  const httpUrl = new URL(`${API_BASE_URL.replace(/\/+$/, '')}/transcription/stream`)
  httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return httpUrl.toString()
})()
const MAX_DISPLAY_SEGMENTS = 500
const MAX_RECONNECT_ATTEMPTS = 8
const MAX_RECONNECT_DELAY_MS = 15000
const RECONNECT_JITTER_MS = 400
const SEGMENT_SAVE_INTERVAL_MS = 10_000

type TranscriptionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'

interface UseTranscriptionOptions {
  enabled: boolean
  micMuted: boolean
  speakerMuted: boolean
  sessionKey?: string | null
  meetingNoteId?: string | null
  onError?: (error: Error) => void
}

interface UseTranscriptionResult {
  segments: LiveTranscriptSegment[]
  status: TranscriptionStatus
  finalTranscriptText: string
  getTranscriptSnapshot: () => string
  flushSegments: () => Promise<void>
}

export function useTranscription({
  enabled,
  micMuted,
  speakerMuted,
  sessionKey,
  meetingNoteId,
  onError,
}: UseTranscriptionOptions): UseTranscriptionResult {
  const [segments, setSegments] = useState<LiveTranscriptSegment[]>([])
  const [status, setStatus] = useState<TranscriptionStatus>('idle')

  const deepgramRef = useRef<DeepgramClient | null>(null)
  const micHandleRef = useRef<AudioCaptureHandle | null>(null)
  const systemHandleRef = useRef<AudioCaptureHandle | null>(null)
  const reconnectAttemptRef = useRef(0)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enabledRef = useRef(enabled)
  const finalTextRef = useRef('')
  const lastSavedIndexRef = useRef(0)
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const meetingNoteIdRef = useRef(meetingNoteId)

  enabledRef.current = enabled
  meetingNoteIdRef.current = meetingNoteId

  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    if (micHandleRef.current) {
      micHandleRef.current.stop()
      micHandleRef.current = null
    }
    if (systemHandleRef.current) {
      systemHandleRef.current.stop()
      systemHandleRef.current = null
    }
    if (deepgramRef.current) {
      void deepgramRef.current.close()
      deepgramRef.current = null
    }
  }, [])

  const getTranscriptSnapshot = useCallback(() => {
    if (deepgramRef.current) {
      const live = deepgramRef.current.getTranscriptText()
      if (live.trim()) return live
    }
    return finalTextRef.current
  }, [])

  const saveUnsavedSegments = useCallback(async () => {
    const noteId = meetingNoteIdRef.current
    if (!noteId || !deepgramRef.current) return

    const allFinal = deepgramRef.current.getFinalSegments()
    const unsaved = allFinal.slice(lastSavedIndexRef.current)
    if (unsaved.length === 0) return

    const baseIndex = lastSavedIndexRef.current
    const segmentPayloads: TranscriptSegmentPayload[] = unsaved.map((seg, i) => ({
      channel: seg.channel ?? 0,
      text: seg.text,
      start_time: seg.startTime,
      end_time: seg.endTime,
      segment_index: baseIndex + i,
    }))

    try {
      await saveTranscriptSegments(noteId, segmentPayloads)
      lastSavedIndexRef.current += unsaved.length
    } catch (err) {
      console.error('Failed to save transcript segments:', err)
    }
  }, [])

  const flushSegments = useCallback(async () => {
    await saveUnsavedSegments()
  }, [saveUnsavedSegments])

  const startSession = useCallback(async () => {
    cleanup()
    setStatus('connecting')

    try {
      const accessToken = await getAuthenticatedAccessToken()

      // Create realtime transcription client via backend websocket proxy
      const client = new DeepgramClient({
        onSegments: (segs) => {
          // Limit display segments for memory
          const display = segs.length > MAX_DISPLAY_SEGMENTS ? segs.slice(-MAX_DISPLAY_SEGMENTS) : segs
          setSegments(display)
          finalTextRef.current = deepgramRef.current?.getTranscriptText() ?? finalTextRef.current
        },
        onError: (err) => {
          console.error('Deepgram error:', err)
          onError?.(err)
        },
        onStatus: (dgStatus) => {
          if (dgStatus === 'connected') {
            setStatus('connected')
            reconnectAttemptRef.current = 0
          } else if (dgStatus === 'disconnected') {
            // Attempt reconnect if still enabled
            if (enabledRef.current && reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
              const exponentialDelay = Math.pow(2, reconnectAttemptRef.current) * 1000
              const baseDelay = Math.min(exponentialDelay, MAX_RECONNECT_DELAY_MS)
              const jitter = Math.floor(Math.random() * RECONNECT_JITTER_MS)
              const delay = baseDelay + jitter
              reconnectAttemptRef.current++
              setStatus('connecting')
              reconnectTimerRef.current = setTimeout(() => {
                if (enabledRef.current) {
                  void startSession()
                }
              }, delay)
            } else if (enabledRef.current) {
              setStatus('error')
            }
          }
        },
      })

      deepgramRef.current = client
      await client.connect({ backendWsUrl: TRANSCRIPTION_WS_URL, accessToken })

      // Start mic capture
      try {
        const micHandle = await startMicCapture((pcmBuffer) => {
          client.sendAudio(pcmBuffer, 0)
        })
        micHandleRef.current = micHandle
        if (micMuted) micHandle.mute()
      } catch (err) {
        console.error('Mic capture failed:', err)
        onError?.(new Error('Microphone access denied or unavailable'))
      }

      // Start system audio capture
      try {
        const systemHandle = await startSystemAudioCapture((pcmBuffer) => {
          client.sendAudio(pcmBuffer, 1)
        })
        systemHandleRef.current = systemHandle
        if (speakerMuted) systemHandle.mute()
      } catch (err) {
        console.warn('System audio capture unavailable:', err)
      }
    } catch (err) {
      console.error('Failed to start transcription session:', err)
      setStatus('error')
      onError?.(err instanceof Error ? err : new Error('Failed to start transcription'))
    }
  }, [cleanup, micMuted, speakerMuted, onError])

  useEffect(() => {
    finalTextRef.current = ''
    setSegments([])
    lastSavedIndexRef.current = 0
  }, [sessionKey])

  // Incremental segment save interval
  useEffect(() => {
    if (enabled && meetingNoteId) {
      saveTimerRef.current = setInterval(() => {
        void saveUnsavedSegments()
      }, SEGMENT_SAVE_INTERVAL_MS)
    }

    return () => {
      if (saveTimerRef.current) {
        clearInterval(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [enabled, meetingNoteId, saveUnsavedSegments])

  // Start/stop based on enabled
  useEffect(() => {
    if (enabled) {
      void startSession()
    } else {
      // Build final transcript text before cleanup
      if (deepgramRef.current) {
        finalTextRef.current = deepgramRef.current.getTranscriptText()
      }
      cleanup()
      setStatus('idle')
    }

    return () => {
      if (deepgramRef.current) {
        finalTextRef.current = deepgramRef.current.getTranscriptText()
      }
      cleanup()
    }
  }, [enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // React to mic mute changes
  useEffect(() => {
    if (micHandleRef.current) {
      if (micMuted) {
        micHandleRef.current.mute()
      } else {
        micHandleRef.current.unmute()
      }
    }
    if (deepgramRef.current) {
      deepgramRef.current.setChannelMuted(0, micMuted)
    }
  }, [micMuted])

  // React to speaker mute changes
  useEffect(() => {
    if (systemHandleRef.current) {
      if (speakerMuted) {
        systemHandleRef.current.mute()
      } else {
        systemHandleRef.current.unmute()
      }
    }
    if (deepgramRef.current) {
      deepgramRef.current.setChannelMuted(1, speakerMuted)
    }
  }, [speakerMuted])

  return {
    segments,
    status,
    finalTranscriptText: finalTextRef.current,
    getTranscriptSnapshot,
    flushSegments,
  }
}
