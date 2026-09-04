import { app } from 'electron'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'

import {
  connectAudioEngineClient,
  type AudioEngineClient,
  type AudioEngineProtocolError,
} from './audio-engine-client'
import {
  AUDIO_ENGINE_READY_LINE,
  createAudioEngineLaunchContract,
  type AudioEngineLaunchContract,
} from './audio-engine-launch'

const DEFAULT_STARTUP_TIMEOUT_MS = 5_000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000
const MAX_STDOUT_LINE_BYTES = 64
const MAX_RESTART_ATTEMPTS = 1
const INITIAL_RESTART_DELAY_MS = 250
const MAX_RESTART_DELAY_MS = 2_000

type AudioEngineTimer = ReturnType<typeof setTimeout>

export type AudioEngineConnection = {
  readonly instanceId: string
  readonly pid: number
  readonly launch: AudioEngineLaunchContract
  readonly client: AudioEngineClient
}

export type AudioEngineSupervisorOptions = {
  binaryPath?: string
  runtimeDirectory?: string
  platform?: NodeJS.Platform
  startupTimeoutMs?: number
  shutdownTimeoutMs?: number
  onConnectionChanged?: (connection: AudioEngineConnection | null) => void
  onHelperError?: (error: AudioEngineProtocolError) => void
  onUnavailable?: (error: Error) => void
}

export type AudioEngineSupervisor = {
  getConnection(): AudioEngineConnection | null
  start(): Promise<AudioEngineConnection>
  stop(): Promise<void>
  dispose(): void
}

type SpawnedHelper = {
  child: ChildProcess
  connection: AudioEngineConnection
}

class AudioEngineProcessSupervisor implements AudioEngineSupervisor {
  readonly #binaryPath: string
  readonly #runtimeDirectory: string
  readonly #platform: NodeJS.Platform
  readonly #startupTimeoutMs: number
  readonly #shutdownTimeoutMs: number
  readonly #onConnectionChanged: ((connection: AudioEngineConnection | null) => void) | undefined
  readonly #onHelperError: ((error: AudioEngineProtocolError) => void) | undefined
  readonly #onUnavailable: ((error: Error) => void) | undefined

  #connection: AudioEngineConnection | null = null
  #child: ChildProcess | null = null
  #startPromise: Promise<AudioEngineConnection> | null = null
  #stopPromise: Promise<void> | null = null
  #restartTimer: AudioEngineTimer | null = null
  #restartAttempts = 0
  #generation = 0
  #desired = false
  #disposed = false

