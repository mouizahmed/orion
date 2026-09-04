import { app } from 'electron'
import WebSocket, { type RawData } from 'ws'

import type { RecordingTranscriptSegment } from '../src/features/recording/recording-types'
import { getCurrentAuthTokenForRequest } from './auth-handlers'
import { encodeAudioFrame, type AudioEngineAudioFrame } from './audio-engine-audio'
import { config } from './config'

const TRANSCRIPTION_PATH = '/api/transcription/stream'
const CONNECT_TIMEOUT_MS = 10_000
const SEND_TIMEOUT_MS = 10_000
const FINALIZE_TIMEOUT_MS = 31 * 60 * 1_000
const MAX_MESSAGE_BYTES = 1024 * 1024
const MAX_UNACKNOWLEDGED_AUDIO_FRAMES = 128
const RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const

export type AudioEngineTranscriptionClientOptions = {
  recordingSessionId: string
  clientSessionId: string
  noteId: string
  audioStorage: TranscriptionAudioStorageMode
  onTranscript: (segment: RecordingTranscriptSegment) => void
  onTranscriptUnavailable: (error: Error) => void
  onReconnecting: () => void
  onReconnected: () => void
  onUnavailable: (error: Error) => void
}

export type AudioEngineTranscriptionClient = {
  sendAudioFrame(frame: AudioEngineAudioFrame): Promise<void>
  finish(audioStored: TranscriptionAudioStorage): Promise<TranscriptionAudioStorage>
  isTranscriptAvailable(): boolean
  dispose(): void
}

export type TranscriptionAudioStorage = 'none' | 'local' | 'cloud'
export type TranscriptionAudioStorageMode = 'none' | 'local' | 'server'

type TranscriptionErrorEvent = {
  type: 'error'
  code?: string
  message: string
}

type TranscriptionAudioAckEvent = {
  type: 'audio_ack'
  source: AudioEngineAudioFrame['source']
  sequence: number
}

class TranscriptionServerError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message)
  }
}

export async function connectAudioEngineTranscriptionClient(
  options: AudioEngineTranscriptionClientOptions,
): Promise<AudioEngineTranscriptionClient> {
  const opened = await openAuthenticatedSocket(options, false)
  return new ConnectedAudioEngineTranscriptionClient(opened, options)
}

type OpenedTranscriptionSocket = {
  socket: WebSocket
  transcriptUnavailable: TranscriptionServerError | null
}

type RetainedAudioFrame = {
  payload: Buffer<ArrayBuffer>
  sentGeneration: number
}

type SocketListeners = {
  socket: WebSocket
  message: (raw: RawData, isBinary: boolean) => void
  error: (error: Error) => void
  close: (code: number, reason: Buffer) => void
}

