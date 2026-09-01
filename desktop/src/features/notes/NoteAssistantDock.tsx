import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, Search, Settings2, X } from 'lucide-react'
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
type AssistantPhase = 'opening' | 'open' | 'closing'

type ActiveAssistant = {
  mode: AssistantMode
  phase: AssistantPhase
}

const openFooterHeight = 60
const transcriptFooterHeight = 64

const surfaceTransition = {
  type: 'tween' as const,
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1] as const,
}

const dockFadeTransition = { duration: 0.08 }

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
  const mode = assistant?.mode ?? 'closed'
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
      if (assistant.mode === requestedMode) {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        setAssistant((current) => {
          if (!current || current.mode !== requestedMode) return current
          return {
            ...current,
            phase: current.phase === 'closing' ? 'opening' : 'closing',
          }
        })
      }
      return
    }
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setAssistant({ mode: requestedMode, phase: 'opening' })
  }

  function closeAssistant() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setAssistant((current) => {
      if (!current || current.phase === 'closing') return current
      return { ...current, phase: 'closing' }
    })
  }

  const panelHeight = Math.max(
    openFooterHeight,
    Math.min(window.innerHeight * 0.68 + 4, 564, trackSize.height),
  )
  const chatDockLabel = chatDraft || getNoteAssistantChatLabel(hasChatMessages)
  const transcriptActive = assistant?.mode === 'transcript'
  const chatActive = assistant?.mode === 'chat'
  const panelVisible = Boolean(assistant && assistant.phase !== 'closing')
  const transcriptPanelHeight = panelHeight + transcriptFooterHeight - openFooterHeight

  const finishPanelAnimation = () => {
    setAssistant((current) => {
      if (!current) return current
      if (current.phase === 'opening') return { ...current, phase: 'open' }
      if (current.phase === 'closing') return null
      return current
    })
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {assistant && (
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
        {trackSize.width > 0 && (
          <>
            <motion.button
              type="button"
              onClick={() => toggleMode('transcript')}
              aria-label={transcriptActive && panelVisible ? 'Close transcript' : 'Open transcript'}
              title={transcriptActive && panelVisible ? 'Close transcript' : 'Transcript'}
              initial={false}
              animate={{ opacity: chatActive && panelVisible ? 0 : 1 }}
              transition={dockFadeTransition}
              className={cn(
                'absolute bottom-0 left-0 z-30 flex h-14 w-14 items-center justify-center gap-1 rounded-full border bg-white text-neutral-600 outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-900/15 dark:bg-[#272427] dark:text-neutral-300 dark:hover:bg-[#343034] dark:hover:text-white dark:focus-visible:ring-white/20',
                transcriptActive
                  ? 'border-transparent shadow-none'
                  : 'border-neutral-300/80 shadow-lg dark:border-white/12',
                chatActive && panelVisible ? 'pointer-events-none' : 'pointer-events-auto',
              )}
            >
              <RecordingBars isRecording={isRecording} />
              <motion.span
                initial={false}
                animate={{ rotate: transcriptActive && panelVisible ? 0 : 180 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
                className="flex shrink-0 items-center justify-center"
              >
                <ChevronDown className="h-3 w-3" />
              </motion.span>
            </motion.button>

            <motion.div
              initial={false}
              animate={{ opacity: panelVisible ? 0 : 1 }}
              transition={dockFadeTransition}
              className={cn(
                'absolute inset-x-0 bottom-0 z-10 flex h-14 pl-16',
                assistant ? 'pointer-events-none' : 'pointer-events-auto',
              )}
            >
              <button
                type="button"
                onClick={() => toggleMode('chat')}
                aria-label={`${chatDockLabel} about this note`}
                className="flex h-14 min-w-0 flex-1 items-center rounded-full border border-neutral-300/80 bg-white px-5 text-left text-sm text-neutral-500 shadow-lg outline-none transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-900/15 dark:border-white/12 dark:bg-[#272427] dark:text-neutral-400 dark:hover:bg-[#343034] dark:hover:text-neutral-100 dark:focus-visible:ring-white/20"
              >
                <span className="truncate">{chatDockLabel}</span>
              </button>
            </motion.div>

            {transcriptActive && (
              <motion.section
                role="dialog"
                aria-modal="false"
                aria-label="Note transcript"
                initial={{ height: transcriptFooterHeight, opacity: 0 }}
                animate={{
                  height: panelVisible ? transcriptPanelHeight : transcriptFooterHeight,
                  opacity: panelVisible ? 1 : 0,
                }}
                transition={{
                  height: surfaceTransition,
                  opacity: { duration: 0.1, ease: 'easeOut' },
                }}
                onAnimationComplete={finishPanelAnimation}
                className="pointer-events-auto absolute -bottom-1 -left-1 z-20 flex min-h-0 w-[calc(100%+0.5rem)] flex-col overflow-hidden rounded-[28px] border border-neutral-300/80 bg-white text-neutral-900 dark:border-white/12 dark:bg-[#272427] dark:text-neutral-100"
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Transcript settings"
                    title="Transcript settings"
                    className="h-9 w-9 shrink-0 rounded-full text-neutral-500 dark:text-neutral-400"
                  >
                    <Settings2 className="h-5 w-5" />
                  </Button>
                </div>
              </motion.section>
            )}

            {chatActive && (
              <motion.section
                role="dialog"
                aria-modal="false"
                aria-label="Chat about this note"
                initial={{ height: openFooterHeight, opacity: 0 }}
                animate={{
                  height: panelVisible ? panelHeight : openFooterHeight,
                  opacity: panelVisible ? 1 : 0,
                }}
                transition={{
                  height: surfaceTransition,
                  opacity: { duration: 0.1, ease: 'easeOut' },
                }}
                onAnimationComplete={finishPanelAnimation}
                className="pointer-events-auto absolute bottom-0 left-0 z-20 w-full overflow-hidden rounded-[28px] border border-neutral-300/80 bg-white text-neutral-900 dark:border-white/12 dark:bg-[#272427] dark:text-neutral-100"
              >
                <NoteChatPanel
                  key={noteId}
                  noteId={noteId}
                  noteTitle={noteTitle}
                  onClose={closeAssistant}
                  onConversationStateChange={setHasChatMessages}
                  autoFocus={panelVisible}
                  draft={chatDraft}
                  onDraftChange={setChatDraft}
                />
              </motion.section>
            )}
          </>
        )}

        <p className="pointer-events-none absolute inset-x-0 top-full mt-0.5 text-center text-[9px] leading-4 text-neutral-400 dark:text-neutral-500">
          Can edit this note only. Fixture responses do not save changes.
        </p>
      </div>
    </div>
  )
}
