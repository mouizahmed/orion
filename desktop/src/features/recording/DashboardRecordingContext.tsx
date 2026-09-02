import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import type { RecordingNoteDraft, RecordingUiSnapshot } from '@/features/recording/recording-types'
import { desktopApi } from '@/lib/desktop-api'
import { applyRecordingTranscriptUpdate } from '@/features/recording/recording-state'
import { useRecordingNoteDraftFeed } from '@/features/recording/use-recording-note-draft-feed'

const EMPTY_SNAPSHOT: RecordingUiSnapshot = { session: null, transcript: [] }

type DashboardRecordingContextValue = {
  snapshot: RecordingUiSnapshot
  noteDraft: RecordingNoteDraft | null
  showOverlay: () => Promise<void>
  resume: (noteId: string, noteTitle: string, noteMarkdown: string) => Promise<void>
  updateNoteDraft: (noteId: string, value: string) => void
  acknowledgeNoteDraft: (draft: RecordingNoteDraft) => void
}

type DashboardRecordingSessionContextValue = {
  session: RecordingUiSnapshot['session']
  hasPendingDraft: boolean
}

const DashboardRecordingContext = createContext<DashboardRecordingContextValue | null>(null)
const DashboardRecordingSessionContext = createContext<DashboardRecordingSessionContextValue | null>(null)

export function DashboardRecordingProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<RecordingUiSnapshot>(EMPTY_SNAPSHOT)
  const [noteDraft, setNoteDraft] = useState<RecordingNoteDraft | null>(null)
  const sessionRef = useRef(snapshot.session)
  const noteDraftRef = useRef(noteDraft)
  sessionRef.current = snapshot.session
  noteDraftRef.current = noteDraft
  // Latest draft value known outside React's render cycle. React state refs lag
  // a keystroke behind until the re-render commits, and a flush request can
  // arrive in that gap; answering it with the lagging value would make main
  // adopt the stale text as newest and revert the keystroke.
  const flushValueRef = useRef<Pick<RecordingNoteDraft, 'sessionId' | 'noteId' | 'value'> | null>(null)

  useEffect(() => {
    let active = true
    let receivedSessionEvent = false
    const unsubscribeSession = desktopApi.recording.onSession((session) => {
      receivedSessionEvent = true
      setSnapshot((current) => ({
        session,
        transcript: session && current.transcript.every((segment) => (
          segment.sessionId === session.sessionId && segment.noteId === session.noteId
        ))
          ? current.transcript
          : [],
      }))
    })
    const unsubscribeTranscript = desktopApi.recording.onTranscriptUpdate((segment) => {
      setSnapshot((current) => {
        if (
          current.session
          && (current.session.sessionId !== segment.sessionId || current.session.noteId !== segment.noteId)
        ) return current
        const transcript = applyRecordingTranscriptUpdate(current.transcript, segment)
        return transcript === current.transcript ? current : { ...current, transcript }
      })
    })
    void desktopApi.recording.getSnapshot().then((next) => {
      if (!active || receivedSessionEvent) return
      setSnapshot((current) => {
        if (!next.session) return next
        let transcript = next.transcript
        for (const segment of current.transcript) {
          if (segment.sessionId === next.session.sessionId && segment.noteId === next.session.noteId) {
            transcript = applyRecordingTranscriptUpdate(transcript, segment)
          }
        }
        return { session: next.session, transcript }
      })
    }).catch((error) => {
      console.error('Failed to load recording UI snapshot', error)
    })
    return () => {
      active = false
      unsubscribeSession()
      unsubscribeTranscript()
    }
  }, [])

  // When main swaps window visibility it requests this renderer's final draft
  // value before revealing the other window, so keystrokes typed right up to
  // the swap are part of the draft the incoming editor hydrates from.
  useEffect(() => desktopApi.recording.setDraftFlushProvider(() => flushValueRef.current), [])

  useRecordingNoteDraftFeed(useCallback((next: RecordingNoteDraft | null) => {
    if (!next) {
      flushValueRef.current = null
      setNoteDraft(null)
      return
    }
    flushValueRef.current = { sessionId: next.sessionId, noteId: next.noteId, value: next.value }
    setNoteDraft(next)
  }, []))

  const controls = useMemo(() => ({
    showOverlay: () => desktopApi.recording.showOverlay(),
    resume: (noteId: string, noteTitle: string, noteMarkdown: string) => desktopApi.recording.start({ noteId, noteTitle, noteMarkdown }),
    updateNoteDraft: (noteId: string, draft: string) => {
      const session = sessionRef.current
      const currentNoteDraft = noteDraftRef.current
      const scope = session && session.noteId === noteId
        ? { sessionId: session.sessionId, noteId: session.noteId }
        : currentNoteDraft?.noteId === noteId
          ? { sessionId: currentNoteDraft.sessionId, noteId: currentNoteDraft.noteId }
          : null
      if (!scope) return
      flushValueRef.current = { ...scope, value: draft }
      setNoteDraft((current) => current?.sessionId === scope.sessionId
        ? { ...current, value: draft }
        : current)
      desktopApi.recording.updateNoteDraft({
        ...scope,
        value: draft,
      })
    },
    acknowledgeNoteDraft: (draft: RecordingNoteDraft) => desktopApi.recording.acknowledgeNoteDraft(draft),
  }), [])

  const value = useMemo<DashboardRecordingContextValue>(() => ({
    snapshot,
    noteDraft,
    ...controls,
  }), [controls, noteDraft, snapshot])

  const hasPendingDraft = Boolean(noteDraft)
  const sessionValue = useMemo<DashboardRecordingSessionContextValue>(() => ({
    session: snapshot.session,
    hasPendingDraft,
  }), [hasPendingDraft, snapshot.session])

  return (
    <DashboardRecordingSessionContext.Provider value={sessionValue}>
      <DashboardRecordingContext.Provider value={value}>
        {children}
      </DashboardRecordingContext.Provider>
    </DashboardRecordingSessionContext.Provider>
  )
}

export function useDashboardRecordingSession() {
  const context = useContext(DashboardRecordingSessionContext)
  if (!context) throw new Error('useDashboardRecordingSession must be used within DashboardRecordingProvider')
  return context
}

export function useDashboardRecording() {
  const context = useContext(DashboardRecordingContext)
  if (!context) throw new Error('useDashboardRecording must be used within DashboardRecordingProvider')
  return context
}
