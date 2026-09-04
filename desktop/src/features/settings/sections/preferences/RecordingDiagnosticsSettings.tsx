import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  RecordingDspConfiguration,
  RecordingDspSourceTelemetry,
  RecordingDspState,
} from '@/features/recording/recording-diagnostics-types'
import { SettingRow, ToggleSwitch } from '@/features/settings/components/SettingsPrimitives'
import { desktopApi } from '@/lib/desktop-api'

const DIAGNOSTICS_POLL_INTERVAL_MS = 1_000

type DspConfigurationKey = keyof RecordingDspConfiguration

const DSP_CONTROLS: ReadonlyArray<{
  key: DspConfigurationKey
  label: string
  description: string
}> = [
  {
    key: 'voiceActivityDetection',
    label: 'Voice activity detection',
    description: 'Label speech regions while keeping the continuous audio stream.',
  },
  {
    key: 'automaticGainControl',
    label: 'Automatic gain control',
    description: 'Keep microphone loudness within the engine target range.',
  },
  {
    key: 'noiseSuppression',
    label: 'Noise suppression',
    description: 'Reduce steady background noise on the microphone.',
  },
  {
    key: 'echoCancellation',
    label: 'Echo cancellation',
    description: 'Remove system playback from the microphone signal when a reference is available.',
  },
]

function formatDb(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} dB`
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

function formatDelay(value: number | null): string {
  return value === null ? '—' : `${value} ms`
}

function activityLabel(active: boolean): string {
  return active ? 'On' : 'Off'
}

function SourceTelemetry({
  label,
  telemetry,
}: {
  label: string
  telemetry: RecordingDspSourceTelemetry
}) {
  const metrics = [
    ['VAD', activityLabel(telemetry.voiceActivityDetectionActive)],
    ['AGC', activityLabel(telemetry.automaticGainControlActive)],
    ['Noise suppression', activityLabel(telemetry.noiseSuppressionActive)],
    ['Echo cancellation', activityLabel(telemetry.echoCancellationActive)],
    ['Effective gain', formatDb(telemetry.effectiveGainDb)],
  ] as const

  return (
    <div className="rounded-md border border-neutral-200 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.025]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{label}</div>
        <div className={telemetry.hasProcessedAudio
          ? 'text-xs font-medium text-emerald-600 dark:text-emerald-400'
          : 'text-xs font-medium text-neutral-500 dark:text-neutral-400'}
        >
          {telemetry.hasProcessedAudio ? 'Receiving audio' : 'Waiting for audio'}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {metrics.map(([name, value]) => (
          <div key={name} className="flex min-w-0 items-center justify-between gap-2 text-xs">
            <dt className="truncate text-neutral-500 dark:text-neutral-400">{name}</dt>
            <dd className="shrink-0 font-medium text-neutral-800 dark:text-neutral-200">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function EchoTelemetry({ telemetry }: { telemetry: RecordingDspSourceTelemetry }) {
  const metrics = [
    ['Return loss', formatDb(telemetry.echoReturnLossDb)],
    ['Enhancement', formatDb(telemetry.echoReturnLossEnhancementDb)],
    ['Residual echo', formatPercent(telemetry.residualEchoLikelihood)],
    ['Divergent filter', formatPercent(telemetry.divergentFilterFraction)],
    ['Estimated delay', formatDelay(telemetry.delayMs)],
  ] as const

  return (
    <div className="rounded-md border border-neutral-200 bg-white/70 p-3 dark:border-white/10 dark:bg-white/[0.025]">
      <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">Microphone echo metrics</div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {metrics.map(([name, value]) => (
          <div key={name} className="flex min-w-0 items-center justify-between gap-2 text-xs">
            <dt className="truncate text-neutral-500 dark:text-neutral-400">{name}</dt>
            <dd className="shrink-0 font-medium text-neutral-800 dark:text-neutral-200">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function RecordingDiagnosticsSettings() {
  const [state, setState] = useState<RecordingDspState | null>(null)
  const [updating, setUpdating] = useState<DspConfigurationKey | null>(null)
  const mountedRef = useRef(false)
  const mutationInFlightRef = useRef(false)
  const requestGenerationRef = useRef(0)
  const apiAvailable = desktopApi.recordingDiagnostics.isAvailable()

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!apiAvailable) return
    let disposed = false
    let timer: number | undefined

    const poll = async () => {
      if (!mutationInFlightRef.current) {
        const generation = requestGenerationRef.current
        try {
          const nextState = await desktopApi.recordingDiagnostics.getDspState()
          if (!disposed && generation === requestGenerationRef.current) setState(nextState)
        } catch {
          if (!disposed && generation === requestGenerationRef.current) setState(null)
        }
      }
      if (!disposed) timer = window.setTimeout(() => void poll(), DIAGNOSTICS_POLL_INTERVAL_MS)
    }

    void poll()
    return () => {
      disposed = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [apiAvailable])

  const setConfigurationValue = useCallback(async (
    key: DspConfigurationKey,
    enabled: boolean,
  ) => {
    if (!state || mutationInFlightRef.current) return
    mutationInFlightRef.current = true
    requestGenerationRef.current += 1
    setUpdating(key)
    try {
      const nextState = await desktopApi.recordingDiagnostics.setDspConfiguration({
        ...state.configuration,
        [key]: enabled,
      })
      if (mountedRef.current) setState(nextState)
    } catch {
      if (mountedRef.current) setState(null)
    } finally {
      mutationInFlightRef.current = false
      if (mountedRef.current) setUpdating(null)
    }
  }, [state])

  return (
    <div>
      <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">Audio diagnostics</div>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
        {DSP_CONTROLS.map((control) => (
          <SettingRow
            key={control.key}
            label={control.label}
            value={control.description}
            action={(
              <ToggleSwitch
                enabled={state?.configuration[control.key] ?? false}
                disabled={!state || updating !== null}
                ariaLabel={`${control.label}: ${state?.configuration[control.key] ? 'on' : 'off'}`}
                onClick={() => void setConfigurationValue(
                  control.key,
                  !(state?.configuration[control.key] ?? false),
                )}
              />
            )}
          />
        ))}
        <div className="space-y-2 px-3 py-3" aria-live="polite">
          {state ? (
            <>
              <div className="grid gap-2 xl:grid-cols-2">
                <SourceTelemetry label="Microphone" telemetry={state.microphone} />
                <SourceTelemetry label="System audio" telemetry={state.system} />
              </div>
              <EchoTelemetry telemetry={state.microphone} />
            </>
          ) : (
            <div className="text-xs text-neutral-500 dark:text-neutral-400">
              {apiAvailable
                ? 'Start a recording to view and adjust live DSP diagnostics.'
                : 'Live DSP diagnostics are available in the desktop app.'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
