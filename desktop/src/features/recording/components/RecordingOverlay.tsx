import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import RecordingOverlayHeader from '@/features/recording/components/RecordingOverlayHeader'
import LiveTranscriptViewport from '@/features/recording/components/LiveTranscriptViewport'
import RecordingOverlayNotepad from '@/features/recording/components/RecordingOverlayNotepad'
import { Tabs } from '@/components/ui/tabs'
import {
  useRecordingSessionSnapshot,
  useRecordingTranscriptSnapshot,
  useRecordingUiController,
} from '@/features/recording/RecordingUiContext'
import { cn } from '@/lib/utils'
import { desktopApi } from '@/lib/desktop-api'
import { useRecordingNoteDraftFeed } from '@/features/recording/use-recording-note-draft-feed'

type RecordingOverlayProps = {
  initialCollapsed?: boolean
}

export default function RecordingOverlay({ initialCollapsed = false }: RecordingOverlayProps) {
  const controller = useRecordingUiController()
  const session = useRecordingSessionSnapshot()
  const [collapsed, setCollapsed] = useState(initialCollapsed)
  const [activeView, setActiveView] = useState<'notepad' | 'transcript'>('notepad')
  const [notepadDraft, setNotepadDraft] = useState({ sessionId: '', value: '' })
  // Latest draft value maintained synchronously at the send/receive sites.
  // Main's pre-window-swap flush request must never be answered with the
  // one-keystroke-stale value React state holds before its re-render commits.
  const flushValueRef = useRef<{ sessionId: string; noteId: string; value: string } | null>(null)
  const reduceMotion = useReducedMotion()
  const sessionId = session?.sessionId
  const noteId = session?.noteId
  const scope = useMemo(() => sessionId && noteId
    ? { sessionId, noteId }
    : null, [noteId, sessionId])
  const segments = useRecordingTranscriptSnapshot(scope)

  // The handler's identity changes with the session scope, restarting the
  // feed (and its version guard) for each recording session.
  useRecordingNoteDraftFeed(useCallback((draft) => {
    if (!sessionId || !noteId || !draft || draft.sessionId !== sessionId || draft.noteId !== noteId) return
    flushValueRef.current = { sessionId, noteId, value: draft.value }
    setNotepadDraft({ sessionId, value: draft.value })
  }, [noteId, sessionId]))

  const handleNotepadDraftChange = useCallback((draft: string) => {
    if (!sessionId || !noteId) return
    flushValueRef.current = { sessionId, noteId, value: draft }
    setNotepadDraft({ sessionId, value: draft })
    desktopApi.recording.updateNoteDraft({ sessionId, noteId, value: draft })
  }, [noteId, sessionId])

  // Answer main's pre-window-swap draft flush with the freshest editor value.
  useEffect(() => desktopApi.recording.setDraftFlushProvider(() => flushValueRef.current), [])

  if (!session) return null
  return (
    <Tabs
      value={activeView}
      onValueChange={(value) => setActiveView(value === 'transcript' ? 'transcript' : 'notepad')}
      className="gap-0"
    >
      <motion.section
      data-recording-overlay-surface
      data-overlay-visible
      aria-label="Recording overlay"
      initial={false}
      animate={{
        width: collapsed ? 224 : 420,
        height: collapsed ? 48 : 500,
        borderRadius: 28,
      }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'relative flex select-none flex-col overflow-hidden border border-neutral-300/80',
        'bg-white/82 text-neutral-900 shadow-[0_18px_46px_-28px_rgba(15,23,42,0.5)] backdrop-blur-xl',
        'dark:border-white/12 dark:bg-[#171417]/80 dark:text-neutral-100 dark:shadow-[0_20px_50px_-30px_rgba(0,0,0,0.9)]',
      )}
    >
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <RecordingOverlayHeader
          collapsed={collapsed}
          controller={controller}
          session={session}
          onToggleCollapsed={() => setCollapsed((current) => !current)}
        />

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              key="transcript"
              initial={reduceMotion ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: reduceMotion ? 0 : 0.13 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              {session.recoverableError && (
                <div className="mx-3 mb-1 rounded-lg border border-red-300/60 bg-red-50/70 px-3 py-2 text-[11px] text-red-700 dark:border-red-300/15 dark:bg-red-400/8 dark:text-red-200">
                  {session.recoverableError}
                </div>
              )}

              {activeView === 'notepad' ? (
                <RecordingOverlayNotepad
                  noteId={session.noteId}
                  draft={notepadDraft.sessionId === session.sessionId ? notepadDraft.value : ''}
                  onDraftChange={handleNotepadDraftChange}
                />
              ) : (
                <LiveTranscriptViewport
                  segments={segments}
                  transcriptPhase={session.transcriptPhase}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      </motion.section>
    </Tabs>
  )
}
