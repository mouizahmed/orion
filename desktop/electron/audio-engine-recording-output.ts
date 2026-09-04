import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmod,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises'
import path from 'node:path'

import { app } from 'electron'

import type { AudioEngineAudioFrame } from './audio-engine-audio'

const MAX_PCM_BYTES_PER_SOURCE = 4 * 1024 * 1024 * 1024
const ENCODER_TIMEOUT_MS = 30 * 60 * 1000
const MAX_SPOOL_OWNER_MARKER_BYTES = 1024
const RECORDING_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/
const UUID_IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const STAGING_DIRECTORY = /^\.orion-([0-9a-f-]{36})\.tmp$/
const SPOOL_OWNER_MARKER = '.orion-owner.json'
const SPOOL_OWNER_ID_FILE = 'recording-spool-owner-id'
let spoolOwnerIdPromise: Promise<string> | null = null

export type LocalAudioRecordingOutputOptions = {
  directory: string
  noteId: string
  sessionId: string
  startedAt: number
}

export type LocalAudioRecordingResult = {
  kind: 'local'
  directory: string
}

export type AudioRecordingResult = LocalAudioRecordingResult | { kind: 'none' }

export type AudioRecordingOutput = {
  write(frame: AudioEngineAudioFrame): Promise<void>
  finish(stoppedAt: number): Promise<AudioRecordingResult>
  abort(): Promise<void>
}

type TrackMetadata = {
  source: AudioEngineAudioFrame['source']
  file: string
  processing: 'opus'
  container: 'ogg'
  codec: 'opus'
  sample_rate_hz: 48_000
  channels: 1
  frame_count: number
  first_frame_at: string | null
  last_frame_at: string | null
}

/**
 * Spools normalized PCM to owner-only temporary files and converts each
 * non-empty source to Ogg Opus at stop. Only the atomically published Opus
 * files and manifest survive successful finalization.
 */
export class LocalAudioRecordingOutput {
  readonly #finalDirectory: string
  readonly #stagingDirectory: string
  readonly #noteId: string
  readonly #sessionId: string
  readonly #startedAt: number
  readonly #tracks: Record<AudioEngineAudioFrame['source'], PcmTrackWriter>
  #writePending = false
  #finished = false

  private constructor(
    options: LocalAudioRecordingOutputOptions,
    finalDirectory: string,
    stagingDirectory: string,
    tracks: Record<AudioEngineAudioFrame['source'], PcmTrackWriter>,
  ) {
    this.#finalDirectory = finalDirectory
    this.#stagingDirectory = stagingDirectory
    this.#noteId = options.noteId
    this.#sessionId = options.sessionId
    this.#startedAt = options.startedAt
    this.#tracks = tracks
  }

  static async create(
    options: LocalAudioRecordingOutputOptions,
  ): Promise<LocalAudioRecordingOutput> {
    if (!path.isAbsolute(options.directory)) {
      throw new Error('Local recording directory must be absolute')
    }
    validateIdentifier(options.noteId, 'note ID')
    validateIdentifier(options.sessionId, 'session ID')
    if (!Number.isSafeInteger(options.startedAt) || options.startedAt <= 0) {
      throw new Error('Local recording start time is invalid')
    }

    const rootDirectory = path.resolve(options.directory)
    const finalDirectory = directChild(rootDirectory, options.sessionId)
    const stagingDirectory = directChild(rootDirectory, `.orion-${options.sessionId}.tmp`)
    await mkdir(rootDirectory, { recursive: true })
    await rm(stagingDirectory, { recursive: true, force: true })
    await mkdir(stagingDirectory, { mode: 0o700 })

    try {
      await writeSpoolOwnerMarker(stagingDirectory)
      const microphone = await PcmTrackWriter.create(stagingDirectory, 'mic', 'microphone')
      try {
        const system = await PcmTrackWriter.create(stagingDirectory, 'system', 'system')
        return new LocalAudioRecordingOutput(
          options,
          finalDirectory,
          stagingDirectory,
          { mic: microphone, system },
        )
      } catch (error) {
        await microphone.close().catch(() => undefined)
        throw error
      }
    } catch (error) {
      await rm(stagingDirectory, { recursive: true, force: true })
      throw error
    }
  }

