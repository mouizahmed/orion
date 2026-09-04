import { randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'

import {
  FramedAudioChannel,
  type AudioEngineAudioFrame,
} from './audio-engine-audio'
import type { AudioEngineEndpointPair } from './audio-engine-launch'
import type {
  RecordingDspConfiguration,
  RecordingDspSourceTelemetry,
  RecordingDspState,
} from '../src/features/recording/recording-diagnostics-types'

const CONTROL_PROTOCOL_VERSION = 1
const CONTROL_FRAME_MAX_BYTES = 256 * 1024
const MAX_PENDING_REQUESTS = 128

type HelperPlatform = 'windows' | 'macos'
type HealthState = 'starting' | 'ready' | 'shutting_down'
type DeviceKind = 'microphone' | 'system_output'
type AudioSource = 'mic' | 'system'

export type AudioEngineHealth = {
  state: HealthState
  uptimeMs: number
  droppedAudioFrames: number
}

export type AudioEngineDevice = {
  id: string
  name: string
  kind: DeviceKind
  isDefault: boolean
  isAvailable: boolean
}

export type AudioEngineHello = {
  helperVersion: string
  platform: HelperPlatform
}

export type AudioEngineClientOptions = {
  platform?: NodeJS.Platform
  onHelperError?: (error: AudioEngineProtocolError) => void
  onUnexpectedClose?: (error: Error) => void
}

export type AudioEngineClient = {
  readonly hello: AudioEngineHello
  readAudioFrame(): Promise<AudioEngineAudioFrame>
  health(): Promise<AudioEngineHealth>
  listDevices(): Promise<readonly AudioEngineDevice[]>
  dspState(): Promise<RecordingDspState>
  setDspConfiguration(configuration: RecordingDspConfiguration): Promise<RecordingDspState>
  setMicrophoneMuted(muted: boolean): Promise<boolean>
  setSystemAudioMuted(muted: boolean): Promise<boolean>
  shutdown(): Promise<void>
  dispose(): void
}

type PendingRequest =
  | {
      kind: 'health'
      resolve: (value: AudioEngineHealth) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'device_inventory'
      resolve: (value: readonly AudioEngineDevice[]) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'microphone_mute_state'
      resolve: (muted: boolean) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'dsp_state'
      resolve: (value: RecordingDspState) => void
      reject: (error: Error) => void
    }
  | {
      kind: 'system_audio_mute_state'
      resolve: (muted: boolean) => void
      reject: (error: Error) => void
    }

type HelperMessage =
  | { type: 'hello'; value: AudioEngineHello }
  | { type: 'health'; requestId: string; value: AudioEngineHealth }
  | { type: 'device_inventory'; requestId: string; value: readonly AudioEngineDevice[] }
  | { type: 'dsp_state'; requestId: string; value: RecordingDspState }
  | { type: 'microphone_mute_state'; requestId: string; value: boolean }
  | { type: 'system_audio_mute_state'; requestId: string; value: boolean }
  | { type: 'error'; value: AudioEngineProtocolError }

export class AudioEngineProtocolError extends Error {
  readonly code: string
  readonly recoverable: boolean
  readonly source: AudioSource | null

  constructor(code: string, message: string, recoverable: boolean, source: AudioSource | null) {
    super(message)
    this.name = 'AudioEngineProtocolError'
    this.code = code
    this.recoverable = recoverable
    this.source = source
  }
}

class ControlChannelClosedError extends Error {
  constructor() {
    super('Audio engine control channel closed')
    this.name = 'ControlChannelClosedError'
  }
}

class FramedJsonChannel {
  readonly #socket: Socket
  #buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  #queued: unknown[] = []
  #readers: Array<{
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }> = []
  #failure: Error | null = null

  constructor(socket: Socket) {
    this.#socket = socket
    socket.on('data', this.#handleData)
    socket.on('error', this.#handleError)
    socket.on('close', this.#handleClose)
  }

  read(): Promise<unknown> {
    const queued = this.#queued.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    if (this.#failure) return Promise.reject(this.#failure)

    return new Promise((resolve, reject) => {
      this.#readers.push({ resolve, reject })
    })
  }

  write(value: unknown): Promise<void> {
    if (this.#failure) return Promise.reject(this.#failure)

    const payload = Buffer.from(JSON.stringify(value), 'utf8')
    if (payload.byteLength > CONTROL_FRAME_MAX_BYTES) {
      return Promise.reject(new Error(
        `Audio engine control frame is ${payload.byteLength} bytes; maximum is ${CONTROL_FRAME_MAX_BYTES}`,
      ))
    }

    const frame = Buffer.allocUnsafe(4 + payload.byteLength)
    frame.writeUInt32LE(payload.byteLength, 0)
    payload.copy(frame, 4)

    return new Promise((resolve, reject) => {
      this.#socket.write(frame, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  destroy(): void {
    this.#socket.destroy()
  }

  readonly #handleData = (chunk: Buffer): void => {
    this.#buffer = this.#buffer.byteLength === 0
      ? chunk
      : Buffer.concat([this.#buffer, chunk])

    while (this.#buffer.byteLength >= 4) {
      const payloadLength = this.#buffer.readUInt32LE(0)
      if (payloadLength > CONTROL_FRAME_MAX_BYTES) {
        this.#fail(new Error(
          `Audio engine control frame declares ${payloadLength} bytes; maximum is ${CONTROL_FRAME_MAX_BYTES}`,
        ))
        return
      }
      if (this.#buffer.byteLength < 4 + payloadLength) return

      const payload = this.#buffer.subarray(4, 4 + payloadLength)
      this.#buffer = this.#buffer.subarray(4 + payloadLength)
      try {
        this.#deliver(JSON.parse(payload.toString('utf8')) as unknown)
      } catch (error) {
        this.#fail(asError(error, 'Audio engine sent invalid control JSON'))
        return
      }
    }
  }

  readonly #handleError = (error: Error): void => {
    this.#fail(error)
  }

  readonly #handleClose = (): void => {
    this.#fail(new ControlChannelClosedError())
  }

  #deliver(value: unknown): void {
    const reader = this.#readers.shift()
    if (reader) reader.resolve(value)
    else this.#queued.push(value)
  }

  #fail(error: Error): void {
    if (this.#failure) return
    this.#failure = error
    this.#buffer = Buffer.alloc(0)
    this.#queued = []
    for (const reader of this.#readers.splice(0)) reader.reject(error)
    this.#socket.destroy()
  }
}

class ConnectedAudioEngineClient implements AudioEngineClient {
  readonly hello: AudioEngineHello

  readonly #channel: FramedJsonChannel
  readonly #audioChannel: FramedAudioChannel
  readonly #onHelperError: ((error: AudioEngineProtocolError) => void) | undefined
  readonly #onUnexpectedClose: ((error: Error) => void) | undefined
  readonly #pending = new Map<string, PendingRequest>()
  #closed = false
  #shuttingDown = false
  #resolveShutdown: (() => void) | null = null

  constructor(
    channel: FramedJsonChannel,
    audioSocket: Socket,
    hello: AudioEngineHello,
    onHelperError: ((error: AudioEngineProtocolError) => void) | undefined,
    onUnexpectedClose: ((error: Error) => void) | undefined,
  ) {
    this.#channel = channel
    this.hello = hello
    this.#onHelperError = onHelperError
    this.#onUnexpectedClose = onUnexpectedClose
    this.#audioChannel = new FramedAudioChannel(
      audioSocket,
      this.#handleAudioFailure,
      this.#handleAudioClose,
    )
    void this.#readMessages()
  }

  readAudioFrame(): Promise<AudioEngineAudioFrame> {
    if (this.#closed || this.#shuttingDown) {
      return Promise.reject(new Error('Audio engine client is closed'))
    }
    return this.#audioChannel.read()
  }

  health(): Promise<AudioEngineHealth> {
    return this.#request('health')
  }

  listDevices(): Promise<readonly AudioEngineDevice[]> {
    return this.#request('device_inventory')
  }

  dspState(): Promise<RecordingDspState> {
    return this.#request('dsp_state')
  }

  setDspConfiguration(
    configuration: RecordingDspConfiguration,
  ): Promise<RecordingDspState> {
    return this.#request('dsp_state', configuration)
  }

  setMicrophoneMuted(muted: boolean): Promise<boolean> {
    return this.#request('microphone_mute_state', muted)
  }

  setSystemAudioMuted(muted: boolean): Promise<boolean> {
    return this.#request('system_audio_mute_state', muted)
  }

  async shutdown(): Promise<void> {
    if (this.#closed) return
    if (this.#shuttingDown) return this.#waitForShutdown()

    this.#shuttingDown = true
    try {
      await this.#channel.write(currentEnvelope('shutdown'))
    } catch (error) {
      this.#finish(asError(error, 'Failed to request audio engine shutdown'))
      throw error
    }
    await this.#waitForShutdown()
  }

  dispose(): void {
    if (this.#closed) return
    this.#shuttingDown = true
    this.#channel.destroy()
    this.#audioChannel.destroy()
    this.#finish(new Error('Audio engine client disposed'))
  }

  #request(kind: 'health'): Promise<AudioEngineHealth>
  #request(kind: 'device_inventory'): Promise<readonly AudioEngineDevice[]>
  #request(
    kind: 'dsp_state',
    configuration?: RecordingDspConfiguration,
  ): Promise<RecordingDspState>
  #request(kind: 'microphone_mute_state', muted: boolean): Promise<boolean>
  #request(kind: 'system_audio_mute_state', muted: boolean): Promise<boolean>
  #request(
    kind: PendingRequest['kind'],
    value?: boolean | RecordingDspConfiguration,
  ): Promise<
    AudioEngineHealth
    | readonly AudioEngineDevice[]
    | RecordingDspState
    | boolean
  > {
    if (this.#closed || this.#shuttingDown) {
      return Promise.reject(new Error('Audio engine client is closed'))
    }
    if (this.#pending.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new Error('Too many pending audio engine control requests'))
    }

    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const pending: PendingRequest = kind === 'health'
        ? { kind, resolve: resolve as (value: AudioEngineHealth) => void, reject }
        : kind === 'device_inventory'
          ? {
              kind,
              resolve: resolve as (value: readonly AudioEngineDevice[]) => void,
              reject,
            }
          : kind === 'dsp_state'
            ? {
                kind,
                resolve: resolve as (value: RecordingDspState) => void,
                reject,
              }
            : { kind, resolve: resolve as (value: boolean) => void, reject }
      this.#pending.set(requestId, pending)
      const type = kind === 'health'
        ? 'health_check'
        : kind === 'device_inventory'
          ? 'list_devices'
          : kind === 'dsp_state'
            ? value === undefined ? 'get_dsp_state' : 'set_dsp_configuration'
            : kind === 'microphone_mute_state'
              ? 'set_microphone_muted'
              : 'set_system_audio_muted'
      const payload = kind === 'dsp_state' && typeof value === 'object'
        ? { request_id: requestId, configuration: serializeDspConfiguration(value) }
        : kind === 'microphone_mute_state' || kind === 'system_audio_mute_state'
          ? { request_id: requestId, muted: Boolean(value) }
          : { request_id: requestId }
      void this.#channel.write(currentEnvelope(type, payload)).catch((error: unknown) => {
        this.#pending.delete(requestId)
        reject(asError(error, 'Failed to write audio engine request'))
      })
    })
  }

  async #readMessages(): Promise<void> {
    try {
      while (!this.#closed) {
        const message = parseHelperMessage(await this.#channel.read())
        if (message.type === 'hello') {
          throw new Error('Audio engine sent duplicate hello after startup handshake')
        }
        if (message.type === 'error') {
          this.#onHelperError?.(message.value)
          if (!message.value.recoverable) throw message.value
          continue
        }

        const pending = this.#pending.get(message.requestId)
        if (!pending) {
          throw new Error(`Audio engine response has unknown request ID ${message.requestId}`)
        }
        if (pending.kind !== message.type) {
          throw new Error(
            `Audio engine returned ${message.type} for ${pending.kind} request ${message.requestId}`,
          )
        }
        this.#pending.delete(message.requestId)
        if (pending.kind === 'health' && message.type === 'health') {
          pending.resolve(message.value)
        } else if (pending.kind === 'device_inventory' && message.type === 'device_inventory') {
          pending.resolve(message.value)
        } else if (pending.kind === 'dsp_state' && message.type === 'dsp_state') {
          pending.resolve(message.value)
        } else if (
          pending.kind === 'microphone_mute_state'
          && message.type === 'microphone_mute_state'
        ) {
          pending.resolve(message.value)
        } else if (
          pending.kind === 'system_audio_mute_state'
          && message.type === 'system_audio_mute_state'
        ) {
          pending.resolve(message.value)
        }
      }
    } catch (error) {
      this.#finish(asError(error, 'Audio engine control channel failed'))
    }
  }

  #waitForShutdown(): Promise<void> {
    if (this.#closed) return Promise.resolve()
    return new Promise((resolve) => {
      const previous = this.#resolveShutdown
      this.#resolveShutdown = previous
        ? () => {
            previous()
            resolve()
          }
        : resolve
    })
  }

  readonly #handleAudioFailure = (error: Error): void => {
    this.#finish(error)
  }

  readonly #handleAudioClose = (): void => {
    if (!this.#closed && !this.#shuttingDown) {
      this.#finish(new Error('Audio engine audio channel closed unexpectedly'))
    }
  }

  #finish(error: Error): void {
    if (this.#closed) return
    this.#closed = true
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
    this.#channel.destroy()
    this.#audioChannel.destroy()
    this.#resolveShutdown?.()
    this.#resolveShutdown = null
    if (!this.#shuttingDown) this.#onUnexpectedClose?.(error)
  }
}

