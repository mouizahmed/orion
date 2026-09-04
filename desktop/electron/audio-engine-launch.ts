import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

export const AUDIO_ENGINE_READY_LINE = 'ready'

const MACOS_SOCKET_PATH_MAX_BYTES = 103
const ENDPOINT_INSTANCE_TOKEN_LENGTH = 23

export type AudioEngineEndpointPair = {
  control: string
  audio: string
}

export type AudioEngineLaunchContract = {
  instanceId: string
  parentPid: number
  endpoints: AudioEngineEndpointPair
  args: readonly string[]
}

/**
 * Creates the one-use identity and endpoint metadata for a helper process.
 * A restart must call this again so stale endpoints are never reused.
 */
export function createAudioEngineLaunchContract(
  runtimeDirectory: string,
  platform: NodeJS.Platform = process.platform,
): AudioEngineLaunchContract {
  const instanceId = randomUUID()
  const parentPid = process.pid
  let endpoints: AudioEngineEndpointPair

  if (platform === 'win32') {
    const pipePrefix = `\\\\.\\pipe\\orion-audio-${instanceId}`
    endpoints = {
      control: `${pipePrefix}-control`,
      audio: `${pipePrefix}-audio`,
    }
  } else if (platform === 'darwin') {
    const instanceToken = instanceId.slice(0, ENDPOINT_INSTANCE_TOKEN_LENGTH)
    const instanceDirectoryName = `i-${instanceToken}`
    const preferredRoot = path.join(runtimeDirectory, 'oa')
    let instanceDirectory = path.join(preferredRoot, instanceDirectoryName)
    endpoints = macOsEndpoints(instanceDirectory)
    if (macOsEndpointBytes(endpoints) > MACOS_SOCKET_PATH_MAX_BYTES) {
      const runtimeKey = createHash('sha256')
        .update(path.resolve(runtimeDirectory))
        .digest('hex')
        .slice(0, 16)
      instanceDirectory = path.join('/tmp', `oa-${runtimeKey}`, instanceDirectoryName)
      endpoints = macOsEndpoints(instanceDirectory)
    }
    if (macOsEndpointBytes(endpoints) > MACOS_SOCKET_PATH_MAX_BYTES) {
      throw new Error('The macOS audio engine socket path exceeds the platform limit')
    }
  } else {
    throw new Error(`The audio engine does not support ${platform}`)
  }

  return {
    instanceId,
    parentPid,
    endpoints,
    args: [
      '--instance-id',
      instanceId,
      '--parent-pid',
      String(parentPid),
      '--control-endpoint',
      endpoints.control,
      '--audio-endpoint',
      endpoints.audio,
    ],
  }
}

function macOsEndpoints(instanceDirectory: string): AudioEngineEndpointPair {
  return {
    control: path.join(instanceDirectory, 'c.sock'),
    audio: path.join(instanceDirectory, 'a.sock'),
  }
}

function macOsEndpointBytes(endpoints: AudioEngineEndpointPair): number {
  return Math.max(
    Buffer.byteLength(endpoints.control),
    Buffer.byteLength(endpoints.audio),
  )
}
