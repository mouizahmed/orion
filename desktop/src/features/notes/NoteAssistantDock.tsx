import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { motion } from 'motion/react'

import { Button } from '@/components/ui/button'
import { InfoBanner } from '@/components/ui/info-banner'
import { RecordingBars } from '@/components/ui/recording-bars'
import NoteChatPanel from '@/features/chat/note/NoteChatPanel'
import SavedTranscriptView from '@/features/notes/SavedTranscriptView'
import {
  getNoteAssistantChatLabel,
  type NoteAssistantMode,
} from '@/features/notes/note-assistant-state'
import { useNoteTranscriptQuery } from '@/features/notes/queries/useNotesQueries'
import { cn } from '@/lib/utils'

type NoteAssistantDockProps = {
  accountId?: string
  noteId: string
  noteTitle: string
  isRecording?: boolean
}

type AssistantMode = Exclude<NoteAssistantMode, 'closed'>
type AssistantPhase = 'opening-footer' | 'opening-panel' | 'open' | 'closing-footer' | 'closing-source'

type SourceBox = {
  left: number
  width: number
}

type ActiveAssistant = {
  mode: AssistantMode
  phase: AssistantPhase
  sourceBox: SourceBox
}

const footerHeight = 56

const surfaceTransition = {
  type: 'tween' as const,
  duration: 0.12,
  ease: [0.22, 1, 0.36, 1] as const,
}