export async function connectAudioEngineClient(
  endpoints: AudioEngineEndpointPair,
  options: AudioEngineClientOptions = {},
): Promise<AudioEngineClient> {
  const expectedPlatform = toHelperPlatform(options.platform ?? process.platform)
  const controlSocket = createConnection(endpoints.control)
  const audioSocket = createConnection(endpoints.audio)
  const holdAudioErrorsDuringHandshake = () => undefined
  audioSocket.on('error', holdAudioErrorsDuringHandshake)

  try {
    await Promise.all([waitForConnection(controlSocket), waitForConnection(audioSocket)])
  } catch (error) {
    controlSocket.destroy()
    audioSocket.destroy()
    throw asError(error, 'Failed to connect to audio engine IPC')
  }

  const channel = new FramedJsonChannel(controlSocket)
  try {
    const message = parseHelperMessage(await channel.read())
    if (message.type !== 'hello') {
      throw new Error(`Expected audio engine hello, received ${message.type}`)
    }
    if (message.value.platform !== expectedPlatform) {
      throw new Error(
        `Audio engine platform is ${message.value.platform}; expected ${expectedPlatform}`,
      )
    }
    if (audioSocket.destroyed) throw new Error('Audio engine audio channel closed during handshake')

    await channel.write(currentEnvelope('hello_ack', {
      accepted_protocol_version: CONTROL_PROTOCOL_VERSION,
    }))
    const client = new ConnectedAudioEngineClient(
      channel,
      audioSocket,
      message.value,
      options.onHelperError,
      options.onUnexpectedClose,
    )
    audioSocket.off('error', holdAudioErrorsDuringHandshake)
    return client
  } catch (error) {
    channel.destroy()
    audioSocket.destroy()
    throw asError(error, 'Audio engine handshake failed')
  }
}