class ConnectedAudioEngineTranscriptionClient implements AudioEngineTranscriptionClient {
  readonly #options: AudioEngineTranscriptionClientOptions
  #socket: WebSocket | null = null
  #socketListeners: SocketListeners | null = null
  #socketGeneration = 0
  #socketReady = false
  #closed = false
  #sendPending = false
  #finishSendPending = false
  #unavailableReported = false
  #reconnectOperation: Promise<void> | null = null
  #finishOperation: Promise<TranscriptionAudioStorage> | null = null
  #finishRequested = false
  #finishAudioStored: TranscriptionAudioStorage | null = null
  #finishSentGeneration = 0
  #finishResolve: ((audioStored: TranscriptionAudioStorage) => void) | null = null
  #finishReject: ((error: Error) => void) | null = null
  #finishTimer: ReturnType<typeof setTimeout> | null = null
  #transcriptAvailable: boolean
  readonly #nextSequence: Record<AudioEngineAudioFrame['source'], number> = { mic: 0, system: 0 }
  readonly #lastInputSequence: Record<AudioEngineAudioFrame['source'], number | null> = {
    mic: null,
    system: null,
  }
  readonly #unacknowledged = new Map<string, RetainedAudioFrame>()

  constructor(opened: OpenedTranscriptionSocket, options: AudioEngineTranscriptionClientOptions) {
    this.#options = options
    this.#transcriptAvailable = opened.transcriptUnavailable === null
    this.#installSocket(opened.socket)
    this.#socketReady = true
  }

  async sendAudioFrame(frame: AudioEngineAudioFrame): Promise<void> {
    if (this.#closed) {
      throw new Error('Transcription connection is unavailable')
    }
    if (this.#finishRequested) {
      throw new Error('Transcription connection is finalizing')
    }
    if (this.#sendPending) {
      throw new Error('Transcription connection cannot accept another audio frame')
    }

    if (this.#unacknowledged.size >= MAX_UNACKNOWLEDGED_AUDIO_FRAMES) {
      const failure = new Error('Transcription acknowledgement window is full')
      this.#fail(failure)
      throw failure
    }

    const source = frame.source
    const sequence = this.#nextSequence[source]
    if (!Number.isSafeInteger(sequence)) {
      const failure = new Error('Transcription audio sequence is exhausted')
      this.#fail(failure)
      throw failure
    }
    const previousInputSequence = this.#lastInputSequence[source]
    const payload = encodeAudioFrame({
      ...frame,
      sequence,
      discontinuity: frame.discontinuity || (
        previousInputSequence !== null && frame.sequence !== previousInputSequence + 1
      ),
    })
    this.#nextSequence[source] = sequence + 1
    this.#lastInputSequence[source] = frame.sequence
    const acknowledgementKey = audioAcknowledgementKey(source, sequence)
    const retained = { payload, sentGeneration: 0 }
    this.#unacknowledged.set(acknowledgementKey, retained)
    const socket = this.#socket
    if (!socket || !this.#socketReady || socket.readyState !== WebSocket.OPEN) return

    this.#sendPending = true
    try {
      retained.sentGeneration = this.#socketGeneration
      await sendBinary(socket, payload)
    } catch (error) {
      this.#beginReconnect(
        socket,
        asError(error, 'Could not stream audio for transcription'),
        false,
      )
    } finally {
      this.#sendPending = false
    }
  }

  finish(audioStored: TranscriptionAudioStorage): Promise<TranscriptionAudioStorage> {
    if (audioStored !== 'none' && audioStored !== 'local' && audioStored !== 'cloud') {
      return Promise.reject(new Error('Transcription audio storage state is invalid'))
    }
    if (this.#finishOperation) {
      if (this.#finishAudioStored !== audioStored) {
        return Promise.reject(new Error('Transcription finalization storage state changed'))
      }
      return this.#finishOperation
    }
    if (this.#closed) return Promise.reject(new Error('Transcription connection is unavailable'))
    this.#finishRequested = true
    this.#finishAudioStored = audioStored
    this.#finishOperation = new Promise<TranscriptionAudioStorage>((resolve, reject) => {
      this.#finishResolve = resolve
      this.#finishReject = reject
      this.#finishTimer = setTimeout(() => {
        this.#fail(new Error('Transcription finalization timed out'))
      }, FINALIZE_TIMEOUT_MS)
    })
    void this.#sendFinishOnCurrentSocket()
    return this.#finishOperation
  }

  isTranscriptAvailable(): boolean {
    return this.#transcriptAvailable
  }

  dispose(): void {
    if (this.#closed) return
    this.#closed = true
    this.#rejectFinish(new Error('Transcription connection was disposed'))
    this.#unacknowledged.clear()
    const socket = this.#socket
    this.#removeSocket()
    if (socket?.readyState === WebSocket.OPEN) {
      socket.close(1000, 'recording transport disposed')
    } else if (socket?.readyState === WebSocket.CONNECTING) {
      socket.terminate()
    }
  }

  #handleMessage(socket: WebSocket, raw: RawData, isBinary: boolean): void {
    if (this.#closed || socket !== this.#socket || isBinary) return
    try {
      const message = parseServerMessage(raw)
      if (message.type === 'error') {
        const code = typeof message.code === 'string' ? message.code : undefined
        const suffix = code ? ` (${code})` : ''
        const failure = new TranscriptionServerError(`${message.message}${suffix}`, code)
        if (isRetryableServerError(code)) {
          this.#beginReconnect(socket, failure, code === 'auth_reauthentication_required')
        } else {
          this.#fail(failure)
        }
        return
      }
      if (message.type === 'transcript_unavailable') {
        const code = typeof message.code === 'string' ? message.code : undefined
        const detail = typeof message.message === 'string' ? message.message.trim() : ''
        if (detail === '') throw new Error('Transcript-unavailable event has no message')
        if (this.#transcriptAvailable) {
          this.#transcriptAvailable = false
          this.#options.onTranscriptUnavailable(new TranscriptionServerError(detail, code))
        }
        return
      }
      const acknowledgement = parseAudioAcknowledgement(message)
      if (acknowledgement) {
        const key = audioAcknowledgementKey(acknowledgement.source, acknowledgement.sequence)
        if (!this.#unacknowledged.delete(key)) {
          throw new Error('Transcription server acknowledged an unknown audio frame')
        }
        return
      }
      if (message.type === 'finalize_ack') {
        const recordingSessionId = 'recording_session_id' in message
          ? message.recording_session_id
          : undefined
        const status = 'status' in message ? message.status : undefined
        const audioStored = 'audio_stored' in message ? message.audio_stored : undefined
        if (
          !this.#finishRequested
          || recordingSessionId !== this.#options.recordingSessionId
          || status !== 'complete'
          || !(
            audioStored === 'none'
            || audioStored === 'local'
            || audioStored === 'cloud'
          )
          || !(
            audioStored === this.#finishAudioStored
            || (this.#finishAudioStored === 'cloud' && audioStored === 'none')
          )
          || this.#unacknowledged.size !== 0
        ) {
          throw new Error('Transcription finalization acknowledgement is invalid')
        }
        this.#resolveFinish(audioStored)
        this.#closed = true
        this.#removeSocket()
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1000, 'transcription finalized')
        }
        return
      }
      const segment = parseTranscriptSegment(message, this.#options)
      if (segment) this.#options.onTranscript(segment)
    } catch (error) {
      this.#fail(asError(error, 'Transcription server sent an invalid message'))
    }
  }

  #handleError(socket: WebSocket, error: Error): void {
    this.#beginReconnect(socket, error, false)
  }

  #handleClose(socket: WebSocket, code: number, reason: Buffer): void {
    if (this.#closed || socket !== this.#socket) return
    const detail = reason.toString('utf8').trim()
    this.#beginReconnect(socket, new Error(
      detail
        ? `Transcription connection closed (${code}): ${detail}`
        : `Transcription connection closed (${code})`,
    ), code === 4001 || code === 4002)
  }

  #installSocket(socket: WebSocket): void {
    this.#removeSocket()
    this.#socket = socket
    this.#socketGeneration += 1
    const listeners: SocketListeners = {
      socket,
      message: (raw, isBinary) => this.#handleMessage(socket, raw, isBinary),
      error: (error) => this.#handleError(socket, error),
      close: (code, reason) => this.#handleClose(socket, code, reason),
    }
    this.#socketListeners = listeners
    socket.on('message', listeners.message)
    socket.on('error', listeners.error)
    socket.on('close', listeners.close)
  }

  #removeSocket(): void {
    const listeners = this.#socketListeners
    if (listeners) {
      listeners.socket.removeListener('message', listeners.message)
      listeners.socket.removeListener('error', listeners.error)
      listeners.socket.removeListener('close', listeners.close)
    }
    this.#socketListeners = null
    this.#socket = null
    this.#socketReady = false
  }

  #beginReconnect(socket: WebSocket, error: Error, forceRefresh: boolean): void {
    if (this.#closed || socket !== this.#socket) return
    this.#removeSocket()
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
    if (this.#reconnectOperation) return
    this.#options.onReconnecting()
    const operation = this.#reconnect(error, forceRefresh).finally(() => {
      if (this.#reconnectOperation === operation) this.#reconnectOperation = null
    })
    this.#reconnectOperation = operation
  }

  async #reconnect(initialError: Error, forceRefresh: boolean): Promise<void> {
    let lastError = initialError
    for (let attempt = 0; attempt < RECONNECT_DELAYS_MS.length; attempt += 1) {
      await wait(RECONNECT_DELAYS_MS[attempt])
      if (this.#closed) return
      let socket: WebSocket | null = null
      try {
        const opened = await openAuthenticatedSocket(this.#options, forceRefresh)
        socket = opened.socket
        if (this.#closed) {
          socket.terminate()
          return
        }
        this.#installSocket(socket)
        this.#transcriptAvailable = opened.transcriptUnavailable === null
        await this.#replayRetainedFrames(socket)
        if (this.#closed) return
        if (socket !== this.#socket) throw new Error('Reconnected transcription socket closed during replay')
        this.#socketReady = true
        await this.#sendFinishOnCurrentSocket()
        if (this.#closed) return
        if (socket !== this.#socket) throw new Error('Reconnected transcription socket closed during finalization')
        if (opened.transcriptUnavailable) {
          this.#options.onTranscriptUnavailable(opened.transcriptUnavailable)
        }
        this.#options.onReconnected()
        return
      } catch (error) {
        lastError = asError(error, 'Could not reconnect transcription')
        if (error instanceof TranscriptionServerError) {
          if (!isRetryableServerError(error.code)) {
            this.#fail(error)
            return
          }
          forceRefresh ||= error.code === 'auth_reauthentication_required'
        }
        if (socket) {
          if (socket === this.#socket) this.#removeSocket()
          if (socket.readyState !== WebSocket.CLOSED) socket.terminate()
        }
      }
    }
    this.#fail(new Error(`Transcription remained unavailable after ${RECONNECT_DELAYS_MS.length} reconnect attempts: ${lastError.message}`))
  }

  async #replayRetainedFrames(socket: WebSocket): Promise<void> {
    const generation = this.#socketGeneration
    for (;;) {
      const retained = [...this.#unacknowledged.values()].find(
        (frame) => frame.sentGeneration !== generation,
      )
      if (!retained) return
      retained.sentGeneration = generation
      await sendBinary(socket, retained.payload)
    }
  }

  async #sendFinishOnCurrentSocket(): Promise<void> {
    const socket = this.#socket
    const generation = this.#socketGeneration
    if (
      !this.#finishRequested
      || this.#finishSendPending
      || this.#finishSentGeneration === generation
      || !socket
      || !this.#socketReady
      || socket.readyState !== WebSocket.OPEN
    ) return

    this.#finishSendPending = true
    this.#finishSentGeneration = generation
    try {
      await sendJson(socket, {
        type: 'finalize_options',
        audio_stored: this.#finishAudioStored,
      })
      await sendBinary(socket, Buffer.alloc(0))
    } catch (error) {
      this.#beginReconnect(
        socket,
        asError(error, 'Could not finalize transcription'),
        false,
      )
    } finally {
      this.#finishSendPending = false
    }
  }

  #resolveFinish(audioStored: TranscriptionAudioStorage): void {
    if (this.#finishTimer) clearTimeout(this.#finishTimer)
    this.#finishTimer = null
    const resolve = this.#finishResolve
    this.#finishResolve = null
    this.#finishReject = null
    resolve?.(audioStored)
  }

  #rejectFinish(error: Error): void {
    if (this.#finishTimer) clearTimeout(this.#finishTimer)
    this.#finishTimer = null
    const reject = this.#finishReject
    this.#finishResolve = null
    this.#finishReject = null
    reject?.(error)
  }

  #reportUnavailable(error: Error): void {
    if (this.#unavailableReported) return
    this.#unavailableReported = true
    this.#options.onUnavailable(error)
  }

  #fail(error: Error): void {
    this.#reportUnavailable(error)
    this.#rejectFinish(error)
    if (this.#closed) return
    this.#closed = true
    const socket = this.#socket
    this.#removeSocket()
    if (socket?.readyState !== WebSocket.CLOSED) socket?.terminate()
  }
}

async function openAuthenticatedSocket(
  options: AudioEngineTranscriptionClientOptions,
  forceRefresh: boolean,
): Promise<OpenedTranscriptionSocket> {
  const token = await getCurrentAuthTokenForRequest(forceRefresh)
  const url = new URL(TRANSCRIPTION_PATH, config.backendUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(url, {
    maxPayload: MAX_MESSAGE_BYTES,
    origin: app.isPackaged ? 'file://' : 'http://localhost:5173',
  })

  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = setTimeout(() => finish(new Error('Transcription connection timed out')), CONNECT_TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timeout)
      socket.removeListener('open', handleOpen)
      socket.removeListener('message', handleMessage)
      socket.removeListener('error', handleError)
      socket.removeListener('close', handleClose)
    }
    const finish = (error?: Error, transcriptUnavailable: TranscriptionServerError | null = null) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        socket.terminate()
        reject(error)
      } else {
        resolve({ socket, transcriptUnavailable })
      }
    }
    const handleOpen = () => {
      socket.send(JSON.stringify({
        type: 'auth',
        token,
        recording_session_id: options.recordingSessionId,
        audio_storage: options.audioStorage,
      }), (error) => {
        if (error) finish(asError(error, 'Could not authenticate transcription connection'))
      })
    }
    const handleMessage = (raw: RawData, isBinary: boolean) => {
      if (isBinary) {
        finish(new Error('Transcription authentication response was binary'))
        return
      }
      try {
        const message = parseServerMessage(raw)
        if (message.type === 'auth_ok') {
          const auth = message as Record<string, unknown>
          const available = auth.transcript_available
          if (available !== undefined && typeof available !== 'boolean') {
            finish(new Error('Transcription availability response is invalid'))
            return
          }
          if (available === false) {
            const code = typeof auth.transcript_unavailable_code === 'string'
              ? auth.transcript_unavailable_code
              : undefined
            const detail = typeof auth.transcript_unavailable_message === 'string'
              ? auth.transcript_unavailable_message.trim()
              : ''
            if (detail === '') {
              finish(new Error('Transcription unavailability response is invalid'))
              return
            }
            finish(undefined, new TranscriptionServerError(detail, code))
            return
          }
          finish()
        }
        else if (message.type === 'error') {
          const code = typeof message.code === 'string' ? message.code : undefined
          const suffix = code ? ` (${code})` : ''
          finish(new TranscriptionServerError(`${message.message}${suffix}`, code))
        }
        else finish(new Error('Transcription authentication response was unexpected'))
      } catch (error) {
        finish(asError(error, 'Transcription authentication response was invalid'))
      }
    }
    const handleError = (error: Error) => finish(error)
    const handleClose = (code: number, reason: Buffer) => finish(new TranscriptionServerError(
      `Transcription connection closed during authentication (${code}): ${reason.toString('utf8')}`,
      code === 4001 || code === 4002 ? 'auth_reauthentication_required' : undefined,
    ))

    socket.once('open', handleOpen)
    socket.on('message', handleMessage)
    socket.once('error', handleError)
    socket.once('close', handleClose)
  })
}