  async write(frame: AudioEngineAudioFrame): Promise<void> {
    if (this.#finished) throw new Error('Local recording output is already finished')
    if (this.#writePending) throw new Error('Concurrent local recording writes are not allowed')
    this.#writePending = true
    try {
      await this.#tracks[frame.source].write(frame)
    } finally {
      this.#writePending = false
    }
  }

  async finish(stoppedAt: number): Promise<AudioRecordingResult> {
    if (this.#finished) throw new Error('Local recording output is already finished')
    if (this.#writePending) throw new Error('Local recording output still has a pending frame')
    if (!Number.isSafeInteger(stoppedAt) || stoppedAt < this.#startedAt) {
      throw new Error('Local recording stop time is invalid')
    }
    this.#finished = true

    try {
      await closeTracks(this.#tracks)
      const populatedTracks = [this.#tracks.mic, this.#tracks.system].filter(
        (track) => track.hasAudio,
      )
      if (populatedTracks.length === 0) {
        await this.#cleanStagingDirectory()
        return { kind: 'none' }
      }

      const ffmpegPath = resolveFfmpegPath()
      for (const track of populatedTracks) await track.encode(ffmpegPath)
      await Promise.all([
        unlink(this.#tracks.mic.pcmPath),
        unlink(this.#tracks.system.pcmPath),
      ])

      const manifest = {
        format_version: 1,
        note_id: this.#noteId,
        session_id: this.#sessionId,
        started_at: new Date(this.#startedAt).toISOString(),
        stopped_at: new Date(stoppedAt).toISOString(),
        tracks: populatedTracks.map((track) => track.metadata()),
      }
      const temporaryManifest = path.join(this.#stagingDirectory, 'recording.json.tmp')
      const manifestPath = path.join(this.#stagingDirectory, 'recording.json')
      await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      await syncFile(temporaryManifest)
      await rename(temporaryManifest, manifestPath)
      await unlink(path.join(this.#stagingDirectory, SPOOL_OWNER_MARKER))
      await rename(this.#stagingDirectory, this.#finalDirectory)
      return { kind: 'local', directory: this.#finalDirectory }
    } catch (error) {
      await this.#cleanStagingDirectory().catch(() => undefined)
      throw error
    }
  }

  async abort(): Promise<void> {
    if (this.#finished) return
    if (this.#writePending) throw new Error('Local recording output still has a pending frame')
    this.#finished = true
    let closeError: unknown = null
    try {
      await closeTracks(this.#tracks)
    } catch (error) {
      closeError = error
    }
    await this.#cleanStagingDirectory()
    if (closeError) throw closeError
  }

  async #cleanStagingDirectory(): Promise<void> {
    await rm(this.#stagingDirectory, { recursive: true, force: true })
  }
}

/** Removes interrupted local spools owned by this desktop installation. */
export async function cleanupStaleLocalAudioStaging(
  directory: string,
  activeSessionId?: string,
): Promise<number> {
  if (!path.isAbsolute(directory)) {
    throw new Error('Local recording directory must be absolute')
  }
  if (activeSessionId !== undefined && !UUID_IDENTIFIER.test(activeSessionId)) {
    throw new Error('Active local recording session ID is invalid')
  }
  const rootDirectory = path.resolve(directory)
  const entries = await readdir(rootDirectory, { withFileTypes: true }).catch((error: unknown) => {
    if (hasErrorCode(error, 'ENOENT')) return null
    throw error
  })
  if (entries === null) return 0
  const ownerId = await getSpoolOwnerId()
  let removed = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const match = STAGING_DIRECTORY.exec(entry.name)
    if (!match || !UUID_IDENTIFIER.test(match[1]) || match[1] === activeSessionId) continue
    const stagingDirectory = directChild(rootDirectory, entry.name)
    const marker = await readSpoolOwnerMarker(stagingDirectory)
    if (marker !== ownerId) continue
    await rm(stagingDirectory, { recursive: true, force: true })
    removed++
  }
  return removed
}

class PcmTrackWriter {
  readonly #handle: FileHandle
  readonly #source: AudioEngineAudioFrame['source']
  readonly #baseName: string
  readonly pcmPath: string
  readonly oggPath: string
  #dataBytes = 0
  #frameCount = 0
  #firstFrameAt: number | null = null
  #lastFrameAt: number | null = null
  #closed = false

  private constructor(
    handle: FileHandle,
    directory: string,
    source: AudioEngineAudioFrame['source'],
    baseName: string,
  ) {
    this.#handle = handle
    this.#source = source
    this.#baseName = baseName
    this.pcmPath = path.join(directory, `${baseName}.pcm`)
    this.oggPath = path.join(directory, `${baseName}.ogg`)
  }

  static async create(
    directory: string,
    source: AudioEngineAudioFrame['source'],
    baseName: string,
  ): Promise<PcmTrackWriter> {
    const pcmPath = path.join(directory, `${baseName}.pcm`)
    const handle = await open(pcmPath, 'wx', 0o600)
    return new PcmTrackWriter(handle, directory, source, baseName)
  }

  get hasAudio(): boolean {
    return this.#dataBytes > 0
  }

  async write(frame: AudioEngineAudioFrame): Promise<void> {
    if (this.#closed) throw new Error(`${this.#source} recording track is closed`)
    if (frame.source !== this.#source) {
      throw new Error(`Cannot write ${frame.source} audio to the ${this.#source} track`)
    }
    if (frame.sampleRateHz !== 48_000 || frame.channels !== 1 || frame.sampleFormat !== 'pcm_s16_le') {
      throw new Error('Local recording output requires 48 kHz mono PCM16 frames')
    }
    if (this.#dataBytes + frame.pcm.byteLength > MAX_PCM_BYTES_PER_SOURCE) {
      throw new Error(`${this.#source} local recording exceeds the spool size limit`)
    }

    await writeAll(this.#handle, frame.pcm, this.#dataBytes)
    const receivedAt = Date.now()
    this.#firstFrameAt ??= receivedAt
    this.#lastFrameAt = receivedAt
    this.#dataBytes += frame.pcm.byteLength
    this.#frameCount += frame.frameCount
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    try {
      await this.#handle.sync()
    } finally {
      await this.#handle.close()
    }
  }

  async encode(ffmpegPath: string): Promise<void> {
    if (!this.#closed) throw new Error(`${this.#source} recording track is still open`)
    if (!this.hasAudio) throw new Error(`${this.#source} recording track is empty`)
    const temporaryOggPath = `${this.oggPath}.tmp`
    await unlink(temporaryOggPath).catch(ignoreMissingFile)
    try {
      await runEncoder(ffmpegPath, this.pcmPath, temporaryOggPath)
      const encoded = await stat(temporaryOggPath)
      if (!encoded.isFile() || encoded.size === 0) {
        throw new Error(`${this.#source} Opus encoder produced no audio`)
      }
      await chmod(temporaryOggPath, 0o600)
      await syncFile(temporaryOggPath)
      await rename(temporaryOggPath, this.oggPath)
    } catch (error) {
      await unlink(temporaryOggPath).catch(ignoreMissingFile)
      throw error
    }
  }

  metadata(): TrackMetadata {
    return {
      source: this.#source,
      file: `${this.#baseName}.ogg`,
      processing: 'opus',
      container: 'ogg',
      codec: 'opus',
      sample_rate_hz: 48_000,
      channels: 1,
      frame_count: this.#frameCount,
      first_frame_at: toIsoString(this.#firstFrameAt),
      last_frame_at: toIsoString(this.#lastFrameAt),
    }
  }
}

async function closeTracks(
  tracks: Record<AudioEngineAudioFrame['source'], PcmTrackWriter>,
): Promise<void> {
  const results = await Promise.allSettled([tracks.mic.close(), tracks.system.close()])
  const failed = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failed) throw failed.reason
}

async function runEncoder(ffmpegPath: string, inputPath: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const processHandle = spawn(ffmpegPath, [
      '-nostdin',
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      's16le',
      '-ar',
      '48000',
      '-ac',
      '1',
      '-i',
      inputPath,
      '-vn',
      '-c:a',
      'libopus',
      '-b:a',
      '48k',
      '-vbr',
      'on',
      '-application',
      'audio',
      '-f',
      'ogg',
      outputPath,
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    })
    let settled = false
    let timedOut = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve()
    }
    const timeout = setTimeout(() => {
      timedOut = true
      processHandle.kill()
    }, ENCODER_TIMEOUT_MS)
    // FFmpeg diagnostics include the user-selected recording path. Drain them,
    // but expose only process status to application logs.
    processHandle.stderr.on('data', () => undefined)
    processHandle.once('error', () => finish(new Error('Could not start the local Opus encoder')))
    processHandle.once('close', (code, signal) => {
      if (timedOut) {
        finish(new Error('Local Opus encoding timed out'))
        return
      }
      if (code === 0) {
        finish()
        return
      }
      const outcome = signal ? `signal ${signal}` : `exit code ${String(code)}`
      finish(new Error(`Local Opus encoding failed with ${outcome}`))
    })
  })
}

async function writeAll(handle: FileHandle, buffer: Buffer<ArrayBufferLike>, position: number) {
  let written = 0
  while (written < buffer.byteLength) {
    const result = await handle.write(buffer, written, buffer.byteLength - written, position + written)
    if (result.bytesWritten === 0) throw new Error('Local recording write made no progress')
    written += result.bytesWritten
  }
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeSpoolOwnerMarker(stagingDirectory: string): Promise<void> {
  const markerPath = path.join(stagingDirectory, SPOOL_OWNER_MARKER)
  await writeFile(markerPath, `${JSON.stringify({ version: 1, owner_id: await getSpoolOwnerId() })}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  await syncFile(markerPath)
}

async function readSpoolOwnerMarker(stagingDirectory: string): Promise<string | null> {
  const markerPath = path.join(stagingDirectory, SPOOL_OWNER_MARKER)
  let handle: FileHandle
  try {
    handle = await open(markerPath, 'r')
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null
    throw error
  }
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size <= 0 || info.size > MAX_SPOOL_OWNER_MARKER_BYTES) return null
    const contents = Buffer.alloc(Number(info.size))
    const { bytesRead } = await handle.read(contents, 0, contents.byteLength, 0)
    if (bytesRead !== contents.byteLength) return null
    const parsed = JSON.parse(contents.toString('utf8')) as { version?: unknown; owner_id?: unknown }
    return parsed.version === 1 && typeof parsed.owner_id === 'string'
      && UUID_IDENTIFIER.test(parsed.owner_id)
      ? parsed.owner_id
      : null
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

function getSpoolOwnerId(): Promise<string> {
  spoolOwnerIdPromise ??= loadOrCreateSpoolOwnerId()
  return spoolOwnerIdPromise
}

async function loadOrCreateSpoolOwnerId(): Promise<string> {
  const ownerPath = path.join(app.getPath('userData'), SPOOL_OWNER_ID_FILE)
  const existing = await readOwnerId(ownerPath)
  if (existing) return existing
  const ownerId = randomUUID()
  try {
    await writeFile(ownerPath, `${ownerId}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await chmod(ownerPath, 0o600)
    await syncFile(ownerPath)
    return ownerId
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) throw error
    const concurrent = await readOwnerId(ownerPath)
    if (concurrent) return concurrent
    throw new Error('Local recording spool owner ID is invalid')
  }
}

async function readOwnerId(ownerPath: string): Promise<string | null> {
  let handle: FileHandle
  try {
    handle = await open(ownerPath, 'r')
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null
    throw error
  }
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size <= 0 || info.size > 64) return null
    const contents = Buffer.alloc(Number(info.size))
    const { bytesRead } = await handle.read(contents, 0, contents.byteLength, 0)
    if (bytesRead !== contents.byteLength) return null
    const ownerId = contents.toString('utf8').trim()
    return UUID_IDENTIFIER.test(ownerId) ? ownerId : null
  } finally {
    await handle.close()
  }
}

function resolveFfmpegPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  }
  const configuredPath = process.env.ORION_RECORDING_FFMPEG_PATH?.trim()
  if (configuredPath) {
    if (!path.isAbsolute(configuredPath)) {
      throw new Error('ORION_RECORDING_FFMPEG_PATH must be absolute')
    }
    return configuredPath
  }
  return 'ffmpeg'
}

function directChild(rootDirectory: string, name: string): string {
  const candidate = path.resolve(rootDirectory, name)
  if (path.dirname(candidate) !== rootDirectory || candidate === rootDirectory) {
    throw new Error('Local recording path escaped its configured directory')
  }
  return candidate
}

function validateIdentifier(value: string, label: string) {
  if (!RECORDING_IDENTIFIER.test(value)) throw new Error(`Local recording ${label} is invalid`)
}

function toIsoString(value: number | null) {
  return value === null ? null : new Date(value).toISOString()
}

function ignoreMissingFile(error: unknown): void {
  if (hasErrorCode(error, 'ENOENT')) return
  throw error
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