function waitForConnection(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onConnect = () => {
      cleanup()
      resolve()
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const cleanup = () => {
      socket.off('connect', onConnect)
      socket.off('error', onError)
    }
    socket.once('connect', onConnect)
    socket.once('error', onError)
  })
}

function currentEnvelope(type: string, payload?: Record<string, unknown>): Record<string, unknown> {
  return payload
    ? { protocol_version: CONTROL_PROTOCOL_VERSION, type, payload }
    : { protocol_version: CONTROL_PROTOCOL_VERSION, type }
}

function parseHelperMessage(value: unknown): HelperMessage {
  const envelope = requireRecord(value, 'control envelope')
  const protocolVersion = requireNonNegativeInteger(envelope.protocol_version, 'protocol_version')
  if (protocolVersion !== CONTROL_PROTOCOL_VERSION) {
    throw new Error(
      `Audio engine protocol version is ${protocolVersion}; expected ${CONTROL_PROTOCOL_VERSION}`,
    )
  }

  const type = requireString(envelope.type, 'type')
  const payload = requireRecord(envelope.payload, `${type} payload`)
  switch (type) {
    case 'hello':
      return {
        type,
        value: {
          helperVersion: requireString(payload.helper_version, 'hello.helper_version'),
          platform: requireEnum(payload.platform, ['windows', 'macos'], 'hello.platform'),
        },
      }
    case 'health':
      return {
        type,
        requestId: requireString(payload.request_id, 'health.request_id'),
        value: {
          state: requireEnum(
            payload.state,
            ['starting', 'ready', 'shutting_down'],
            'health.state',
          ),
          uptimeMs: requireNonNegativeInteger(payload.uptime_ms, 'health.uptime_ms'),
          droppedAudioFrames: requireNonNegativeInteger(
            payload.dropped_audio_frames,
            'health.dropped_audio_frames',
          ),
        },
      }
    case 'device_inventory':
      if (!Array.isArray(payload.devices)) {
        throw new Error('device_inventory.devices must be an array')
      }
      return {
        type,
        requestId: requireString(payload.request_id, 'device_inventory.request_id'),
        value: payload.devices.map((device, index) => parseDevice(device, index)),
      }
    case 'dsp_state':
      return {
        type,
        requestId: requireString(payload.request_id, 'dsp_state.request_id'),
        value: {
          configuration: parseDspConfiguration(
            payload.configuration,
            'dsp_state.configuration',
          ),
          microphone: parseDspSourceTelemetry(payload.microphone, 'dsp_state.microphone'),
          system: parseDspSourceTelemetry(payload.system, 'dsp_state.system'),
        },
      }
    case 'microphone_mute_state':
      return {
        type,
        requestId: requireString(payload.request_id, 'microphone_mute_state.request_id'),
        value: requireBoolean(payload.muted, 'microphone_mute_state.muted'),
      }
    case 'system_audio_mute_state':
      return {
        type,
        requestId: requireString(payload.request_id, 'system_audio_mute_state.request_id'),
        value: requireBoolean(payload.muted, 'system_audio_mute_state.muted'),
      }
    case 'error': {
      const source = payload.source === undefined
        ? null
        : requireEnum(payload.source, ['mic', 'system'], 'error.source')
      return {
        type,
        value: new AudioEngineProtocolError(
          requireString(payload.code, 'error.code'),
          requireString(payload.message, 'error.message'),
          requireBoolean(payload.recoverable, 'error.recoverable'),
          source,
        ),
      }
    }
    default:
      throw new Error(`Unknown audio engine control message type ${type}`)
  }
}

