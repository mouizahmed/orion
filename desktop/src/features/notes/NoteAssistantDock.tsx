import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'

import NoteChatPanel from '@/features/chat/note/NoteChatPanel'
import { useNoteChatSession } from '@/features/chat/note/useNoteChatSession'
import NoteAssistantDockControls from '@/features/notes/NoteAssistantDockControls'
import NoteAssistantSurface, {
  ASSISTANT_FOOTER_HEIGHT,
  TRANSCRIPT_FOOTER_HEIGHT,
} from '@/features/notes/NoteAssistantSurface'
import NoteTranscriptPanel from '@/features/notes/NoteTranscriptPanel'
import {
  getNoteAssistantChatLabel,
  noteAssistantReducer,
  type ActiveNoteAssistantMode,
} from '@/features/notes/note-assistant-state'
import { useNoteTranscriptQuery } from '@/features/notes/queries/useNotesQueries'

type NoteAssistantDockProps = {
  accountId?: string
  noteId: string
  noteTitle: string
  isRecording?: boolean
}

function blurActiveElement() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
}

export default function NoteAssistantDock({
  accountId,
  noteId,
  noteTitle,
  isRecording = false,
}: NoteAssistantDockProps) {
  const [assistant, dispatchAssistant] = useReducer(noteAssistantReducer, null)
  const [trackHeight, setTrackHeight] = useState(0)
  const previousNoteIdRef = useRef(noteId)
  const trackRef = useRef<HTMLDivElement>(null)
  const mode = assistant?.mode ?? 'closed'
  const transcriptQuery = useNoteTranscriptQuery(accountId, noteId, mode === 'transcript')
  const chatSession = useNoteChatSession(noteId, noteTitle)

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return

    const updateTrackHeight = () => setTrackHeight(track.clientHeight)
    updateTrackHeight()

    const observer = new ResizeObserver(updateTrackHeight)
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (previousNoteIdRef.current === noteId) return
    previousNoteIdRef.current = noteId
    dispatchAssistant({ type: 'reset' })
  }, [noteId])

  const closeAssistant = useCallback(() => {
    blurActiveElement()
    dispatchAssistant({ type: 'close' })
  }, [])

  useEffect(() => {
    if (!assistant) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAssistant()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [assistant, closeAssistant])

  const toggleMode = useCallback((requestedMode: ActiveNoteAssistantMode) => {
    blurActiveElement()
    dispatchAssistant({ type: 'toggle', mode: requestedMode })
  }, [])

  const finishPanelAnimation = useCallback(() => {
    dispatchAssistant({ type: 'animation-complete' })
  }, [])

  const panelHeight = Math.max(
    ASSISTANT_FOOTER_HEIGHT,
    Math.min(window.innerHeight * 0.68 + 4, 564, trackHeight),
  )
  const transcriptPanelHeight = panelHeight + TRANSCRIPT_FOOTER_HEIGHT - ASSISTANT_FOOTER_HEIGHT
  const chatDockLabel = chatSession.draft || getNoteAssistantChatLabel(chatSession.messages.length > 0)
  const transcriptActive = assistant?.mode === 'transcript'
  const chatActive = assistant?.mode === 'chat'
  const panelVisible = Boolean(assistant && assistant.phase !== 'closing')

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
        {trackHeight > 0 && (
          <>
            <NoteAssistantDockControls
              assistantActive={Boolean(assistant)}
              chatActive={chatActive}
              chatLabel={chatDockLabel}
              isRecording={isRecording}
              panelVisible={panelVisible}
              transcriptActive={transcriptActive}
              onToggleChat={() => toggleMode('chat')}
              onToggleTranscript={() => toggleMode('transcript')}
            />

            {transcriptActive && (
              <NoteTranscriptPanel
                expanded={panelVisible}
                expandedHeight={transcriptPanelHeight}
                isRecording={isRecording}
                loading={transcriptQuery.isLoading}
                segments={transcriptQuery.data?.segments ?? []}
                onAnimationComplete={finishPanelAnimation}
                onClose={closeAssistant}
              />
            )}

            <NoteAssistantSurface
              ariaLabel="Chat about this note"
              active={chatActive}
              collapsedHeight={ASSISTANT_FOOTER_HEIGHT}
              expandedHeight={panelHeight}
              expanded={chatActive && panelVisible}
              onAnimationComplete={() => {
                if (chatActive) finishPanelAnimation()
              }}
              className="w-full"
            >
              <NoteChatPanel
                key={noteId}
                noteId={noteId}
                noteTitle={noteTitle}
                onClose={closeAssistant}
                autoFocus={chatActive && panelVisible}
              />
            </NoteAssistantSurface>
          </>
        )}

        <p className="pointer-events-none absolute inset-x-0 top-full mt-0.5 text-center text-[9px] leading-4 text-neutral-400 dark:text-neutral-500">
          Can edit this note only. Fixture responses do not save changes.
        </p>
      </div>
    </div>
  )
}