function isRetryableServerError(code: string | undefined): boolean {
  return code === undefined
    || code === 'auth_reauthentication_required'
    || code === 'usage_service_unavailable'
    || code === 'recording_session_service_unavailable'
    || code === 'recording_finalization_unavailable'
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function parseServerMessage(raw: RawData): Record<string, unknown> | TranscriptionErrorEvent {
  const bytes = rawDataBytes(raw)
  if (bytes.byteLength > MAX_MESSAGE_BYTES) throw new Error('Transcription message exceeds the size limit')
  const parsed: unknown = JSON.parse(bytes.toString('utf8'))
  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    throw new Error('Transcription message has no valid type')
  }
  if (parsed.type === 'error') {
    if (typeof parsed.message !== 'string' || parsed.message.trim() === '') {
      throw new Error('Transcription error has no message')
    }
    return {
      type: 'error',
      code: typeof parsed.code === 'string' ? parsed.code : undefined,
      message: parsed.message,
    }
  }
  return parsed
}

function parseAudioAcknowledgement(
  message: Record<string, unknown>,
): TranscriptionAudioAckEvent | null {
  if (message.type !== 'audio_ack') return null
  const source = message.source === 'microphone'
    ? 'mic'
    : message.source === 'system'
      ? 'system'
      : null
  const rawSequence = message.sequence
  if (
    source === null
    || typeof rawSequence !== 'string'
    || !/^(0|[1-9]\d*)$/.test(rawSequence)
  ) {
    throw new Error('Transcription audio acknowledgement is invalid')
  }
  const sequence = BigInt(rawSequence)
  if (sequence > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Transcription audio acknowledgement sequence exceeds the safe range')
  }
  return { type: 'audio_ack', source, sequence: Number(sequence) }
}

