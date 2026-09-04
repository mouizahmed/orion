import {
  createStartingRecording,
  recordingSessionReducer,
  type RecordingSessionAction,
  type StartRecordingInput,
} from '../src/features/recording/recording-state'
import type {
  RecordingAudioLevels,
  RecordingSessionSnapshot,
  RecordingTranscriptSegment,
} from '../src/features/recording/recording-types'
import {
  DEFAULT_RECORDING_DSP_CONFIGURATION,
  type RecordingDspConfiguration,
  type RecordingDspState,
} from '../src/features/recording/recording-diagnostics-types'
import type { AudioEngineAudioFrame } from './audio-engine-audio'
import { canApplyRecordingUiSnapshot } from '../src/features/recording/recording-snapshot'
import {
  createAudioEngineSupervisor,
  type AudioEngineConnection,
  type AudioEngineSupervisor,
} from './audio-engine-supervisor'
import type { AudioEngineProtocolError } from './audio-engine-client'
import {
  createAudioEngineRecordingSessionClient,
  type BackendRecordingAudioStored,
  type BackendRecordingSession,
} from './audio-engine-recording-session'
import {
  LocalAudioRecordingOutput,
  type AudioRecordingOutput,
} from './audio-engine-recording-output'
import {
  connectAudioEngineTranscriptionClient,
  type AudioEngineTranscriptionClient,
} from './audio-engine-transcription'
import { getRecordingSettings, type RecordingSettings } from './recording-settings-ipc'

type AudioEngineTimer = ReturnType<typeof setTimeout>

export type AudioEngineManagerOptions = {
  onSessionChanged: (session: RecordingSessionSnapshot) => void
  onTranscriptUpdate: (segment: RecordingTranscriptSegment) => void
  onAudioLevels: (levels: RecordingAudioLevels) => void
  finalizationDelayMs?: number
}

export type AudioEngineManager = {
  getSession(): RecordingSessionSnapshot | null
  start(input: StartRecordingInput): Promise<void>
  stop(stoppedAt: number): Promise<void>
  getDspState(): Promise<RecordingDspState>
  setDspConfiguration(configuration: RecordingDspConfiguration): Promise<RecordingDspState>
  setMicrophoneMuted(muted: boolean): Promise<void>
  setSystemAudioMuted(muted: boolean): Promise<void>
  dispose(): void
}

const EMPTY_TRANSCRIPT = [] as const
const AUDIO_LEVEL_INTERVAL_MS = 50

/**
 * Main-owned session driver. The Rust helper now gates entry into `recording`
 * and is supervised independently of renderer lifetime. Backend recording
 * identity and transcription transport are also owned here.
 */
