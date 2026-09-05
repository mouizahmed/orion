import { ChevronDown, Square, SquareArrowOutUpRight } from 'lucide-react'
import { motion } from 'motion/react'

import { RecordingBars } from '@/components/ui/recording-bars'
import { ASSISTANT_DOCK_FADE_TRANSITION } from '@/features/notes/NoteAssistantSurface'
import { cn } from '@/lib/utils'
import { useRecordingAudioLevel } from '@/features/recording/use-recording-audio-level'

type NoteAssistantDockControlsProps = {
  assistantActive: boolean
  chatActive: boolean
  chatLabel: string
  isRecording: boolean
  recordingSessionId: string | null
  recordingSessionActive: boolean
  canStopRecording: boolean
  canShowRecordingOverlay: boolean
  panelVisible: boolean
  transcriptActive: boolean
  onToggleChat: () => void
  onToggleTranscript: () => void
  onShowOverlay: () => void
  onStopRecording: () => void
}

export default function NoteAssistantDockControls({
  assistantActive,
  chatActive,
  chatLabel,
  isRecording,
  recordingSessionId,
  recordingSessionActive,
  canStopRecording,
  canShowRecordingOverlay,
  panelVisible,
  transcriptActive,
  onToggleChat,
  onToggleTranscript,
  onShowOverlay,
  onStopRecording,
}: NoteAssistantDockControlsProps) {
  const audioLevel = useRecordingAudioLevel(recordingSessionId)
  const sessionControlsVisible = recordingSessionActive || canShowRecordingOverlay
  const transcriptOpen = transcriptActive && panelVisible
  const transcriptHidden = chatActive && panelVisible

  return (
    <>
      <motion.div
        initial={false}
        animate={{ opacity: transcriptHidden ? 0 : 1 }}
        transition={ASSISTANT_DOCK_FADE_TRANSITION}
        className={cn(
          'absolute bottom-0 left-0 z-30 flex h-14 items-stretch text-neutral-600 transition-[width] dark:text-neutral-300',
          sessionControlsVisible
            ? canShowRecordingOverlay ? 'w-[136px] gap-2' : 'w-24'
            : 'w-14',
          transcriptHidden ? 'pointer-events-none' : 'pointer-events-auto',
        )}
      >
        {sessionControlsVisible && canShowRecordingOverlay ? (
          <button
            type="button"
            onClick={onShowOverlay}
            aria-label="Return to recording overlay"
            title="Return to recording overlay"
            className="flex h-14 w-8 shrink-0 items-center justify-center rounded-full outline-none transition-colors hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-900/15 dark:hover:text-white dark:focus-visible:ring-white/20"
          >
            <SquareArrowOutUpRight className="h-4 w-4" />
          </button>
        ) : null}

        <div
          className={cn(
            'flex min-w-0 flex-1 items-stretch overflow-hidden rounded-full border bg-white dark:bg-[#272427]',
            transcriptActive
              ? 'border-transparent shadow-none'
              : 'border-neutral-300/80 shadow-lg dark:border-white/12',
          )}
        >
          <button
            type="button"
            onClick={onToggleTranscript}
            aria-label={transcriptOpen ? 'Close transcript' : 'Open transcript'}
            title={transcriptOpen ? 'Close transcript' : 'Transcript'}
            className="flex min-w-0 flex-1 items-center justify-center gap-1 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900/15 dark:hover:bg-[#343034] dark:hover:text-white dark:focus-visible:ring-white/20"
          >
            <RecordingBars
              isRecording={isRecording}
              level={audioLevel}
              className="h-6 w-6 overflow-visible text-[#7c3aed] dark:text-[#9f73f2]"
            />
            <motion.span
              initial={false}
              animate={{ rotate: transcriptOpen ? 0 : 180 }}
              transition={{ duration: 0.12, ease: 'easeOut' }}
              className="flex shrink-0 items-center justify-center"
            >
              <ChevronDown className="h-3 w-3" />
            </motion.span>
          </button>
          {sessionControlsVisible && canStopRecording ? (
            <button
              type="button"
              onClick={onStopRecording}
              disabled={!canStopRecording}
              aria-label="Stop recording"
              title="Stop recording"
              className="flex w-10 shrink-0 items-center justify-center outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900/15 disabled:cursor-default disabled:opacity-50 dark:hover:bg-[#343034] dark:hover:text-white dark:focus-visible:ring-white/20"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : null}
        </div>
      </motion.div>

      <motion.div
        initial={false}
        animate={{ opacity: panelVisible ? 0 : 1 }}
        transition={ASSISTANT_DOCK_FADE_TRANSITION}
        className={cn(
          'absolute inset-x-0 bottom-0 z-10 flex h-14',
          sessionControlsVisible
            ? canShowRecordingOverlay ? 'pl-36' : 'pl-24'
            : 'pl-16',
          assistantActive ? 'pointer-events-none' : 'pointer-events-auto',
        )}
      >
        <button
          type="button"
          onClick={onToggleChat}
          aria-label={`${chatLabel} about this note`}
          className="flex h-14 min-w-0 flex-1 items-center rounded-full border border-neutral-300/80 bg-white px-5 text-left text-sm text-neutral-500 shadow-lg outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-900/15 dark:border-white/12 dark:bg-[#272427] dark:text-neutral-400 dark:hover:bg-[#343034] dark:hover:text-neutral-100 dark:focus-visible:ring-white/20"
        >
          <span className="truncate">{chatLabel}</span>
        </button>
      </motion.div>
    </>
  )
}
