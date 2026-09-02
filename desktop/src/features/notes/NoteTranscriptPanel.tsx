import { Search, Settings2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InfoBanner } from '@/components/ui/info-banner'
import type { TranscriptSegment } from '@/features/notes/api/transcript-client'
import NoteAssistantSurface, {
  TRANSCRIPT_FOOTER_HEIGHT,
} from '@/features/notes/NoteAssistantSurface'
import SavedTranscriptView from '@/features/notes/SavedTranscriptView'
import LiveTranscriptViewport from '@/features/recording/components/LiveTranscriptViewport'
import type { RecordingTranscriptSegment, TranscriptPhase } from '@/features/recording/recording-types'

type NoteTranscriptPanelProps = {
  expanded: boolean
  expandedHeight: number
  isRecording: boolean
  canResumeRecording: boolean
  loading: boolean
  segments: TranscriptSegment[]
  liveSegments?: readonly RecordingTranscriptSegment[]
  transcriptPhase?: TranscriptPhase
  onAnimationComplete: () => void
  onClose: () => void
  onResumeRecording?: () => void
}

export default function NoteTranscriptPanel({
  expanded,
  expandedHeight,
  isRecording,
  canResumeRecording,
  loading,
  segments,
  liveSegments,
  transcriptPhase,
  onAnimationComplete,
  onClose,
  onResumeRecording,
}: NoteTranscriptPanelProps) {
  return (
    <NoteAssistantSurface
      ariaLabel="Note transcript"
      collapsedHeight={TRANSCRIPT_FOOTER_HEIGHT}
      expandedHeight={expandedHeight}
      expanded={expanded}
      onAnimationComplete={onAnimationComplete}
      className="-bottom-1 -left-1 flex min-h-0 w-[calc(100%+0.5rem)] flex-col"
    >
      <header className="flex h-11 shrink-0 items-center justify-between px-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Search transcript"
          title="Search transcript"
          className="h-7 w-7"
        >
          <Search className="h-3.5 w-3.5" />
        </Button>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Transcript settings"
            title="Transcript settings"
            className="h-7 w-7"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close transcript"
            title="Close transcript"
            className="h-7 w-7"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col p-3">
        <InfoBanner className="mb-3">
          The transcript may show repeated sentences without headphones, but your final notes will be unaffected. For the best experience, use headphones.
        </InfoBanner>
        {liveSegments && transcriptPhase ? (
          <div className="-mx-3 min-h-0 flex-1">
            <LiveTranscriptViewport segments={liveSegments} transcriptPhase={transcriptPhase} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto sidebar-scrollbar">
            <SavedTranscriptView segments={segments} loading={loading} theme="light" />
          </div>
        )}
      </div>

      <div className="flex h-16 shrink-0 items-center pr-1">
        <span aria-hidden="true" className={isRecording ? 'h-14 w-[140px] shrink-0' : 'h-14 w-[60px] shrink-0'} />
        <div className="min-w-0 flex-1 px-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isRecording || !canResumeRecording || !onResumeRecording}
            onClick={onResumeRecording}
            title={!isRecording && !canResumeRecording ? 'Stop the current recording before resuming this note' : undefined}
            className="h-14 rounded-full px-3 text-sm font-medium text-neutral-700 dark:text-neutral-200"
          >
            {isRecording ? 'Recording' : 'Resume'}
          </Button>
        </div>
      </div>
    </NoteAssistantSurface>
  )
}