  constructor(options: AudioEngineSupervisorOptions) {
    this.#platform = options.platform ?? process.platform
    this.#binaryPath = options.binaryPath ?? resolveAudioEngineBinary(this.#platform)
    this.#runtimeDirectory = options.runtimeDirectory ?? app.getPath('temp')
    this.#startupTimeoutMs = positiveDuration(
      options.startupTimeoutMs,
      DEFAULT_STARTUP_TIMEOUT_MS,
      'startupTimeoutMs',
    )
    this.#shutdownTimeoutMs = positiveDuration(
      options.shutdownTimeoutMs,
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
      'shutdownTimeoutMs',
    )
    this.#onConnectionChanged = options.onConnectionChanged
    this.#onHelperError = options.onHelperError
    this.#onUnavailable = options.onUnavailable
  }

  getConnection(): AudioEngineConnection | null {
    return this.#connection
  }

  start(): Promise<AudioEngineConnection> {
    if (this.#disposed) return Promise.reject(new Error('Audio engine supervisor is disposed'))
    if (this.#stopPromise) return this.#stopPromise.then(() => this.start())
    if (this.#connection) return Promise.resolve(this.#connection)
    if (this.#startPromise) return this.#startPromise

    if (!this.#desired) {
      this.#desired = true
      this.#restartAttempts = 0
    }
    return this.#beginStart()
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise
    this.#stopPromise = this.#stopInternal().finally(() => {
      this.#stopPromise = null
    })
    return this.#stopPromise
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#desired = false
    this.#generation += 1
    this.#clearRestartTimer()
    const hadConnection = this.#connection !== null
    this.#connection?.client.dispose()
    this.#connection = null
    if (hadConnection) this.#onConnectionChanged?.(null)
    terminateProcess(this.#child)
    this.#child = null
  }

  #beginStart(): Promise<AudioEngineConnection> {
    const generation = ++this.#generation
    const startPromise = this.#spawnOne(generation)
      .then(({ child, connection }) => {
        if (!this.#desired || this.#disposed || generation !== this.#generation) {
          connection.client.dispose()
          terminateProcess(child)
          throw new Error('Audio engine startup was superseded')
        }

        this.#child = child
        this.#connection = connection
        this.#onConnectionChanged?.(connection)
        return connection
      })
      .catch((error: unknown) => {
        const failure = asError(error, 'Audio engine startup failed')
        if (generation === this.#generation) {
          terminateProcess(this.#child)
          this.#child = null
          if (this.#desired && !this.#disposed) this.#scheduleRestart(failure)
        }
        throw failure
      })
      .finally(() => {
        if (this.#startPromise === startPromise) this.#startPromise = null
      })

    this.#startPromise = startPromise
    return startPromise
  }

  async #spawnOne(generation: number): Promise<SpawnedHelper> {
    await access(this.#binaryPath, constants.X_OK)
    if (!this.#desired || this.#disposed || generation !== this.#generation) {
      throw new Error('Audio engine startup was superseded before process creation')
    }
    const startupDeadline = Date.now() + this.#startupTimeoutMs
    const launch = createAudioEngineLaunchContract(this.#runtimeDirectory, this.#platform)
    const child = spawn(this.#binaryPath, launch.args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.#child = child

    if (!child.stdout || !child.stderr) {
      terminateProcess(child)
      throw new Error('Audio engine did not expose stdout and stderr pipes')
    }

    discardPrivateStderr(child.stderr)
    const processEnd = waitForProcessEnd(child)
    let established = false
    let earlyFailure: Error | null = null
    const reportFailure = (error: Error) => {
      if (established) this.#handleUnexpectedFailure(generation, error)
      else earlyFailure = error
    }

    try {
      await Promise.race([
        waitForExactReadiness(
          child.stdout,
          remainingDuration(startupDeadline, 'Audio engine readiness timed out'),
          reportFailure,
        ),
        rejectWhenProcessEnds(processEnd),
      ])
      if (earlyFailure) throw earlyFailure

      const client = await withTimeout(
        Promise.race([
          connectAudioEngineClient(launch.endpoints, {
            platform: this.#platform,
            onHelperError: this.#onHelperError,
            onUnexpectedClose: reportFailure,
          }),
          rejectWhenProcessEnds(processEnd),
        ]),
        remainingDuration(startupDeadline, 'Audio engine handshake timed out'),
        'Audio engine handshake timed out',
      )
      try {
        const health = await withTimeout(
          Promise.race([
            client.health(),
            rejectWhenProcessEnds(processEnd),
          ]),
          remainingDuration(startupDeadline, 'Audio engine health check timed out'),
          'Audio engine health check timed out',
        )
        if (health.state !== 'ready') {
          throw new Error(`Audio engine reported ${health.state} after startup handshake`)
        }
        if (earlyFailure) throw earlyFailure
        if (!child.pid) throw new Error('Audio engine process has no PID')

        const connection: AudioEngineConnection = {
          instanceId: launch.instanceId,
          pid: child.pid,
          launch,
          client,
        }
        established = true
        void processEnd.then((error) => reportFailure(error))
        return { child, connection }
      } catch (error) {
        client.dispose()
        throw error
      }
    } catch (error) {
      terminateProcess(child)
      throw asError(error, 'Audio engine failed to start')
    }
  }

  #handleUnexpectedFailure(generation: number, error: Error): void {
    if (generation !== this.#generation || !this.#desired || this.#disposed) return

    this.#generation += 1
    const hadConnection = this.#connection !== null
    this.#connection?.client.dispose()
    this.#connection = null
    if (hadConnection) this.#onConnectionChanged?.(null)
    terminateProcess(this.#child)
    this.#child = null
    this.#scheduleRestart(error)
  }

  #scheduleRestart(error: Error): void {
    if (this.#restartTimer || !this.#desired || this.#disposed) return

    this.#restartAttempts += 1
    if (this.#restartAttempts > MAX_RESTART_ATTEMPTS) {
      this.#desired = false
      this.#onUnavailable?.(new Error(
        `Audio engine remained unavailable after ${MAX_RESTART_ATTEMPTS} restart attempts: ${error.message}`,
      ))
      return
    }

    const delay = Math.min(
      INITIAL_RESTART_DELAY_MS * 2 ** (this.#restartAttempts - 1),
      MAX_RESTART_DELAY_MS,
    )
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null
      if (!this.#desired || this.#disposed || this.#startPromise) return
      void this.#beginStart().catch(() => {
        // #beginStart records the failure and schedules the next bounded attempt.
      })
    }, delay)
  }

  async #stopInternal(): Promise<void> {
    const pendingStart = this.#startPromise
    this.#desired = false
    this.#generation += 1
    this.#clearRestartTimer()

    const connection = this.#connection
    const child = this.#child
    this.#connection = null
    this.#child = null
    if (connection) this.#onConnectionChanged?.(null)

    if (connection) {
      try {
        await withTimeout(
          connection.client.shutdown(),
          this.#shutdownTimeoutMs,
          'Audio engine graceful shutdown timed out',
        )
      } catch {
        connection.client.dispose()
      }
    }

    if (child && child.exitCode === null && child.signalCode === null) {
      if (connection) await waitForProcessExit(child, this.#shutdownTimeoutMs)
      if (child.exitCode === null && child.signalCode === null) {
        terminateProcess(child)
        await waitForProcessExit(child, this.#shutdownTimeoutMs)
      }
    }

    if (pendingStart) {
      await withTimeout(
        pendingStart.then(() => undefined, () => undefined),
        this.#shutdownTimeoutMs,
        'Audio engine startup teardown timed out',
      ).catch(() => undefined)
    }
  }

  #clearRestartTimer(): void {
    if (!this.#restartTimer) return
    clearTimeout(this.#restartTimer)
    this.#restartTimer = null
  }
}

export function createAudioEngineSupervisor(
  options: AudioEngineSupervisorOptions = {},
): AudioEngineSupervisor {
  return new AudioEngineProcessSupervisor(options)
}

export function resolveAudioEngineBinary(
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32' && platform !== 'darwin') {
    throw new Error(`The audio engine does not support ${platform}`)
  }

  const executable = platform === 'win32' ? 'orion-audio-engine.exe' : 'orion-audio-engine'
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin', executable)

  const appRoot = process.env.APP_ROOT
  if (!appRoot) throw new Error('APP_ROOT is unavailable for audio engine binary resolution')
  return path.resolve(appRoot, 'native', 'audio-engine', 'target', 'debug', executable)
}

function waitForExactReadiness(
  stdout: Readable,
  timeoutMs: number,
  onUnexpectedOutput: (error: Error) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)
    let ready = false
    const timeout = setTimeout(() => {
      cleanupBeforeReady()
      reject(new Error(`Audio engine readiness timed out after ${timeoutMs} ms`))
    }, timeoutMs)

    const onData = (chunk: Buffer) => {
      if (ready) {
        onUnexpectedOutput(new Error('Audio engine wrote unexpected stdout after readiness'))
        return
      }

      buffer = buffer.byteLength === 0 ? chunk : Buffer.concat([buffer, chunk])
      if (buffer.byteLength > MAX_STDOUT_LINE_BYTES) {
        cleanupBeforeReady()
        reject(new Error('Audio engine readiness output exceeded its line limit'))
        return
      }

      const newlineIndex = buffer.indexOf(0x0a)
      if (newlineIndex < 0) return
      const line = buffer.subarray(0, newlineIndex + 1).toString('utf8')
      const trailingBytes = buffer.byteLength - newlineIndex - 1
      if (line !== `${AUDIO_ENGINE_READY_LINE}\n` || trailingBytes !== 0) {
        cleanupBeforeReady()
        reject(new Error('Audio engine emitted invalid readiness output'))
        return
      }

      ready = true
      clearTimeout(timeout)
      resolve()
    }

    const onEndBeforeReady = () => {
      if (ready) return
      cleanupBeforeReady()
      reject(new Error('Audio engine stdout closed before readiness'))
    }

    const cleanupBeforeReady = () => {
      clearTimeout(timeout)
      stdout.off('data', onData)
      stdout.off('end', onEndBeforeReady)
    }

    stdout.on('data', onData)
    stdout.once('end', onEndBeforeReady)
  })
}

function discardPrivateStderr(stderr: Readable): void {
  // Helper failures can contain device labels and per-user endpoint paths.
  // Drain the pipe to avoid backpressure, but never retain or log its contents.
  stderr.on('data', () => undefined)
}

function waitForProcessEnd(child: ChildProcess): Promise<Error> {
  return new Promise((resolve) => {
    let ended = false
    const finish = (error: Error) => {
      if (ended) return
      ended = true
      resolve(error)
    }
    child.once('error', (error) => finish(error))
    child.once('exit', (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`
      finish(new Error(`Audio engine exited with ${detail}`))
    })
  })
}

async function rejectWhenProcessEnds(processEnd: Promise<Error>): Promise<never> {
  throw await processEnd
}

function terminateProcess(child: ChildProcess | null): void {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill()
}

async function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}

function remainingDuration(deadline: number, message: string): number {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error(message)
  return remaining
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: AudioEngineTimer | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function positiveDuration(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function asError(error: unknown, context: string): Error {
  if (error instanceof Error) return error
  return new Error(`${context}: ${String(error)}`)
}
