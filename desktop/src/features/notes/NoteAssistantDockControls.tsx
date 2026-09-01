import { ChevronDown } from 'lucide-react'
import { motion } from 'motion/react'

import { RecordingBars } from '@/components/ui/recording-bars'
import { ASSISTANT_DOCK_FADE_TRANSITION } from '@/features/notes/NoteAssistantSurface'
import { cn } from '@/lib/utils'

type NoteAssistantDockControlsProps = {
  assistantActive: boolean
  chatActive: boolean
  chatLabel: string
  isRecording: boolean
  panelVisible: boolean
  transcriptActive: boolean
  onToggleChat: () => void
  onToggleTranscript: () => void
}

export default function NoteAssistantDockControls({
  assistantActive,
  chatActive,
  chatLabel,
  isRecording,
  panelVisible,
  transcriptActive,
  onToggleChat,
  onToggleTranscript,
}: NoteAssistantDockControlsProps) {
  const transcriptOpen = transcriptActive && panelVisible
  const transcriptHidden = chatActive && panelVisible

  return (
    <>
      <motion.button
        type="button"
        onClick={onToggleTranscript}
        aria-label={transcriptOpen ? 'Close transcript' : 'Open transcript'}
        title={transcriptOpen ? 'Close transcript' : 'Transcript'}
        initial={false}
        animate={{ opacity: transcriptHidden ? 0 : 1 }}
        transition={ASSISTANT_DOCK_FADE_TRANSITION}
        className={cn(
          'absolute bottom-0 left-0 z-30 flex h-14 w-14 items-center justify-center gap-1 rounded-full border bg-white text-neutral-600 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-900/15 dark:bg-[#272427] dark:text-neutral-300 dark:hover:bg-[#343034] dark:hover:text-white dark:focus-visible:ring-white/20',
          transcriptActive
            ? 'border-transparent shadow-none'
            : 'border-neutral-300/80 shadow-lg dark:border-white/12',
          transcriptHidden ? 'pointer-events-none' : 'pointer-events-auto',
        )}
      >
        <RecordingBars isRecording={isRecording} />
        <motion.span
          initial={false}
          animate={{ rotate: transcriptOpen ? 0 : 180 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          className="flex shrink-0 items-center justify-center"
        >
          <ChevronDown className="h-3 w-3" />
        </motion.span>
      </motion.button>

      <motion.div
        initial={false}
        animate={{ opacity: panelVisible ? 0 : 1 }}
        transition={ASSISTANT_DOCK_FADE_TRANSITION}
        className={cn(
          'absolute inset-x-0 bottom-0 z-10 flex h-14 pl-16',
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
