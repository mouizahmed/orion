import { Search, Settings2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InfoBanner } from '@/components/ui/info-banner'
import type { TranscriptSegment } from '@/features/notes/api/transcript-client'
import NoteAssistantSurface, {
  TRANSCRIPT_FOOTER_HEIGHT,
} from '@/features/notes/NoteAssistantSurface'
import SavedTranscriptView from '@/features/notes/SavedTranscriptView'

type NoteTranscriptPanelProps = {
  expanded: boolean
  expandedHeight: number
  isRecording: boolean
  loading: boolean
  segments: TranscriptSegment[]
  onAnimationComplete: () => void
  onClose: () => void
}

export default function NoteTranscriptPanel({
  expanded,
  expandedHeight,
  isRecording,
  loading,
  segments,
  onAnimationComplete,
  onClose,
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

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sidebar-scrollbar">
        <InfoBanner className="mb-3">
          The transcript may show repeated sentences without headphones, but your final notes will be unaffected. For the best experience, use headphones.
        </InfoBanner>
        <SavedTranscriptView segments={segments} loading={loading} theme="light" />
      </div>

      <div className="flex h-16 shrink-0 items-center pr-1">
        <span aria-hidden="true" className="h-14 w-[60px] shrink-0" />
        <div className="min-w-0 flex-1 px-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-14 rounded-full px-3 text-sm font-medium text-neutral-700 dark:text-neutral-200"
          >
            {isRecording ? 'Pause' : 'Resume'}
          </Button>
        </div>
      </div>
    </NoteAssistantSurface>
  )
}
