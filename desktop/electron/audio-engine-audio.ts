import type { Socket } from 'node:net'

const AUDIO_PROTOCOL_VERSION = 1
const AUDIO_FRAME_MAX_BYTES = 1024 * 1024
const AUDIO_HEADER_BYTES = 40
const AUDIO_SAMPLE_RATE_HZ = 48_000
const AUDIO_CHANNELS = 1
const PCM_S16_LE_FORMAT = 1
const MAX_QUEUED_AUDIO_FRAMES = 32
const AUDIO_MAGIC = Buffer.from('ORA1', 'ascii')
const MUTED_FLAG = 1 << 0
const DISCONTINUITY_FLAG = 1 << 1
const KNOWN_FLAG_BITS = MUTED_FLAG | DISCONTINUITY_FLAG

export type AudioEngineAudioFrame = {
  source: 'mic' | 'system'
  sequence: number
  timestampUs: number
  sampleRateHz: 48_000
  channels: 1
  sampleFormat: 'pcm_s16_le'
  frameCount: number
  voiceActivity: 'unknown' | 'silence' | 'speech'
  rms: number
  muted: boolean
  discontinuity: boolean
  pcm: Buffer<ArrayBufferLike>
}

export class FramedAudioChannel {
  readonly #socket: Socket
  readonly #onFailure: (error: Error) => void
  readonly #onClose: () => void
  #buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  #queued: AudioEngineAudioFrame[] = []
  #readers: Array<{
    resolve: (value: AudioEngineAudioFrame) => void
    reject: (error: Error) => void
  }> = []
  #failure: Error | null = null

  constructor(socket: Socket, onFailure: (error: Error) => void, onClose: () => void) {
    this.#socket = socket
    this.#onFailure = onFailure
    this.#onClose = onClose
    socket.on('data', this.#handleData)
    socket.on('error', this.#handleError)
    socket.on('close', this.#handleClose)
  }

  read(): Promise<AudioEngineAudioFrame> {
    const queued = this.#queued.shift()
    if (queued) return Promise.resolve(queued)
    if (this.#failure) return Promise.reject(this.#failure)

    return new Promise((resolve, reject) => {
      this.#readers.push({ resolve, reject })
    })
  }

  destroy(): void {
    this.#socket.destroy()
  }

  readonly #handleData = (chunk: Buffer): void => {
    this.#buffer = this.#buffer.byteLength === 0
      ? chunk
      : Buffer.concat([this.#buffer, chunk])

    try {
      while (this.#buffer.byteLength >= 4) {
        const payloadLength = this.#buffer.readUInt32LE(0)
        if (payloadLength > AUDIO_FRAME_MAX_BYTES) {
          throw new Error(
            `Audio engine audio frame declares ${payloadLength} bytes; maximum is ${AUDIO_FRAME_MAX_BYTES}`,
          )
        }
        if (this.#buffer.byteLength < 4 + payloadLength) return

        const payload = this.#buffer.subarray(4, 4 + payloadLength)
        this.#buffer = this.#buffer.subarray(4 + payloadLength)
        this.#deliver(decodeAudioFrame(payload))
      }
    } catch (error) {
      this.#fail(asError(error, 'Audio engine sent an invalid audio frame'))
    }
  }

  readonly #handleError = (error: Error): void => {
    this.#fail(error)
  }

  readonly #handleClose = (): void => {
    if (this.#failure) return
    const error = new Error('Audio engine audio channel closed')
    this.#failure = error
    this.#rejectReaders(error)
    this.#onClose()
  }

  #deliver(frame: AudioEngineAudioFrame): void {
    const reader = this.#readers.shift()
    if (reader) {
      reader.resolve(frame)
      return
    }
    if (this.#queued.length >= MAX_QUEUED_AUDIO_FRAMES) {
      throw new Error(`Audio engine audio frame queue exceeded ${MAX_QUEUED_AUDIO_FRAMES} frames`)
    }
    this.#queued.push(frame)
  }

  #fail(error: Error): void {
    if (this.#failure) return
    this.#failure = error
    this.#buffer = Buffer.alloc(0)
    this.#queued = []
    this.#rejectReaders(error)
    this.#socket.destroy()
    this.#onFailure(error)
  }

  #rejectReaders(error: Error): void {
    for (const reader of this.#readers.splice(0)) reader.reject(error)
  }
}

export function decodeAudioFrame(payload: Buffer<ArrayBufferLike>): AudioEngineAudioFrame {
  if (payload.byteLength < AUDIO_HEADER_BYTES) {
    throw new Error(
      `Audio payload has ${payload.byteLength} bytes; header requires at least ${AUDIO_HEADER_BYTES}`,
    )
  }
  if (!payload.subarray(0, 4).equals(AUDIO_MAGIC)) {
    throw new Error('Audio payload has invalid magic')
  }
  const version = payload.readUInt8(4)
  if (version !== AUDIO_PROTOCOL_VERSION) {
    throw new Error(
      `Audio protocol version is ${version}; expected ${AUDIO_PROTOCOL_VERSION}`,
    )
  }

  const source = parseSource(payload.readUInt8(5))
  const voiceActivity = parseVoiceActivity(payload.readUInt8(6))
  const flags = payload.readUInt8(7)
  if ((flags & ~KNOWN_FLAG_BITS) !== 0) {
    throw new Error(`Audio frame has unknown flags 0x${flags.toString(16).padStart(2, '0')}`)
  }
  const sequence = readSafeUInt64(payload, 8, 'sequence')
  const timestampUs = readSafeUInt64(payload, 16, 'timestamp')
  const sampleRateHz = payload.readUInt32LE(24)
  if (sampleRateHz !== AUDIO_SAMPLE_RATE_HZ) {
    throw new Error(`Audio frame sample rate is ${sampleRateHz}; expected ${AUDIO_SAMPLE_RATE_HZ}`)
  }
  const channels = payload.readUInt16LE(28)
  if (channels !== AUDIO_CHANNELS) {
    throw new Error(`Audio frame channel count is ${channels}; expected ${AUDIO_CHANNELS}`)
  }
  const sampleFormat = payload.readUInt16LE(30)
  if (sampleFormat !== PCM_S16_LE_FORMAT) {
    throw new Error(`Audio frame sample format is ${sampleFormat}; expected ${PCM_S16_LE_FORMAT}`)
  }
  const frameCount = payload.readUInt32LE(32)
  if (frameCount === 0) throw new Error('Audio frame PCM payload is empty')
  const rms = payload.readFloatLE(36)
  if (!Number.isFinite(rms) || rms < 0 || rms > 1) {
    throw new Error(`Audio frame normalized RMS level is invalid: ${rms}`)
  }

  const expectedBytes = AUDIO_HEADER_BYTES + frameCount * channels * Int16Array.BYTES_PER_ELEMENT
  if (payload.byteLength !== expectedBytes) {
    throw new Error(
      `Audio payload has ${payload.byteLength} bytes; header declares ${expectedBytes} bytes`,
    )
  }

  return {
    source,
    sequence,
    timestampUs,
    sampleRateHz: AUDIO_SAMPLE_RATE_HZ,
    channels: AUDIO_CHANNELS,
    sampleFormat: 'pcm_s16_le',
    frameCount,
    voiceActivity,
    rms,
    muted: (flags & MUTED_FLAG) !== 0,
    discontinuity: (flags & DISCONTINUITY_FLAG) !== 0,
    pcm: payload.subarray(AUDIO_HEADER_BYTES),
  }
}

export function encodeAudioFrame(frame: AudioEngineAudioFrame): Buffer<ArrayBuffer> {
  if (!Number.isSafeInteger(frame.sequence) || frame.sequence < 0) {
    throw new Error('Audio frame sequence is outside the safe unsigned integer range')
  }
  if (!Number.isSafeInteger(frame.timestampUs) || frame.timestampUs < 0) {
    throw new Error('Audio frame timestamp is outside the safe unsigned integer range')
  }
  if (!Number.isSafeInteger(frame.frameCount) || frame.frameCount <= 0) {
    throw new Error('Audio frame count is invalid')
  }
  if (!Number.isFinite(frame.rms) || frame.rms < 0 || frame.rms > 1) {
    throw new Error('Audio frame normalized RMS level is invalid')
  }
  const expectedPCMBytes = frame.frameCount * Int16Array.BYTES_PER_ELEMENT
  if (frame.pcm.byteLength !== expectedPCMBytes) {
    throw new Error(
      `Audio frame PCM has ${frame.pcm.byteLength} bytes; frame count requires ${expectedPCMBytes}`,
    )
  }
  const payloadLength = AUDIO_HEADER_BYTES + expectedPCMBytes
  if (payloadLength > AUDIO_FRAME_MAX_BYTES) {
    throw new Error(`Audio frame has ${payloadLength} bytes; maximum is ${AUDIO_FRAME_MAX_BYTES}`)
  }

  const payload = Buffer.allocUnsafe(payloadLength)
  AUDIO_MAGIC.copy(payload, 0)
  payload.writeUInt8(AUDIO_PROTOCOL_VERSION, 4)
  payload.writeUInt8(frame.source === 'mic' ? 1 : 2, 5)
  payload.writeUInt8(
    frame.voiceActivity === 'unknown' ? 0 : frame.voiceActivity === 'silence' ? 1 : 2,
    6,
  )
  payload.writeUInt8(
    (frame.muted ? MUTED_FLAG : 0) | (frame.discontinuity ? DISCONTINUITY_FLAG : 0),
    7,
  )
  payload.writeBigUInt64LE(BigInt(frame.sequence), 8)
  payload.writeBigUInt64LE(BigInt(frame.timestampUs), 16)
  payload.writeUInt32LE(frame.sampleRateHz, 24)
  payload.writeUInt16LE(frame.channels, 28)
  payload.writeUInt16LE(PCM_S16_LE_FORMAT, 30)
  payload.writeUInt32LE(frame.frameCount, 32)
  payload.writeFloatLE(frame.rms, 36)
  frame.pcm.copy(payload, AUDIO_HEADER_BYTES)
  return payload
}

function parseSource(value: number): AudioEngineAudioFrame['source'] {
  if (value === 1) return 'mic'
  if (value === 2) return 'system'
  throw new Error(`Audio frame source is invalid: ${value}`)
}

function parseVoiceActivity(value: number): AudioEngineAudioFrame['voiceActivity'] {
  if (value === 0) return 'unknown'
  if (value === 1) return 'silence'
  if (value === 2) return 'speech'
  throw new Error(`Audio frame voice activity state is invalid: ${value}`)
}

function readSafeUInt64(
  payload: Buffer<ArrayBufferLike>,
  offset: number,
  field: string,
): number {
  const value = payload.readBigUInt64LE(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Audio frame ${field} exceeds JavaScript's safe integer range`)
  }
  return Number(value)
}

function asError(error: unknown, context: string): Error {
  if (error instanceof Error) return error
  return new Error(`${context}: ${String(error)}`)
}