function parseDspConfiguration(
  value: unknown,
  name: string,
): RecordingDspConfiguration {
  const configuration = requireRecord(value, name)
  return {
    voiceActivityDetection: requireBoolean(
      configuration.voice_activity_detection,
      `${name}.voice_activity_detection`,
    ),
    automaticGainControl: requireBoolean(
      configuration.automatic_gain_control,
      `${name}.automatic_gain_control`,
    ),
    noiseSuppression: requireBoolean(
      configuration.noise_suppression,
      `${name}.noise_suppression`,
    ),
    echoCancellation: requireBoolean(
      configuration.echo_cancellation,
      `${name}.echo_cancellation`,
    ),
  }
}

function parseDspSourceTelemetry(
  value: unknown,
  name: string,
): RecordingDspSourceTelemetry {
  const telemetry = requireRecord(value, name)
  return {
    hasProcessedAudio: requireBoolean(telemetry.has_processed_audio, `${name}.has_processed_audio`),
    voiceActivityDetectionActive: requireBoolean(
      telemetry.voice_activity_detection_active,
      `${name}.voice_activity_detection_active`,
    ),
    automaticGainControlActive: requireBoolean(
      telemetry.automatic_gain_control_active,
      `${name}.automatic_gain_control_active`,
    ),
    noiseSuppressionActive: requireBoolean(
      telemetry.noise_suppression_active,
      `${name}.noise_suppression_active`,
    ),
    echoCancellationActive: requireBoolean(
      telemetry.echo_cancellation_active,
      `${name}.echo_cancellation_active`,
    ),
    effectiveGainDb: requireNullableFiniteNumber(
      telemetry.effective_gain_db,
      `${name}.effective_gain_db`,
    ),
    echoReturnLossDb: requireNullableFiniteNumber(
      telemetry.echo_return_loss_db,
      `${name}.echo_return_loss_db`,
    ),
    echoReturnLossEnhancementDb: requireNullableFiniteNumber(
      telemetry.echo_return_loss_enhancement_db,
      `${name}.echo_return_loss_enhancement_db`,
    ),
    divergentFilterFraction: requireNullableUnitInterval(
      telemetry.divergent_filter_fraction,
      `${name}.divergent_filter_fraction`,
    ),
    residualEchoLikelihood: requireNullableUnitInterval(
      telemetry.residual_echo_likelihood,
      `${name}.residual_echo_likelihood`,
    ),
    delayMs: requireNullableInteger(telemetry.delay_ms, `${name}.delay_ms`),
  }
}

