import type { LiveTranscriptSegment } from '@/features/overlay/types'
import { desktopApi } from '@/lib/desktop-api'

export type DeepgramSegmentCallback = (segments: LiveTranscriptSegment[]) => void
export type DeepgramErrorCallback = (error: Error) => void
export type DeepgramStatusCallback = (status: 'connecting' | 'connected' | 'disconnected') => void

interface DeepgramWord {
  word: string
  start: number
  end: number
  confidence: number
  punctuated_word?: string
}

interface DeepgramAlternative {
  transcript: string
  confidence: number
  words: DeepgramWord[]
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[]
}

interface DeepgramResponse {
  type: string
  channel_index: number[]
  duration: number
  start: number
  is_final: boolean
  speech_final: boolean
  channel: DeepgramChannel
}

const FLUSH_INTERVAL_MS = 50
const MERGE_GAP_SECONDS = 2.0
const CONTINUATION_GAP_SECONDS = 3.5
const MAX_MERGED_WORDS = 80
const INTERIM_EMIT_INTERVAL_MS = 120
const CONNECT_TIMEOUT_MS = 10000
const ECHO_WINDOW_MS = 1500
const ECHO_OVERLAP_THRESHOLD = 0.6
const ECHO_MIN_WORDS = 3

export class DeepgramClient {
  private ws: WebSocket | null = null
  private onSegments: DeepgramSegmentCallback
  private onError: DeepgramErrorCallback
  private onStatus: DeepgramStatusCallback

  private channel0Buffer: Int16Array[] = []
  private channel1Buffer: Int16Array[] = []
  private channel0Muted = false
  private channel1Muted = false
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private authenticated = false
  private lastInterimEmitMs = 0

  private turnSealedCh0 = false
  private turnSealedCh1 = false
  private recentCh0Texts: Array<{ text: string; words: Set<string>; time: number }> = []

  private segmentIdCounter = 0
  private finalSegments: LiveTranscriptSegment[] = []
  private interimSegments: LiveTranscriptSegment[] = []

  constructor(opts: {
    onSegments: DeepgramSegmentCallback
    onError: DeepgramErrorCallback
    onStatus: DeepgramStatusCallback
  }) {
    this.onSegments = opts.onSegments
    this.onError = opts.onError
    this.onStatus = opts.onStatus
  }

  connect(opts: { backendWsUrl: string; accessToken: string }): Promise<void> {
    this.onStatus('connecting')
    const wsUrl = new URL(opts.backendWsUrl)
    this.ws = new WebSocket(wsUrl.toString())
    this.ws.binaryType = 'arraybuffer'
    this.authenticated = false
    let handshakeDone = false

    return new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      }
      const succeed = () => {
        if (settled) return
        settled = true
        resolve()
      }

      const timer = setTimeout(() => {
        fail(new Error('Timed out establishing transcription stream'))
      }, CONNECT_TIMEOUT_MS)

