import { desktopApi } from '@/lib/desktop-api'

export type AudioChunkCallback = (pcmBuffer: ArrayBuffer) => void

export interface AudioCaptureHandle {
  stop(): void
  mute(): void
  unmute(): void
}

const noopHandle: AudioCaptureHandle = {
  stop() {},
  mute() {},
  unmute() {},
}

/**
 * Start capturing microphone audio via getUserMedia + AudioWorklet.
 * Returns a handle to stop/mute/unmute the capture.
 */
export async function startMicCapture(onChunk: AudioChunkCallback): Promise<AudioCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 48000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })

  const ctx = new AudioContext({ sampleRate: 48000 })
  await ctx.audioWorklet.addModule('audio-worklet-processor.js')

  const source = ctx.createMediaStreamSource(stream)
  const worklet = new AudioWorkletNode(ctx, 'pcm-processor')

  worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    onChunk(event.data)
  }

  source.connect(worklet)
  // Don't connect to destination — we don't want playback, just capture

  return {
    stop() {
      worklet.port.onmessage = null
      worklet.disconnect()
      source.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
    },
    mute() {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = false
      })
    },
    unmute() {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = true
      })
    },
  }
}

/**
 * Start capturing system audio. Platform-specific:
 * - Windows: Electron desktopCapturer → getUserMedia → AudioWorklet
 * - macOS: IPC to Swift helper binary, receives PCM chunks via IPC events
 */
export async function startSystemAudioCapture(onChunk: AudioChunkCallback): Promise<AudioCaptureHandle> {
  const platform = desktopApi.platform.current()

  try {
    if (platform === 'darwin') {
      return await startMacOSSystemCapture(onChunk)
    } else {
      return await startWindowsSystemCapture(onChunk)
    }
  } catch (err) {
    console.warn('System audio capture unavailable, continuing mic-only:', err)
    return noopHandle
  }
}

/**
 * Windows: use Electron desktopCapturer to get system audio via getUserMedia
 */
async function startWindowsSystemCapture(onChunk: AudioChunkCallback): Promise<AudioCaptureHandle> {
  // Use getDisplayMedia + Electron display-media request handler (main process).
  // Chromium has tightened validation around legacy desktop getUserMedia constraints,
  // and they can terminate the renderer with a bad IPC message.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true,
  })

  // We only need the loopback audio track.
  stream.getVideoTracks().forEach((track) => track.stop())

  const ctx = new AudioContext({ sampleRate: 48000 })
  await ctx.audioWorklet.addModule('audio-worklet-processor.js')

  const source = ctx.createMediaStreamSource(stream)
  const worklet = new AudioWorkletNode(ctx, 'pcm-processor')

  worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    onChunk(event.data)
  }

  source.connect(worklet)

  return {
    stop() {
      worklet.port.onmessage = null
      worklet.disconnect()
      source.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
    },
    mute() {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = false
      })
    },
    unmute() {
      stream.getAudioTracks().forEach((t) => {
        t.enabled = true
      })
    },
  }
}

/**
 * macOS: spawn Swift helper via IPC, receive PCM chunks via IPC events
 */
async function startMacOSSystemCapture(onChunk: AudioChunkCallback): Promise<AudioCaptureHandle> {
  await desktopApi.audio.startSystemAudioStream()

  const cleanup = desktopApi.audio.onSystemAudioChunk((buffer: ArrayBuffer) => {
    onChunk(buffer)
  })

  return {
    stop() {
      cleanup()
      desktopApi.audio.stopSystemAudioStream()
    },
    mute() {
      // For macOS, we handle muting at the Deepgram level (fill silence)
      // since we can't easily mute the process tap
    },
    unmute() {
      // No-op: handled at Deepgram level
    },
  }
}