export function createAudioEngineManager({
  onSessionChanged,
  onTranscriptUpdate,
  onAudioLevels,
  finalizationDelayMs = 600,
}: AudioEngineManagerOptions): AudioEngineManager {
  const timers = new Set<AudioEngineTimer>()
  const recordingSessionClient = createAudioEngineRecordingSessionClient()
  let session: RecordingSessionSnapshot | null = null
  let backendSession: BackendRecordingSession | null = null
  let transcriptionClient: AudioEngineTranscriptionClient | null = null
  let recordingOutput: AudioRecordingOutput | null = null
  let recordingOutputWarning: string | null = null
  let recordingStorageLocation: RecordingSettings['storageLocation'] = 'server'
  let transcriptionAvailable = false
  let startOperation: Promise<void> | null = null
  let stopOperation: Promise<void> | null = null
  let audioDrainOperation: Promise<void> | null = null
  let operationGeneration = 0
  let helperRecoveryPending = false
  let helperStopExpected = false
  let systemAudioWarning: string | null = null
  let disposed = false
  let audioLevelTimer: AudioEngineTimer | null = null
  let microphoneRms = 0
  let systemRms = 0
  let dspConfiguration: RecordingDspConfiguration = {
    ...DEFAULT_RECORDING_DSP_CONFIGURATION,
  }
  const readSession = (): RecordingSessionSnapshot | null => session

  const schedule = (callback: () => void, delayMs: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      callback()
    }, delayMs)
    timers.add(timer)
  }

  const clearTimers = () => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    audioLevelTimer = null
  }

  const publish = (next: RecordingSessionSnapshot) => {
    const current = session
    if (current && !canApplyRecordingUiSnapshot(
      { session: current, transcript: EMPTY_TRANSCRIPT },
      { session: next, transcript: EMPTY_TRANSCRIPT },
    )) {
      throw new Error(`Illegal recording phase transition: ${current.phase} -> ${next.phase}`)
    }
    session = next
    onSessionChanged(next)
  }

  const transition = (action: RecordingSessionAction) => {
    if (!session) return false
    const next = recordingSessionReducer(session, action)
    if (next === session) return false
    publish(next)
    return true
  }

  const appliesToActiveSession = () => Boolean(
    session
    && (session.phase === 'starting' || session.phase === 'recording' || session.phase === 'error'),
  )

  const hasLiveTranscript = () => Boolean(
    transcriptionAvailable && transcriptionClient?.isTranscriptAvailable(),
  )

  const publishAudioLevels = () => {
    if (!session || !appliesToActiveSession()) return
    onAudioLevels({ sessionId: session.sessionId, microphoneRms, systemRms })
  }

  const queueAudioLevels = (frame: AudioEngineAudioFrame) => {
    if (!session || !appliesToActiveSession()) return
    if (frame.source === 'mic') microphoneRms = frame.rms
    else systemRms = frame.rms
    if (audioLevelTimer) return
    audioLevelTimer = setTimeout(() => {
      const timer = audioLevelTimer
      audioLevelTimer = null
      if (timer) timers.delete(timer)
      publishAudioLevels()
    }, AUDIO_LEVEL_INTERVAL_MS)
    timers.add(audioLevelTimer)
  }

  const resetAudioLevels = () => {
    microphoneRms = 0
    systemRms = 0
    if (audioLevelTimer) {
      clearTimeout(audioLevelTimer)
      timers.delete(audioLevelTimer)
      audioLevelTimer = null
    }
    publishAudioLevels()
  }

  const setHelperFailure = (message: string, transcriptUnavailable: boolean) => {
    if (!appliesToActiveSession()) return
    transition({ type: 'fail', message })
    transition({
      type: 'set-transcript-phase',
      phase: transcriptUnavailable ? 'unavailable' : 'reconnecting',
    })
  }

  const handleHelperConnectionChanged = (connection: AudioEngineConnection | null) => {
    if (connection) {
      console.info(
        `Audio engine helper ready (pid ${connection.pid}, instance ${connection.instanceId})`,
      )
      if (helperRecoveryPending) void restoreSourceMutesAndRecover(connection)
      else beginAudioDrain(connection)
      return
    }

    if (helperStopExpected || !appliesToActiveSession()) return
    resetAudioLevels()
    systemAudioWarning = null
    helperRecoveryPending = true
    setHelperFailure('Audio capture was interrupted. Reconnecting...', false)
  }

  const handleHelperError = (error: AudioEngineProtocolError) => {
    if (!appliesToActiveSession()) return
    if (error.source === 'system') {
      systemAudioWarning = error.message
      // A secondary-source warning must not hide a fatal microphone failure.
      // Keep the session's existing error state/message so the user sees why
      // no microphone frames are reaching the recording.
      if (session?.phase === 'error') return
      transition({ type: 'warn', message: error.message })
      transition({ type: 'set-transcript-phase', phase: 'unavailable' })
      return
    }
    setHelperFailure(error.message, true)
  }

  const handleHelperUnavailable = (error: Error) => {
    if (helperStopExpected || !appliesToActiveSession()) return
    console.error('Audio engine helper is unavailable:', error)
    helperRecoveryPending = false
    setHelperFailure(
      'Audio capture is unavailable. Stop to keep the partial transcript.',
      true,
    )
  }

  const supervisor: AudioEngineSupervisor = createAudioEngineSupervisor({
    onConnectionChanged: handleHelperConnectionChanged,
    onHelperError: handleHelperError,
    onUnavailable: handleHelperUnavailable,
  })

  const drainAudioFrames = async (connection: AudioEngineConnection): Promise<void> => {
    try {
      while (supervisor.getConnection() === connection) {
        const frame = await connection.client.readAudioFrame()
        if (supervisor.getConnection() !== connection) continue
        queueAudioLevels(frame)
        const output = recordingOutput
        if (output) {
          try {
            await output.write(frame)
          } catch (error) {
            if (recordingOutput === output) recordingOutput = null
            recordingOutputWarning = 'Audio storage stopped because the recording could not be written.'
            console.error('Recording audio storage is unavailable:', error)
            await output.abort().catch((abortError) => {
              console.error('Could not close the incomplete audio recording:', abortError)
            })
            if (appliesToActiveSession() && session?.phase !== 'error' && !systemAudioWarning) {
              transition({ type: 'warn', message: recordingOutputWarning })
            }
          }
        }
        const transport = transcriptionClient
        if (!transport || !transcriptionAvailable) continue
        try {
          await transport.sendAudioFrame(frame)
        } catch (error) {
          handleTranscriptionUnavailable(asError(error, 'Could not stream audio for transcription'))
        }
      }
    } catch {
      // The framed audio channel reports terminal failures through the supervisor.
    }
  }

  const beginAudioDrain = (connection: AudioEngineConnection) => {
    const drain = drainAudioFrames(connection).finally(() => {
      if (audioDrainOperation === drain) audioDrainOperation = null
    })
    audioDrainOperation = drain
  }

  const handleTranscriptionUnavailable = (error: Error) => {
    if (!transcriptionAvailable) return
    transcriptionAvailable = false
    transcriptionClient?.dispose()
    if (!appliesToActiveSession()) return
    console.error('Live transcription is unavailable:', error)
    if (session?.phase !== 'error') {
      transition({
        type: 'warn',
        message: 'Live transcription is unavailable. Audio capture will continue.',
      })
    }
    transition({ type: 'set-transcript-phase', phase: 'unavailable' })
  }

  const handleTranscriptUnavailable = (error: Error) => {
    if (!transcriptionAvailable || !appliesToActiveSession()) return
    console.error('Live transcription degraded:', error)
    if (session?.phase !== 'error') {
      transition({
        type: 'warn',
        message: 'Live transcription is unavailable. Audio capture and storage will continue.',
      })
    }
    transition({ type: 'set-transcript-phase', phase: 'unavailable' })
  }

  const handleTranscriptionReconnecting = () => {
    if (!appliesToActiveSession()) return
    transition({ type: 'set-transcript-phase', phase: 'reconnecting' })
  }

  const handleTranscriptionReconnected = () => {
    if (session?.phase !== 'recording') return
    transition({
      type: 'set-transcript-phase',
      phase: systemAudioWarning || !hasLiveTranscript() ? 'unavailable' : 'live',
    })
  }

  const disposeTranscription = () => {
    transcriptionAvailable = false
    transcriptionClient?.dispose()
    transcriptionClient = null
  }

  const markBackendFailed = async (candidate: BackendRecordingSession | null): Promise<void> => {
    if (!candidate || !['starting', 'recording', 'finalizing'].includes(candidate.status)) return
    try {
      const failed = await recordingSessionClient.transition(candidate, { status: 'failed' })
      if (backendSession?.id === failed.id) backendSession = failed
    } catch (error) {
      console.error('Could not mark the backend recording session as failed:', error)
    }
  }

  const restoreSourceMutesAndRecover = async (
    connection: AudioEngineConnection,
  ): Promise<void> => {
    if (!helperRecoveryPending || session?.phase !== 'error') return
    try {
      const dspState = await connection.client.setDspConfiguration(dspConfiguration)
      if (!sameDspConfiguration(dspState.configuration, dspConfiguration)) {
        throw new Error('Audio engine did not restore DSP configuration')
      }
      if (session.micMuted) {
        const applied = await connection.client.setMicrophoneMuted(true)
        if (!applied) throw new Error('Audio engine did not restore microphone mute')
      }
      if (session.systemAudioMuted) {
        const applied = await connection.client.setSystemAudioMuted(true)
        if (!applied) throw new Error('Audio engine did not restore system-audio mute')
      }
      if (supervisor.getConnection() !== connection || session?.phase !== 'error') return
      helperRecoveryPending = false
      beginAudioDrain(connection)
      if (!transition({ type: 'recover' })) return
      if (systemAudioWarning) {
        transition({ type: 'warn', message: systemAudioWarning })
        transition({ type: 'set-transcript-phase', phase: 'unavailable' })
      } else if (recordingOutputWarning) {
        transition({ type: 'warn', message: recordingOutputWarning })
        transition({ type: 'set-transcript-phase', phase: hasLiveTranscript() ? 'live' : 'unavailable' })
      } else if (hasLiveTranscript()) {
        transition({ type: 'set-transcript-phase', phase: 'live' })
      } else {
        transition({ type: 'set-transcript-phase', phase: 'unavailable' })
      }
    } catch (error) {
      if (supervisor.getConnection() !== connection || session?.phase !== 'error') return
      console.error('Could not restore source mute after audio engine recovery:', error)
      helperRecoveryPending = false
      setHelperFailure('Audio capture recovered, but source mute could not be restored.', true)
    }
  }

  const startSession = async (
    input: StartRecordingInput,
    generation: number,
    recordingSettings: RecordingSettings,
  ): Promise<void> => {
    try {
      const created = await recordingSessionClient.create(input.noteId, input.sessionId)
      backendSession = created
      if (recordingSettings.storageLocation === 'local') {
        const output = await LocalAudioRecordingOutput.create({
          directory: recordingSettings.localRecordingsPath,
          noteId: input.noteId,
          sessionId: input.sessionId,
          startedAt: input.startedAt,
        })
        if (session?.sessionId === input.sessionId) recordingOutput = output
        else await output.abort()
      }
      if (generation !== operationGeneration) {
        if (session?.sessionId !== input.sessionId || session.phase !== 'stopping') {
          await markBackendFailed(created)
          backendSession = null
        }
        return
      }

      const connected = await connectAudioEngineTranscriptionClient({
        recordingSessionId: created.id,
        clientSessionId: input.sessionId,
        noteId: input.noteId,
        audioStorage: recordingSettings.storageLocation,
        onTranscript: (segment) => {
          if (
            generation === operationGeneration
            && session?.sessionId === input.sessionId
            && (session.phase === 'starting' || session.phase === 'recording')
          ) onTranscriptUpdate(segment)
        },
        onTranscriptUnavailable: (error) => {
          if (
            generation === operationGeneration
            && session?.sessionId === input.sessionId
          ) handleTranscriptUnavailable(error)
        },
        onReconnecting: () => {
          if (
            generation === operationGeneration
            && session?.sessionId === input.sessionId
          ) handleTranscriptionReconnecting()
        },
        onReconnected: () => {
          if (
            generation === operationGeneration
            && session?.sessionId === input.sessionId
          ) handleTranscriptionReconnected()
        },
        onUnavailable: (error) => {
          if (
            generation === operationGeneration
            && session?.sessionId === input.sessionId
          ) handleTranscriptionUnavailable(error)
        },
      })
      transcriptionClient = connected
      transcriptionAvailable = true
      if (generation !== operationGeneration) {
        if (session?.sessionId !== input.sessionId || session.phase !== 'stopping') {
          disposeTranscription()
          await markBackendFailed(created)
          backendSession = null
        }
        return
      }

      await supervisor.start()
      if (generation !== operationGeneration) return

      const recording = await recordingSessionClient.transition(created, { status: 'recording' })
      backendSession = recording
      if (generation !== operationGeneration) return

      const startedSession = readSession()
      if (startedSession?.sessionId !== input.sessionId || startedSession.phase !== 'starting') return
      transition({ type: 'started' })
      if (systemAudioWarning) {
        transition({ type: 'warn', message: systemAudioWarning })
        transition({ type: 'set-transcript-phase', phase: 'unavailable' })
      } else if (recordingOutputWarning) {
        transition({ type: 'warn', message: recordingOutputWarning })
        transition({ type: 'set-transcript-phase', phase: hasLiveTranscript() ? 'live' : 'unavailable' })
      } else if (hasLiveTranscript()) {
        transition({ type: 'set-transcript-phase', phase: 'live' })
      } else {
        transition({ type: 'set-transcript-phase', phase: 'unavailable' })
      }
    } catch (error) {
      if (generation !== operationGeneration) return
      helperStopExpected = true
      disposeTranscription()
      await supervisor.stop()
      const output = recordingOutput
      recordingOutput = null
      await output?.abort().catch((abortError) => {
        console.error('Could not close the incomplete audio recording:', abortError)
      })
      await markBackendFailed(backendSession)
      setHelperFailure('Could not start recording.', true)
      throw error
    }
  }

  return {
    getSession: () => session,
    start(input) {
      if (disposed) return Promise.reject(new Error('Audio engine manager is disposed'))
      if (session && session.phase !== 'complete') {
        return Promise.reject(new Error('Another recording is already active'))
      }
      const generation = ++operationGeneration
      clearTimers()
      backendSession = null
      disposeTranscription()
      helperRecoveryPending = false
      helperStopExpected = false
      systemAudioWarning = null
      recordingOutputWarning = null
      dspConfiguration = { ...DEFAULT_RECORDING_DSP_CONFIGURATION }
      // A completed session is a terminal snapshot. Starting again creates a
      // fresh identity rather than pretending this is a phase transition.
      session = null
      publish(createStartingRecording(input))
      resetAudioLevels()
      const recordingSettings = getRecordingSettings()
      recordingStorageLocation = recordingSettings.storageLocation
      const operation = startSession(input, generation, recordingSettings).finally(() => {
        if (startOperation === operation) startOperation = null
      })
      startOperation = operation
      return operation
    },
    stop(stoppedAt) {
      if (stopOperation) return stopOperation
      const operation = (async () => {
        if (!transition({ type: 'stop', now: stoppedAt })) return
        const generation = ++operationGeneration
        const stoppedSessionId = session?.sessionId
        const pendingStart = startOperation
        helperStopExpected = true
        helperRecoveryPending = false
        systemAudioWarning = null
        resetAudioLevels()
        clearTimers()
        const helperStop = supervisor.stop()
        if (pendingStart) await pendingStart.catch(() => undefined)
        try {
          await helperStop
          await audioDrainOperation?.catch(() => undefined)
          if (generation !== operationGeneration || session?.sessionId !== stoppedSessionId) return
          if (!transition({ type: 'finalize' })) return
          let audioStored: BackendRecordingAudioStored = recordingStorageLocation === 'server'
            ? 'cloud'
            : 'none'
          const output = recordingOutput
          recordingOutput = null
          if (output) {
            try {
              const result = await output.finish(stoppedAt)
              audioStored = result.kind
            } catch (error) {
              recordingOutputWarning = 'Recording audio could not be stored.'
              console.error('Could not finalize recording audio storage:', error)
            }
          }
          let transcriptionFinalizeError: unknown = null
          if (transcriptionAvailable && transcriptionClient) {
            try {
              audioStored = await transcriptionClient.finish(audioStored)
            } catch (error) {
              transcriptionFinalizeError = error
            }
          }
          disposeTranscription()
          if (generation !== operationGeneration || session?.sessionId !== stoppedSessionId) return

          if (!backendSession) {
            if (transcriptionFinalizeError instanceof Error) throw transcriptionFinalizeError
            throw new Error('Recording session is unavailable')
          }
          backendSession = await recordingSessionClient.finalize(backendSession, audioStored)
          schedule(() => {
            transition({ type: 'complete' })
          }, finalizationDelayMs)
        } catch (error) {
          disposeTranscription()
          const output = recordingOutput
          recordingOutput = null
          await output?.abort().catch((abortError) => {
            console.error('Could not close the incomplete audio recording:', abortError)
          })
          await markBackendFailed(backendSession)
          if (generation === operationGeneration && session?.sessionId === stoppedSessionId) {
            transition({ type: 'fail', message: 'Could not finalize the recording.' })
            transition({ type: 'set-transcript-phase', phase: 'unavailable' })
          }
          throw error
        }
      })()
      const trackedOperation = operation.finally(() => {
        if (stopOperation === trackedOperation) stopOperation = null
      })
      stopOperation = trackedOperation
      return trackedOperation
    },
    async getDspState() {
      const currentSession = session
      if (!currentSession || !['starting', 'recording', 'error'].includes(currentSession.phase)) {
        throw new Error('There is no active recording')
      }
      const connection = supervisor.getConnection()
      if (!connection) throw new Error('Audio capture is unavailable')
      const state = await connection.client.dspState()
      if (
        supervisor.getConnection() !== connection
        || session?.sessionId !== currentSession.sessionId
      ) {
        throw new Error('DSP diagnostics were superseded by an audio engine change')
      }
      return state
    },
    async setDspConfiguration(configuration) {
      const currentSession = session
      if (!currentSession || !['starting', 'recording', 'error'].includes(currentSession.phase)) {
        throw new Error('There is no active recording')
      }
      const connection = supervisor.getConnection()
      if (!connection) throw new Error('Audio capture is unavailable')
      const state = await connection.client.setDspConfiguration(configuration)
      if (
        supervisor.getConnection() !== connection
        || session?.sessionId !== currentSession.sessionId
      ) {
        throw new Error('DSP configuration was superseded by an audio engine change')
      }
      if (!sameDspConfiguration(state.configuration, configuration)) {
        throw new Error('Audio engine returned an unexpected DSP configuration')
      }
      dspConfiguration = { ...configuration }
      return state
    },
    async setMicrophoneMuted(muted) {
      const currentSession = session
      if (!currentSession || !['starting', 'recording', 'error'].includes(currentSession.phase)) {
        throw new Error('There is no active recording')
      }
      const connection = supervisor.getConnection()
      if (!connection) throw new Error('Audio capture is unavailable')
      const applied = await connection.client.setMicrophoneMuted(muted)
      if (
        supervisor.getConnection() !== connection
        || session?.sessionId !== currentSession.sessionId
      ) {
        throw new Error('Microphone mute was superseded by an audio engine change')
      }
      if (applied !== muted) throw new Error('Audio engine returned an unexpected mute state')
      transition({ type: 'set-microphone-muted', muted })
    },
    async setSystemAudioMuted(muted) {
      const currentSession = session
      if (!currentSession || !['starting', 'recording', 'error'].includes(currentSession.phase)) {
        throw new Error('There is no active recording')
      }
      const connection = supervisor.getConnection()
      if (!connection) throw new Error('Audio capture is unavailable')
      const applied = await connection.client.setSystemAudioMuted(muted)
      if (
        supervisor.getConnection() !== connection
        || session?.sessionId !== currentSession.sessionId
      ) {
        throw new Error('System-audio mute was superseded by an audio engine change')
      }
      if (applied !== muted) throw new Error('Audio engine returned an unexpected mute state')
      transition({ type: 'set-system-audio-muted', muted })
    },
    dispose() {
      if (disposed) return
      disposed = true
      operationGeneration += 1
      clearTimers()
      helperStopExpected = true
      helperRecoveryPending = false
      systemAudioWarning = null
      recordingOutputWarning = null
      resetAudioLevels()
      disposeTranscription()
      supervisor.dispose()
      const output = recordingOutput
      recordingOutput = null
      void output?.abort().catch((error) => {
        console.error('Could not close the incomplete audio recording:', error)
      })
      const abandoned = backendSession
      backendSession = null
      void markBackendFailed(abandoned)
      session = null
    },
  }
}

function asError(error: unknown, context: string): Error {
  if (error instanceof Error) return error
  return new Error(`${context}: ${String(error)}`)
}

function sameDspConfiguration(
  left: RecordingDspConfiguration,
  right: RecordingDspConfiguration,
) {
  return left.voiceActivityDetection === right.voiceActivityDetection
    && left.automaticGainControl === right.automaticGainControl
    && left.noiseSuppression === right.noiseSuppression
    && left.echoCancellation === right.echoCancellation
}
