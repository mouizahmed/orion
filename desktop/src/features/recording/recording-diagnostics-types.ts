export type RecordingDspConfiguration = {
  voiceActivityDetection: boolean
  automaticGainControl: boolean
  noiseSuppression: boolean
  echoCancellation: boolean
}

export type RecordingDspSourceTelemetry = {
  hasProcessedAudio: boolean
  voiceActivityDetectionActive: boolean
  automaticGainControlActive: boolean
  noiseSuppressionActive: boolean
  echoCancellationActive: boolean
  effectiveGainDb: number | null
  echoReturnLossDb: number | null
  echoReturnLossEnhancementDb: number | null
  divergentFilterFraction: number | null
  residualEchoLikelihood: number | null
  delayMs: number | null
}

export type RecordingDspState = {
  configuration: RecordingDspConfiguration
  microphone: RecordingDspSourceTelemetry
  system: RecordingDspSourceTelemetry
}

export const DEFAULT_RECORDING_DSP_CONFIGURATION: Readonly<RecordingDspConfiguration> = {
  voiceActivityDetection: true,
  automaticGainControl: true,
  noiseSuppression: true,
  echoCancellation: true,
}