function audioAcknowledgementKey(
  source: AudioEngineAudioFrame['source'],
  sequence: number,
): string {
  return `${source}:${sequence}`
}

function parseTranscriptSegment(
  message: Record<string, unknown>,
  expected: Pick<AudioEngineTranscriptionClientOptions, 'clientSessionId' | 'noteId'>,
): RecordingTranscriptSegment | null {
  if (message.type !== 'transcript') return null
  const sequence = message.sequence
  const source = message.source
  const startTime = message.start_time
  const endTime = message.end_time
  const createdAt = message.created_at
  const isFinal = message.is_final
  const confidence = message.confidence
  if (
    !Number.isSafeInteger(sequence) || (sequence as number) < 0
    || (source !== 'microphone' && source !== 'system')
    || typeof message.text !== 'string' || message.text.trim() === ''
    || !isFiniteNonNegative(startTime)
    || (endTime !== null && !isFiniteNonNegative(endTime))
    || (typeof endTime === 'number' && endTime < (startTime as number))
    || !Number.isSafeInteger(createdAt) || (createdAt as number) < 0
    || typeof isFinal !== 'boolean'
    || !isUnitInterval(confidence)
    || !hasValidWords(message.words)
  ) {
    throw new Error('Transcript event fields are invalid')
  }
  const id = `${expected.clientSessionId}:${source}:${sequence}`
  if (
    message.id !== id
    || message.session_id !== expected.clientSessionId
    || message.note_id !== expected.noteId
  ) {
    throw new Error('Transcript event scope or identity does not match the recording')
  }
  if (!isFinal && endTime !== null) {
    throw new Error('Interim transcript event must not have an end time')
  }

  return {
    id,
    sessionId: expected.clientSessionId,
    noteId: expected.noteId,
    sequence: sequence as number,
    source,
    text: message.text,
    startTime: startTime as number,
    endTime: endTime as number | null,
    createdAt: createdAt as number,
    isFinal,
  }
}

function sendBinary(socket: WebSocket, payload: Buffer<ArrayBuffer>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Transcription audio send timed out')), SEND_TIMEOUT_MS)
    socket.send(payload, { binary: true }, (error) => {
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve()
    })
  })
}

function sendJson(socket: WebSocket, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Transcription control send timed out')), SEND_TIMEOUT_MS)
    socket.send(JSON.stringify(payload), { binary: false }, (error) => {
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve()
    })
  })
}

function rawDataBytes(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof ArrayBuffer) return Buffer.from(raw)
  if (Array.isArray(raw)) return Buffer.concat(raw)
  throw new Error('Transcription message uses an unsupported payload type')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function hasValidWords(value: unknown): boolean {
  if (value === undefined) return true
  if (!Array.isArray(value)) return false
  return value.every((word) => {
    if (!isRecord(word)) return false
    return typeof word.word === 'string'
      && word.word.trim() !== ''
      && isFiniteNonNegative(word.start)
      && isFiniteNonNegative(word.end)
      && word.end >= word.start
      && isUnitInterval(word.confidence)
  })
}

function asError(error: unknown, context: string): Error {
  if (error instanceof Error) return error
  return new Error(`${context}: ${String(error)}`)
}