function serializeDspConfiguration(
  configuration: RecordingDspConfiguration,
): Record<string, boolean> {
  return {
    voice_activity_detection: configuration.voiceActivityDetection,
    automatic_gain_control: configuration.automaticGainControl,
    noise_suppression: configuration.noiseSuppression,
    echo_cancellation: configuration.echoCancellation,
  }
}

function parseDevice(value: unknown, index: number): AudioEngineDevice {
  const device = requireRecord(value, `device_inventory.devices[${index}]`)
  return {
    id: requireString(device.id, `device_inventory.devices[${index}].id`),
    name: requireString(device.name, `device_inventory.devices[${index}].name`),
    kind: requireEnum(
      device.kind,
      ['microphone', 'system_output'],
      `device_inventory.devices[${index}].kind`,
    ),
    isDefault: requireBoolean(device.is_default, `device_inventory.devices[${index}].is_default`),
    isAvailable: requireBoolean(
      device.is_available,
      `device_inventory.devices[${index}].is_available`,
    ),
  }
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`)
  return value
}

function requireNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return value
}

function requireNullableFiniteNumber(value: unknown, name: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number or null`)
  }
  return value
}

function requireNullableInteger(value: unknown, name: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer or null`)
  }
  return value
}

function requireNullableUnitInterval(value: unknown, name: string): number | null {
  const number = requireNullableFiniteNumber(value, name)
  if (number !== null && (number < 0 || number > 1)) {
    throw new Error(`${name} must be between 0 and 1 or null`)
  }
  return number
}

function requireEnum<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${name} must be one of ${allowed.join(', ')}`)
  }
  return value as T
}

function toHelperPlatform(platform: NodeJS.Platform): HelperPlatform {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  throw new Error(`The audio engine does not support ${platform}`)
}

function asError(error: unknown, context: string): Error {
  if (error instanceof Error) return error
  return new Error(`${context}: ${String(error)}`)
}