export default function NoteAssistantDock({
  accountId,
  noteId,
  noteTitle,
  isRecording = false,
}: NoteAssistantDockProps) {
  const [assistant, setAssistant] = useState<ActiveAssistant | null>(null)
  const [hasChatMessages, setHasChatMessages] = useState(false)
  const [chatDraft, setChatDraft] = useState('')
  const [trackSize, setTrackSize] = useState({ width: 0, height: 0 })
  const previousNoteIdRef = useRef(noteId)
  const trackRef = useRef<HTMLDivElement>(null)
  const transcriptButtonRef = useRef<HTMLButtonElement>(null)
  const chatButtonRef = useRef<HTMLButtonElement>(null)
  const mode = assistant?.mode ?? 'closed'
  const open = assistant?.phase === 'open'
  const transcriptQuery = useNoteTranscriptQuery(accountId, noteId, mode === 'transcript')

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return

    const updateTrackSize = () => {
      setTrackSize({ width: track.clientWidth, height: track.clientHeight })
    }

    updateTrackSize()
    const observer = new ResizeObserver(updateTrackSize)
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (previousNoteIdRef.current === noteId) return
    previousNoteIdRef.current = noteId
    setAssistant(null)
    setHasChatMessages(false)
    setChatDraft('')
  }, [noteId])

  useEffect(() => {
    if (!assistant) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAssistant()
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [assistant])

  const toggleMode = (requestedMode: AssistantMode) => {
    if (assistant) {
      closeAssistant()
      return
    }

    const track = trackRef.current
    const source = requestedMode === 'transcript'
      ? transcriptButtonRef.current
      : chatButtonRef.current
    const trackRect = track?.getBoundingClientRect()
    const sourceRect = source?.getBoundingClientRect()
    const sourceBox = trackRect && sourceRect
      ? { left: sourceRect.left - trackRect.left, width: sourceRect.width }
      : requestedMode === 'transcript'
        ? { left: 0, width: footerHeight }
        : { left: footerHeight + 8, width: Math.max(0, trackSize.width - footerHeight - 8) }

    source?.blur()
    setAssistant({
      mode: requestedMode,
      phase: requestedMode === 'transcript' ? 'opening-panel' : 'opening-footer',
      sourceBox,
    })
  }

  function closeAssistant() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setAssistant((current) => {
      if (!current || current.phase !== 'open') return current
      return {
        ...current,
        phase: current.mode === 'transcript' ? 'closing-source' : 'closing-footer',
      }
    })
  }

  const panelHeight = Math.max(
    footerHeight,
    Math.min(window.innerHeight * 0.68, 560, trackSize.height),
  )
  const chatDockLabel = chatDraft || getNoteAssistantChatLabel(hasChatMessages)
  const surfaceGeometry = assistant?.phase === 'closing-source'
    ? { left: assistant.sourceBox.left, width: assistant.sourceBox.width, height: footerHeight }
    : assistant?.phase === 'open' || assistant?.phase === 'opening-panel'
      ? { left: 0, width: trackSize.width, height: panelHeight }
      : { left: 0, width: trackSize.width, height: footerHeight }
  const dialogVisible = assistant?.phase === 'open' || assistant?.phase === 'closing-footer'

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {open && (
        <div
          aria-hidden="true"
          onPointerDown={closeAssistant}
          className="pointer-events-auto absolute inset-0 z-0"
        />
      )}
      <div
        ref={trackRef}
        className="absolute inset-x-0 bottom-7 top-0 mx-auto w-[calc(100%-1.5rem)] max-w-xl"
      >
        <div
          aria-hidden={Boolean(assistant)}
          className={cn(
            'absolute inset-x-0 bottom-0 mx-auto flex h-14 w-full max-w-xl items-stretch gap-2',
            assistant ? 'pointer-events-none' : 'pointer-events-auto',
          )}
        >
          <button
            ref={transcriptButtonRef}
            type="button"
            onClick={() => toggleMode('transcript')}
            aria-label="Open transcript"
            title="Transcript"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-neutral-300/80 bg-white text-neutral-600 shadow-lg outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-900/15 dark:border-white/12 dark:bg-[#272427] dark:text-neutral-300 dark:hover:bg-[#343034] dark:hover:text-white dark:focus-visible:ring-white/20"
          >
            <RecordingBars isRecording={isRecording} />
          </button>
          <button
            ref={chatButtonRef}
            type="button"
            onClick={() => toggleMode('chat')}
            aria-label={`${chatDockLabel} about this note`}
            className="flex h-14 min-w-0 flex-1 items-center rounded-full border border-neutral-300/80 bg-white px-5 text-left text-sm text-neutral-500 shadow-lg outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-900/15 dark:border-white/12 dark:bg-[#272427] dark:text-neutral-400 dark:hover:bg-[#343034] dark:hover:text-neutral-100 dark:focus-visible:ring-white/20"
          >
            <span className="truncate">
              {chatDockLabel}
            </span>
          </button>
        </div>

        {assistant && trackSize.width > 0 && (
          <motion.div
            initial={{
              left: assistant.sourceBox.left,
              width: assistant.sourceBox.width,
              height: footerHeight,
              borderRadius: 28,
            }}
            animate={{
              ...surfaceGeometry,
              borderRadius: 28,
            }}
            transition={surfaceTransition}
            onAnimationComplete={() => {
              setAssistant((current) => {
                if (!current) return null
                if (current.phase === 'opening-footer' || current.phase === 'opening-panel') return { ...current, phase: 'open' }
                if (current.phase === 'closing-footer') return { ...current, phase: 'closing-source' }
                if (current.phase === 'closing-source') return null
                return current
              })
            }}
            className="pointer-events-auto absolute bottom-0 z-10 overflow-hidden border border-neutral-300/80 bg-white text-neutral-900 dark:border-white/12 dark:bg-[#272427] dark:text-neutral-100"
          >
            <motion.div
              aria-hidden="true"
              animate={{ opacity: open ? 0 : 1 }}
              transition={{ duration: 0.07 }}
              className="pointer-events-none absolute inset-x-0 bottom-0 flex h-14 items-center overflow-hidden"
            >
              {assistant.mode === 'transcript' ? (
                <>
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center">
                    <RecordingBars
                      isRecording={isRecording}
                      className="text-neutral-600 dark:text-neutral-300"
                    />
                  </span>
                  <span className="truncate px-1 text-sm text-neutral-500 dark:text-neutral-400">
                    Transcript
                  </span>
                </>
              ) : (
                <span className="truncate px-5 text-sm text-neutral-500 dark:text-neutral-400">
                  {chatDockLabel}
                </span>
              )}
            </motion.div>

            <motion.section
              role="dialog"
              aria-modal="false"
              aria-label={assistant.mode === 'transcript' ? 'Note transcript' : 'Chat about this note'}
              aria-hidden={!open}
              initial={{ opacity: 0 }}
              animate={{ opacity: open ? 1 : 0 }}
              transition={{ duration: open ? 0.09 : 0.07 }}
              className={cn(
                'absolute inset-0 flex min-h-0 flex-col',
                !dialogVisible && 'pointer-events-none',
              )}
            >
              <div className={cn('flex h-full min-h-0 flex-col', assistant.mode !== 'transcript' && 'hidden')}>
                <header className="flex h-11 shrink-0 items-center justify-end px-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={closeAssistant}
                    aria-label="Close transcript"
                    title="Close transcript"
                    className="h-7 w-7"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto p-3 sidebar-scrollbar">
                  <InfoBanner className="mb-3">
                    The transcript may show repeated sentences without headphones, but your final notes will be unaffected. For the best experience, use headphones.
                  </InfoBanner>
                  <SavedTranscriptView
                    segments={transcriptQuery.data?.segments ?? []}
                    loading={transcriptQuery.isLoading}
                    theme="light"
                  />
                </div>
                <footer className="flex h-16 shrink-0 items-center justify-between border-t border-neutral-200 px-4 dark:border-white/10">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex shrink-0 items-center gap-1 text-neutral-500 dark:text-neutral-300">
                      <RecordingBars isRecording={isRecording} />
                      <ChevronDown className="h-3 w-3" />
                    </span>
                    <span className="truncate text-sm font-medium text-lime-600 dark:text-lime-400">
                      {isRecording ? 'Pause' : 'Resume'}
                    </span>
                  </div>
                  <span
                    aria-label="Transcript settings"
                    className="flex h-8 w-8 shrink-0 items-center justify-center text-neutral-500 dark:text-neutral-400"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                  </span>
                </footer>
              </div>

              <div className={cn('h-full min-h-0', assistant.mode !== 'chat' && 'invisible absolute inset-0')}>
                <NoteChatPanel
                  key={noteId}
                  noteId={noteId}
                  noteTitle={noteTitle}
                  onClose={closeAssistant}
                  onConversationStateChange={setHasChatMessages}
                  autoFocus={assistant.mode === 'chat' && open}
                  draft={chatDraft}
                  onDraftChange={setChatDraft}
                />
              </div>
            </motion.section>
          </motion.div>
        )}

        <p className="pointer-events-none absolute inset-x-0 top-full mt-0.5 text-center text-[9px] leading-4 text-neutral-400 dark:text-neutral-500">
          Can edit this note only. Fixture responses do not save changes.
        </p>
      </div>
    </div>
  )
}
