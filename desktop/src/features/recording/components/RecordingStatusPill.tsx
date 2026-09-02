import type { CSSProperties } from 'react'
import { X } from 'lucide-react'

import { RecordingBars } from '@/components/ui/recording-bars'
import { Button } from '@/components/ui/button'
import { useRecordingElapsedTime } from '@/features/recording/components/useRecordingElapsedTime'
import { formatRecordingElapsedTime, getRecordingOverlayStatus } from '@/features/recording/recording-overlay-presenter'
import type { RecordingSessionSnapshot } from '@/features/recording/recording-types'

export default function RecordingStatusPill({
  session,
  onClick,
  onStop,
}: {
  session: RecordingSessionSnapshot
  onClick: () => void
  onStop: () => void
}) {
  const elapsedMs = useRecordingElapsedTime(session)
  const status = getRecordingOverlayStatus(session)
  const canStop = session.phase === 'starting' || session.phase === 'recording' || session.phase === 'error'

  return (
    <div
      className="flex h-8 max-w-[272px] overflow-hidden rounded-full border border-neutral-200 bg-white/70 text-neutral-700 dark:border-white/12 dark:bg-white/5 dark:text-neutral-200"
      style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClick}
        className="h-full min-w-0 flex-1 gap-2 rounded-none px-3 hover:bg-neutral-100 dark:hover:bg-white/10 sm:min-w-[156px]"
        aria-label={`Open recording note. ${status.label}`}
        title="Open recording note"
      >
        <RecordingBars
          isRecording={status.activityActive}
          className="shrink-0 text-[#7c3aed] dark:text-[#9f73f2]"
        />
        <span className="hidden min-w-0 flex-1 truncate text-left text-xs font-medium sm:inline">
          {session.noteTitle}
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-neutral-500 dark:text-neutral-400">
          {formatRecordingElapsedTime(elapsedMs)}
        </span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onStop}
        disabled={!canStop}
        className="h-full w-8 rounded-none border-l border-neutral-200/80 hover:bg-neutral-100 dark:border-white/10 dark:hover:bg-white/10"
        aria-label="Stop recording"
        title="Stop recording"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}
