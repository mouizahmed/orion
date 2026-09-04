import { ArrowLeft, Search, Settings2, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { InfoBanner } from '@/components/ui/info-banner'
import type { TranscriptSegment } from '@/features/notes/api/transcript-client'
import {
  generateMeetingArtifacts,
  type MeetingArtifactsResult,
} from '@/features/notes/api/meeting-artifacts-client'
import NoteMeetingArtifactsReview, {
  type MeetingArtifactGenerationState,
} from '@/features/notes/NoteMeetingArtifactsReview'
import NoteAssistantSurface, {
  TRANSCRIPT_FOOTER_HEIGHT,
} from '@/features/notes/NoteAssistantSurface'
import SavedTranscriptView from '@/features/notes/SavedTranscriptView'
import LiveTranscriptViewport from '@/features/recording/components/LiveTranscriptViewport'
import type { RecordingTranscriptSegment, TranscriptPhase } from '@/features/recording/recording-types'

type NoteTranscriptPanelProps = {
  expanded: boolean
  expandedHeight: number
  noteId: string
  isRecording: boolean
  canResumeRecording: boolean
  loading: boolean
  segments: TranscriptSegment[]
  liveSegments?: readonly RecordingTranscriptSegment[]
  transcriptPhase?: TranscriptPhase
  onAnimationComplete: () => void
  onClose: () => void
  onMeetingArtifactsGenerated: (result: MeetingArtifactsResult) => void
  onInsertMeetingArtifacts: (result: MeetingArtifactsResult) => void
  onResumeRecording?: () => void
}

export default function NoteTranscriptPanel({
  expanded,
  expandedHeight,
  noteId,
  isRecording,
  canResumeRecording,
  loading,
  segments,
  liveSegments,
  transcriptPhase,
  onAnimationComplete,
  onClose,
  onMeetingArtifactsGenerated,
  onInsertMeetingArtifacts,
  onResumeRecording,
}: NoteTranscriptPanelProps) {
  const [reviewingArtifacts, setReviewingArtifacts] = useState(false)
  const [artifactState, setArtifactState] = useState<MeetingArtifactGenerationState>({ status: 'loading' })
  const artifactRequestRef = useRef<AbortController | null>(null)
  const artifactRequestVersionRef = useRef(0)
  const showingLiveTranscript = liveSegments !== undefined && transcriptPhase !== undefined
  const canGenerateArtifacts = !isRecording && !showingLiveTranscript && !loading && segments.length > 0

  const generateArtifacts = useCallback(async () => {
    artifactRequestRef.current?.abort()
    const request = new AbortController()
    const version = ++artifactRequestVersionRef.current
    artifactRequestRef.current = request
    setArtifactState({ status: 'loading' })
    try {
      const result = await generateMeetingArtifacts(noteId, request.signal)
      if (!request.signal.aborted && version === artifactRequestVersionRef.current) {
        setArtifactState({ status: 'ready', result })
        onMeetingArtifactsGenerated(result)
      }
    } catch (error) {
      if (!request.signal.aborted && version === artifactRequestVersionRef.current) {
        const message = error instanceof Error && error.message.trim()
          ? error.message
          : 'Failed to generate meeting notes.'
        setArtifactState({ status: 'error', message })
      }
    }
  }, [noteId, onMeetingArtifactsGenerated])

  useEffect(() => () => {
    artifactRequestVersionRef.current += 1
    artifactRequestRef.current?.abort()
  }, [])

  useEffect(() => {
    artifactRequestRef.current?.abort()
    artifactRequestVersionRef.current += 1
    setReviewingArtifacts(false)
    setArtifactState({ status: 'loading' })
  }, [noteId])

  const openArtifactReview = () => {
    if (!canGenerateArtifacts) return
    setReviewingArtifacts(true)
    void generateArtifacts()
  }

  const insertArtifacts = (result: MeetingArtifactsResult) => {
    onInsertMeetingArtifacts(result)
    setReviewingArtifacts(false)
  }

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
        {reviewingArtifacts ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setReviewingArtifacts(false)}
            aria-label="Back to transcript"
            title="Back to transcript"
            className="h-7 w-7"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
        ) : (
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
        )}
        <div className="flex items-center gap-1">
          {!reviewingArtifacts && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={!canGenerateArtifacts}
              onClick={openArtifactReview}
              aria-label="Generate meeting notes"
              title={canGenerateArtifacts ? 'Generate meeting notes' : 'A saved transcript is required'}
              className="h-7 w-7"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </Button>
          )}
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
        {reviewingArtifacts ? (
          <NoteMeetingArtifactsReview
            state={artifactState}
            onGenerate={() => void generateArtifacts()}
            onInsert={insertArtifacts}
          />
        ) : showingLiveTranscript ? (
          <div className="-mx-3 min-h-0 flex-1">
            <InfoBanner className="mx-3 mb-3">
              System audio may be repeated if it also reaches your microphone. Use headphones for the cleanest transcript.
            </InfoBanner>
            <LiveTranscriptViewport segments={liveSegments} transcriptPhase={transcriptPhase} />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto sidebar-scrollbar">
            <InfoBanner className="mb-3">
              System audio may be repeated if it also reaches your microphone. Use headphones for the cleanest transcript.
            </InfoBanner>
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