      this.ws!.onopen = () => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
        this.ws.send(JSON.stringify({ type: 'auth', token: opts.accessToken }))
      }

      this.ws!.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const response = JSON.parse(event.data) as DeepgramResponse & { message?: string }
            if (response.type === 'auth_ok') {
              this.authenticated = true
              handshakeDone = true
              clearTimeout(timer)
              this.onStatus('connected')
              this.startFlushInterval()
              succeed()
              return
            }
            if (response.type === 'error') {
              const error = new Error(response.message ?? 'Transcription stream error')
              this.onError(error)
              if (!handshakeDone) {
                clearTimeout(timer)
                fail(error)
              }
              return
            }
            this.handleResponse(response)
          } catch {
            // Ignore malformed JSON from upstream stream events.
          }
        }
      }

      this.ws!.onerror = () => {
        const error = new Error('Deepgram WebSocket error')
        this.onError(error)
        if (!handshakeDone) {
          clearTimeout(timer)
          fail(error)
        }
      }

      this.ws!.onclose = (event) => {
        this.stopFlushInterval()
        this.authenticated = false
        this.onStatus('disconnected')
        if (event.code === 4001 || event.code === 4003) {
          void desktopApi.auth.revalidate()
        }
        if (!handshakeDone) {
          clearTimeout(timer)
          fail(new Error('Transcription stream closed before authentication'))
        }
      }
    })
  }

  sendAudio(pcmBuffer: ArrayBuffer, channel: 0 | 1) {
    const samples = new Int16Array(pcmBuffer)
    if (channel === 0) {
      this.channel0Buffer.push(this.channel0Muted ? new Int16Array(samples.length) : samples)
      return
    }
    this.channel1Buffer.push(this.channel1Muted ? new Int16Array(samples.length) : samples)
  }

  setChannelMuted(channel: 0 | 1, muted: boolean) {
    if (channel === 0) {
      this.channel0Muted = muted
      return
    }
    this.channel1Muted = muted
  }

  async close(): Promise<void> {
    this.stopFlushInterval()
    this.flushBuffers()

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(new Uint8Array(0))

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 2000)

        const originalOnMessage = this.ws!.onmessage
        this.ws!.onmessage = (event) => {
          if (originalOnMessage) {
            originalOnMessage.call(this.ws!, event)
          }
        }

        const originalOnClose = this.ws!.onclose
        this.ws!.onclose = (event) => {
          clearTimeout(timeout)
          if (originalOnClose) {
            originalOnClose.call(this.ws!, event)
          }
          resolve()
        }
      })

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close()
      }
    }

    this.ws = null
    this.authenticated = false
    this.turnSealedCh0 = false
    this.turnSealedCh1 = false
    this.recentCh0Texts = []
  }

  getFinalSegments(): LiveTranscriptSegment[] {
    return [...this.finalSegments]
  }

  getTranscriptText(): string {
    return this.finalSegments
      .map((s) => s.text)
      .join('\n')
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  private startFlushInterval() {
    this.flushTimer = setInterval(() => {
      this.flushBuffers()
    }, FLUSH_INTERVAL_MS)
  }

  private stopFlushInterval() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }

  private flushBuffers() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.authenticated) return

    const ch0 = this.concatBuffers(this.channel0Buffer)
    const ch1 = this.concatBuffers(this.channel1Buffer)
    this.channel0Buffer = []
    this.channel1Buffer = []

    if (ch0.length === 0 && ch1.length === 0) return

    const maxLen = Math.max(ch0.length, ch1.length)
    const interleaved = new Int16Array(maxLen * 2)

    for (let i = 0; i < maxLen; i++) {
      interleaved[i * 2] = i < ch0.length ? ch0[i] : 0
      interleaved[i * 2 + 1] = i < ch1.length ? ch1[i] : 0
    }

    this.ws.send(interleaved.buffer)
  }

  private concatBuffers(buffers: Int16Array[]): Int16Array {
    if (buffers.length === 0) return new Int16Array(0)
    if (buffers.length === 1) return buffers[0]

    const totalLength = buffers.reduce((sum, b) => sum + b.length, 0)
    const result = new Int16Array(totalLength)
    let offset = 0
    for (const buf of buffers) {
      result.set(buf, offset)
      offset += buf.length
    }
    return result
  }

  private handleResponse(response: DeepgramResponse) {
    if (response.type === 'SpeechStarted') {
      const ch = response.channel_index?.[0] ?? 0
      if (ch === 0) this.turnSealedCh0 = true
      else this.turnSealedCh1 = true
      return
    }

    if (response.type !== 'Results') return

    const channelIndex = response.channel_index?.[0] ?? 0
    const alt = response.channel?.alternatives?.[0]
    if (!alt) return

    const transcript = (alt.transcript ?? '').trim()
    const speechFinal = response.is_final && response.speech_final

    if (!transcript) {
      if (response.is_final) {
        const before = this.interimSegments.length
        this.interimSegments = this.interimSegments.filter((s) => s.channel !== channelIndex)
        if (before !== this.interimSegments.length) {
          this.emitSegments()
        }
      }
      return
    }

    // Echo suppression: if channel 1 text heavily overlaps recent channel 0 text, skip it
    if (channelIndex === 1 && response.is_final) {
      if (this.isEcho(transcript)) {
        return
      }
    }

    this.handleChannelSegment(transcript, response.is_final, channelIndex, alt.words, speechFinal)
  }

  private handleChannelSegment(
    transcript: string,
    isFinal: boolean,
    channel: number,
    words: DeepgramWord[],
    speechFinal = false,
  ) {
    const startTime = words.length > 0 ? words[0].start : undefined
    const endTime = words.length > 0 ? words[words.length - 1].end : undefined

    if (isFinal) {
      this.interimSegments = this.interimSegments.filter((s) => s.channel !== channel)

      const sealed = channel === 0 ? this.turnSealedCh0 : this.turnSealedCh1

      // Clear seal for this channel
      if (channel === 0) this.turnSealedCh0 = false
      else this.turnSealedCh1 = false

      let merged = false

      if (!sealed) {
        const lastFinal = this.finalSegments[this.finalSegments.length - 1]
        if (lastFinal && lastFinal.channel === channel) {
          const hasTiming = startTime !== undefined && lastFinal.endTime !== undefined
          const gapSeconds = hasTiming
            ? Math.max(0, startTime - lastFinal.endTime!)
            : (Date.now() - lastFinal.createdAt) / 1000

          const previousText = lastFinal.text.trim()
          const endsSentence = /[.!?]["']?$/.test(previousText)
          const startsLowercase = /^[a-z]/.test(transcript)
          const looksLikeContinuation = !endsSentence || startsLowercase

          const mergedWordCount =
            previousText.split(/\s+/).filter(Boolean).length +
            transcript.split(/\s+/).filter(Boolean).length

          if (
            gapSeconds <= MERGE_GAP_SECONDS ||
            (looksLikeContinuation && gapSeconds <= CONTINUATION_GAP_SECONDS)
          ) {
            if (mergedWordCount <= MAX_MERGED_WORDS) {
              lastFinal.text = `${lastFinal.text} ${transcript}`.trim()
              lastFinal.endTime = endTime ?? lastFinal.endTime
              if (lastFinal.startTime === undefined) {
                lastFinal.startTime = startTime
              }
              lastFinal.createdAt = Date.now()
              merged = true
            }
          }
        }
      }

      if (!merged) {
        const segment: LiveTranscriptSegment = {
          id: `dg-${++this.segmentIdCounter}`,
          text: transcript,
          createdAt: Date.now(),
          pending: false,
          channel,
          startTime,
          endTime,
        }
        this.finalSegments.push(segment)
      }

      // Record ch0 text for echo suppression
      if (channel === 0) {
        this.recentCh0Texts.push({
          text: transcript,
          words: new Set(transcript.toLowerCase().split(/\s+/).filter(Boolean)),
          time: Date.now(),
        })
      }

      // Set seal after creating/merging the segment
      if (speechFinal) {
        if (channel === 0) this.turnSealedCh0 = true
        else this.turnSealedCh1 = true
      }

      this.emitSegments()
      return
    }

    this.interimSegments = this.interimSegments.filter((s) => s.channel !== channel)
    this.interimSegments.push({
      id: `dg-interim-ch${channel}`,
      text: transcript,
      createdAt: Date.now(),
      pending: true,
      channel,
      startTime,
      endTime,
    })
    this.emitInterimSegmentsThrottled()
  }

  private emitSegments() {
    const all = [...this.finalSegments, ...this.interimSegments]
    this.onSegments(all)
  }

  private emitInterimSegmentsThrottled() {
    const now = Date.now()
    if (now - this.lastInterimEmitMs < INTERIM_EMIT_INTERVAL_MS) return
    this.lastInterimEmitMs = now
    this.emitSegments()
  }

  private isEcho(text: string): boolean {
    const now = Date.now()
    this.recentCh0Texts = this.recentCh0Texts.filter(e => now - e.time < ECHO_WINDOW_MS)
    if (this.recentCh0Texts.length === 0) return false

    const ch1Words = new Set(text.toLowerCase().split(/\s+/).filter(Boolean))
    if (ch1Words.size < ECHO_MIN_WORDS) return false

    for (const entry of this.recentCh0Texts) {
      let overlap = 0
      for (const w of ch1Words) {
        if (entry.words.has(w)) overlap++
      }
      const ratio = overlap / Math.min(ch1Words.size, entry.words.size)
      if (ratio >= ECHO_OVERLAP_THRESHOLD) return true
    }
    return false
  }
}
