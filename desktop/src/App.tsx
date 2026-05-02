import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

import { DesktopAuthRoot, useAuth } from '@/contexts/AuthContext'
import CompactOverlayBar from '@/components/CompactOverlayBar'
import CompactMeetingPanel, { type CompactMeetingPanelHandle } from '@/components/CompactMeetingPanel'
import SettingsPanel from '@/components/SettingsPanel'
import TranscriptPanel from '@/components/TranscriptPanel'
import Welcome from '@/components/Welcome'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import './App.css'
import { createNote } from '@/lib/notes-client'
import { auth } from '@/config/firebase'
import { useTranscription } from '@/hooks/useTranscription'

const WINDOW_VERTICAL_PADDING = 0
const MAX_APP_HEIGHT = 900
const WINDOW_HORIZONTAL_PADDING = 0
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'
const TEMP_BYPASS_MEETING_BACKEND = true
const OVERLAY_COMPACT_WIDTH = 356
const OVERLAY_MEETING_COMPACT_WIDTH = 464
const OVERLAY_EXPANDED_WIDTH = 520
const PANEL_UNDER_PILL_CLASSNAME = 'w-full'
type MeetingPanel = 'notepad' | 'transcript' | 'insights' | 'ask'
type WelcomeLayout = 'compact' | 'large'

const WELCOME_LAYOUT_WIDTH: Record<WelcomeLayout, number> = {
  compact: 592,
  large: 1254,
}

const LAYOUT_WIDTH: Record<'welcome' | 'settings' | 'compact' | 'compactMeeting' | 'expandedMeeting', number> = {
  welcome: WELCOME_LAYOUT_WIDTH.compact,
  settings: OVERLAY_EXPANDED_WIDTH,
  compact: OVERLAY_COMPACT_WIDTH,
  compactMeeting: OVERLAY_EXPANDED_WIDTH,
  expandedMeeting: OVERLAY_MEETING_COMPACT_WIDTH,
}

function AppContent() {
  const { user, isLoading, logout } = useAuth()
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [activePanel, setActivePanel] = useState<'main' | 'settings'>('main')
  const [meetingPanel, setMeetingPanel] = useState<MeetingPanel | null>(null)
  const [welcomeLayout, setWelcomeLayout] = useState<WelcomeLayout>('compact')
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null)
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    setContentEl(node)
  }, [])

  const [meetingActive, setMeetingActive] = useState(false)
  const [meetingPaused, setMeetingPaused] = useState(false)
  const [meetingNoteId, setMeetingNoteId] = useState<string | null>(null)
  const [meetingSessionId, setMeetingSessionId] = useState<string | null>(null)
  const [micMuted, setMicMuted] = useState(false)
  const [speakerMuted, setSpeakerMuted] = useState(false)
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(false)
  const [transcriptionMode, setTranscriptionMode] = useState<'live' | 'notes_only'>('live')
  const [transcriptionNotice, setTranscriptionNotice] = useState<string | null>(null)
  const [showDashboardConfirm, setShowDashboardConfirm] = useState(false)
  const [settingsPanelMounted, setSettingsPanelMounted] = useState(false)
  const [settingsPanelClosing, setSettingsPanelClosing] = useState(false)
  const [notepadFocusRequest, setNotepadFocusRequest] = useState(0)
  const meetingPanelRef = useRef<CompactMeetingPanelHandle>(null)
  const pendingNotepadFocusRef = useRef(false)
  const notepadFocusTimerRef = useRef<number | null>(null)

  const isQuotaError = (error: Error) => {
    const text = `${error.message}`.toLowerCase()
    return /(quota|limit|minute|credit|billing|insufficient|exceed)/.test(text)
  }

  const { segments: transcriptSegments, status: transcriptStatus, getTranscriptSnapshot, flushSegments } = useTranscription({
    enabled: meetingActive && transcriptionEnabled,
    micMuted,
    speakerMuted,
    sessionKey: meetingNoteId,
    meetingNoteId,
    onError: (err) => {
      if (isQuotaError(err)) {
        setTranscriptionEnabled(false)
        setTranscriptionMode('notes_only')
        setTranscriptionNotice('Transcript paused: minutes exhausted. Notes continue.')
        return
      }
      console.error('Transcription error:', err)
    },
  })

  useEffect(() => {
    window.windowControl?.onDragOffset((offset) => {
      setDragOffset(offset)
    })
  }, [])

  useEffect(() => {
    const handleWelcomeLayoutChange = (event: Event) => {
      const layout = (event as CustomEvent<{ layout?: WelcomeLayout }>).detail?.layout
      if (layout === 'compact' || layout === 'large') {
        setWelcomeLayout(layout)
      }
    }

    window.addEventListener('welcome-layout-change', handleWelcomeLayoutChange)
    return () => {
      window.removeEventListener('welcome-layout-change', handleWelcomeLayoutChange)
    }
  }, [])

  useLayoutEffect(() => {
    if (notepadFocusTimerRef.current) {
      window.clearTimeout(notepadFocusTimerRef.current)
      notepadFocusTimerRef.current = null
    }

    pendingNotepadFocusRef.current = false
    setActivePanel('main')
    setMeetingPanel(null)
    setShowDashboardConfirm(false)
    setSettingsPanelMounted(false)
    setSettingsPanelClosing(false)

    if (user) return

    setMeetingActive(false)
    setMeetingPaused(false)
    setMeetingNoteId(null)
    setMeetingSessionId(null)
    setMicMuted(false)
    setSpeakerMuted(false)
    setTranscriptionEnabled(false)
    setTranscriptionMode('live')
    setTranscriptionNotice(null)
  }, [user])

  useEffect(() => {
    const unsubscribe = window.windowControl?.onToggleNotepadFocus?.(() => {
      if (!meetingActive || !meetingNoteId) return

      if (meetingPanel === 'notepad' && meetingPanelRef.current?.isEditorFocused()) {
        meetingPanelRef.current.blurEditor()
        window.windowControl?.blurOverlay?.()
        return
      }

      pendingNotepadFocusRef.current = true
      setActivePanel('main')
      setMeetingPanel('notepad')
      setNotepadFocusRequest((request) => request + 1)
    })

    return () => {
      unsubscribe?.()
    }
  }, [meetingActive, meetingNoteId, meetingPanel])

  const toggleMeetingPanel = useCallback((panel: MeetingPanel) => {
    if (!meetingActive) return
    setActivePanel('main')
    setMeetingPanel((current) => {
      const next = current === panel ? null : panel
      if (next === 'notepad') {
        pendingNotepadFocusRef.current = true
        setNotepadFocusRequest((request) => request + 1)
      }
      return next
    })
  }, [meetingActive])

  useEffect(() => {
    const unsubscribe = window.windowControl?.onToggleOverlayPanel?.((panel) => {
      toggleMeetingPanel(panel)
    })

    return () => {
      unsubscribe?.()
    }
  }, [toggleMeetingPanel])

  const focusNotepadEditorWithRetry = useCallback((attempt = 0) => {
    if (notepadFocusTimerRef.current) {
      window.clearTimeout(notepadFocusTimerRef.current)
      notepadFocusTimerRef.current = null
    }

    meetingPanelRef.current?.focusEditor()

    if (meetingPanelRef.current?.isEditorFocused()) {
      pendingNotepadFocusRef.current = false
      return
    }

    if (attempt >= 20) {
      pendingNotepadFocusRef.current = false
      return
    }

    notepadFocusTimerRef.current = window.setTimeout(() => {
      focusNotepadEditorWithRetry(attempt + 1)
    }, 50)
  }, [])

  useEffect(() => {
    if (!pendingNotepadFocusRef.current || activePanel !== 'main' || meetingPanel !== 'notepad') {
      return
    }

    focusNotepadEditorWithRetry()

    return () => {
      if (notepadFocusTimerRef.current) {
        window.clearTimeout(notepadFocusTimerRef.current)
        notepadFocusTimerRef.current = null
      }
    }
  }, [activePanel, focusNotepadEditorWithRetry, meetingPanel, notepadFocusRequest])

  useEffect(() => {
    const handleGlobalMouseMove = (event: MouseEvent) => {
      if (!isDragging) return
      window.windowControl?.moveDrag(event.screenX, event.screenY, dragOffset.x, dragOffset.y)
    }

    const handleGlobalMouseUp = () => {
      setIsDragging(false)
    }

    if (isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove)
      document.addEventListener('mouseup', handleGlobalMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove)
      document.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [isDragging, dragOffset])

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    setIsDragging(true)
    window.windowControl?.startDrag(event.screenX, event.screenY)
  }

  const layoutKey: 'welcome' | 'settings' | 'compact' | 'compactMeeting' | 'expandedMeeting' = useMemo(() => {
    if (!user) return 'welcome'
    if (activePanel === 'settings' || settingsPanelMounted) return 'settings'
    if (meetingActive) return meetingPanel ? 'compactMeeting' : 'expandedMeeting'
    return 'compact'
  }, [activePanel, meetingActive, meetingPanel, settingsPanelMounted, user])
  const [windowLayoutKey, setWindowLayoutKey] = useState(layoutKey)
  const isContentSizedLayout = layoutKey === 'compact' || layoutKey === 'expandedMeeting'

  const shouldRenderSettingsPanel = activePanel === 'settings' || settingsPanelMounted

  useEffect(() => {
    if (layoutKey !== 'compact' && layoutKey !== 'expandedMeeting') {
      setWindowLayoutKey(layoutKey)
      return
    }

    const timer = window.setTimeout(() => {
      setWindowLayoutKey(layoutKey)
    }, 220)

    return () => window.clearTimeout(timer)
  }, [layoutKey])

  useEffect(() => {
    if (activePanel === 'settings') {
      setSettingsPanelMounted(true)
      setSettingsPanelClosing(false)
      return
    }

    if (!settingsPanelMounted) return

    setSettingsPanelClosing(true)
    const timer = window.setTimeout(() => {
      setSettingsPanelMounted(false)
      setSettingsPanelClosing(false)
    }, 160)

    return () => window.clearTimeout(timer)
  }, [activePanel, settingsPanelMounted])

  useLayoutEffect(() => {
    if (!contentEl) return

    const updateHeight = () => {
      const contentHeight = Math.min(Math.ceil(contentEl.getBoundingClientRect().height), MAX_APP_HEIGHT)
      const height = contentHeight + WINDOW_VERTICAL_PADDING
      const contentWidth = windowLayoutKey === 'compact' || windowLayoutKey === 'expandedMeeting'
        ? Math.ceil(contentEl.getBoundingClientRect().width)
        : windowLayoutKey === 'welcome'
          ? WELCOME_LAYOUT_WIDTH[welcomeLayout]
        : LAYOUT_WIDTH[windowLayoutKey]
      const width = contentWidth + WINDOW_HORIZONTAL_PADDING
      const visibleEl = contentEl.querySelector<HTMLElement>('[data-overlay-visible]')
      if (visibleEl) {
        const contentRect = contentEl.getBoundingClientRect()
        const visibleRect = visibleEl.getBoundingClientRect()
        window.windowControl?.setVisibleOverlayBounds?.({
          offsetX: Math.round(visibleRect.left - contentRect.left),
          offsetY: 0,
          width: Math.ceil(visibleRect.width),
          height: Math.max(1, height),
        })
      }
      if (typeof window.windowControl?.setWindowSize === 'function') {
        window.windowControl.setWindowSize(width, height)
      } else {
        window.windowControl?.setWindowHeight?.(height)
      }
    }

    updateHeight()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      updateHeight()
    })

    observer.observe(contentEl)

    return () => {
      observer.disconnect()
    }
  }, [contentEl, welcomeLayout, windowLayoutKey])

  // Show nothing while loading auth state
  if (isLoading) {
    return null
  }

  const getIdToken = async () => {
    const currentUser = auth.currentUser
    if (!currentUser) {
      throw new Error('Not authenticated')
    }
    return await currentUser.getIdToken()
  }

  const startRecording = async (noteId: string) => {
    const idToken = await getIdToken()
    const response = await fetch(`${API_BASE_URL}/notes/${noteId}/recording/start`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(payload.error || 'Failed to start recording')
    }

    const payload = (await response.json()) as { session?: { id: string } }
    if (!payload.session?.id) {
      throw new Error('Failed to start recording')
    }
    return payload.session.id
  }

  const stopRecording = async (noteId: string, sessionId: string, transcript?: string) => {
    const idToken = await getIdToken()
    const response = await fetch(`${API_BASE_URL}/notes/${noteId}/recording/${sessionId}/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        final_transcript: transcript || undefined,
      }),
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      throw new Error(payload.error || 'Failed to stop recording')
    }
  }

  const endMeeting = async () => {
    // Flush any unsaved structured transcript segments before cleanup
    try {
      await flushSegments()
    } catch (error) {
      console.error('Failed to flush transcript segments', error)
    }

    const transcriptToSave = getTranscriptSnapshot()
    if (meetingNoteId && meetingSessionId) {
      try {
        await stopRecording(meetingNoteId, meetingSessionId, transcriptToSave)
      } catch (error) {
        console.error('Failed to stop recording session', error)
      }
    }
    setMeetingActive(false)
    setMeetingPaused(false)
    setMeetingSessionId(null)
    setMeetingNoteId(null)
    setMeetingPanel(null)
    setTranscriptionEnabled(false)
    setTranscriptionMode('live')
    setTranscriptionNotice(null)
  }

  const handleToggleMeeting = async () => {
    if (!meetingActive) {
      const now = new Date()
      const title = `Meeting - ${now.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`

      if (TEMP_BYPASS_MEETING_BACKEND) {
        setMeetingNoteId(`local-meeting-${now.getTime()}`)
        setMeetingActive(true)
        setMeetingPaused(false)
        setActivePanel('main')
        setMeetingPanel('notepad')
        setMeetingSessionId(null)
        setTranscriptionEnabled(false)
        setTranscriptionMode('notes_only')
        setTranscriptionNotice(null)
        return
      }

      try {
        const created = await createNote(user?.id, { title, folderId: null })
        setMeetingNoteId(created.id)
        setMeetingActive(true)
        setMeetingPaused(false)
        setActivePanel('main')
        setMeetingPanel('notepad')
        setTranscriptionEnabled(true)
        setTranscriptionMode('live')
        setTranscriptionNotice(null)

        try {
          const sessionId = await startRecording(created.id)
          setMeetingSessionId(sessionId)
        } catch (recordingError) {
          console.error('Failed to start recording', recordingError)
          setMeetingSessionId(null)
          setTranscriptionEnabled(false)
          setTranscriptionMode('notes_only')
          setTranscriptionNotice(
            isQuotaError(recordingError instanceof Error ? recordingError : new Error('Failed to start recording'))
              ? 'Transcript unavailable: minutes exhausted. Notes continue.'
              : 'Transcript unavailable right now. Notes continue.',
          )
        }
      } catch (error) {
        console.error('Failed to start meeting', error)
      }
      return
    }

    const noteId = meetingNoteId
    await endMeeting()
    if (noteId) {
      window.dashboard?.open?.(noteId)
    }
  }

  const handleToggleMeetingPaused = () => {
    if (!meetingActive) return

    setMeetingPaused((current) => {
      const nextPaused = !current
      if (nextPaused) {
        setTranscriptionEnabled(false)
        setTranscriptionMode('notes_only')
        setTranscriptionNotice('Meeting paused. Notes continue.')
      } else {
        setTranscriptionNotice(null)
        if (TEMP_BYPASS_MEETING_BACKEND) {
          setTranscriptionMode('notes_only')
          setTranscriptionEnabled(false)
        } else {
          setTranscriptionMode('live')
          setTranscriptionEnabled(true)
        }
      }
      return nextPaused
    })
  }

  const handleOpenDashboard = () => {
    if (meetingActive) {
      setShowDashboardConfirm(true)
      return
    }
    window.dashboard?.open?.()
  }

  const handleConfirmOpenDashboard = async () => {
    setShowDashboardConfirm(false)
    const noteId = meetingNoteId
    await endMeeting()
    window.dashboard?.open?.(noteId ?? undefined)
  }

  return (
    <div className="overlay-root flex w-full select-none flex-col items-start justify-start">
      <div
        ref={contentRef}
        style={{
          maxHeight: MAX_APP_HEIGHT,
          width: isContentSizedLayout
            ? undefined
            : layoutKey === 'welcome'
              ? WELCOME_LAYOUT_WIDTH[welcomeLayout]
              : LAYOUT_WIDTH[layoutKey],
        }}
        className={cn(
          'flex flex-col gap-2 transition-[width] duration-200 ease-out',
          'p-0',
          isContentSizedLayout ? 'w-max' : '',
        )}
      >
        <Dialog
          open={showDashboardConfirm}
          overlayClassName="bg-transparent"
          onOpenChange={(open) => !open && setShowDashboardConfirm(false)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                End meeting and open dashboard?
              </DialogTitle>
              <DialogDescription>
                Opening the dashboard will end the active meeting.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 px-3 pb-1 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDashboardConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmOpenDashboard}
              >
                End meeting
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {user ? (
          <>
            <CompactOverlayBar
              onMouseDown={handleMouseDown}
              meetingActive={meetingActive}
              meetingPaused={meetingPaused}
              onToggleMeeting={() => void handleToggleMeeting()}
              onToggleMeetingPaused={handleToggleMeetingPaused}
              micMuted={micMuted}
              onToggleMicMuted={() => setMicMuted((v) => !v)}
              speakerMuted={speakerMuted}
              onToggleSpeakerMuted={() => setSpeakerMuted((v) => !v)}
              onOpenDashboard={handleOpenDashboard}
              settingsOpen={activePanel === 'settings'}
              compact={activePanel !== 'settings' && (!meetingActive || meetingPanel === null)}
              notepadOpen={meetingPanel === 'notepad' && activePanel !== 'settings'}
              activeMeetingTool={
                activePanel === 'settings'
                  ? null
                  : meetingPanel === 'transcript' || meetingPanel === 'insights' || meetingPanel === 'ask'
                    ? meetingPanel
                    : null
              }
              onToggleNotepad={() => toggleMeetingPanel('notepad')}
              onOpenTranscript={() => toggleMeetingPanel('transcript')}
              onOpenInsights={() => toggleMeetingPanel('insights')}
              onOpenAsk={() => toggleMeetingPanel('ask')}
              onToggleSettings={() =>
                setActivePanel((current) => (current === 'settings' ? 'main' : 'settings'))
              }
            />

            {shouldRenderSettingsPanel ? (
              <div
                className={cn(
                  PANEL_UNDER_PILL_CLASSNAME,
                  'origin-top transition-all duration-150 ease-out',
                  settingsPanelClosing
                    ? 'translate-y-[-4px] scale-[0.985] opacity-0'
                    : 'translate-y-0 scale-100 opacity-100',
                )}
              >
                <SettingsPanel onLogout={logout} />
              </div>
            ) : meetingActive && meetingNoteId && meetingPanel === 'notepad' ? (
              <div className={PANEL_UNDER_PILL_CLASSNAME}>
                <CompactMeetingPanel
                  ref={meetingPanelRef}
                  noteId={meetingNoteId}
                  userId={user.id}
                  transcriptSegments={transcriptSegments}
                  transcriptStatus={transcriptStatus}
                  transcriptionMode={transcriptionMode}
                  transcriptionNotice={transcriptionNotice}
                />
              </div>
            ) : meetingActive && meetingPanel === 'transcript' ? (
              <div className={PANEL_UNDER_PILL_CLASSNAME}>
                <div className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-white/80 p-1 text-sm text-neutral-700 shadow-sm ring-1 ring-neutral-900/5 backdrop-blur-md before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:bg-white/[0.35] dark:border-white/12 dark:bg-[#171417]/80 dark:text-white/80 dark:shadow-none dark:ring-white/8 dark:before:bg-white/[0.02]">
                  <div className="relative p-1">
                    <TranscriptPanel
                      segments={transcriptSegments}
                      status={
                        transcriptionMode === 'notes_only'
                          ? 'disabled'
                          : transcriptStatus === 'connected'
                            ? 'live'
                            : transcriptStatus === 'connecting'
                              ? 'paused'
                              : 'disabled'
                      }
                      isProcessing={transcriptionMode !== 'notes_only' && transcriptStatus === 'connecting'}
                      appearance="embedded"
                      className="min-h-[160px]"
                    />
                  </div>
                </div>
              </div>
            ) : meetingActive && meetingPanel === 'insights' ? (
              <div className={PANEL_UNDER_PILL_CLASSNAME}>
                <div className="rounded-lg border border-neutral-200 bg-white/80 px-2.5 py-2 text-sm text-neutral-700 shadow-sm backdrop-blur-md dark:border-white/12 dark:bg-[#171417]/80 dark:text-white/80 dark:shadow-none">
                  <div className="flex min-h-[120px] flex-col justify-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-4 dark:border-white/10 dark:bg-white/5">
                    <div className="text-sm font-semibold text-neutral-900 dark:text-white">Insights</div>
                    <p className="text-xs leading-relaxed text-neutral-500 dark:text-white/55">
                      Live meeting insights will appear here as questions, decisions, and follow-ups are detected.
                    </p>
                  </div>
                </div>
              </div>
            ) : meetingActive && meetingPanel === 'ask' ? (
              <div className={PANEL_UNDER_PILL_CLASSNAME}>
                <div className="rounded-lg border border-neutral-200 bg-white/80 px-2.5 py-2 text-sm text-neutral-700 shadow-sm backdrop-blur-md dark:border-white/12 dark:bg-[#171417]/80 dark:text-white/80 dark:shadow-none">
                  <div className="flex min-h-[120px] flex-col justify-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-4 dark:border-white/10 dark:bg-white/5">
                    <div className="text-sm font-semibold text-neutral-900 dark:text-white">Ask</div>
                    <p className="text-xs leading-relaxed text-neutral-500 dark:text-white/55">
                      Ask questions about the live meeting transcript and your notes.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <Welcome />
        )}
      </div>
    </div>
  )
}

function App() {
  return (
    <DesktopAuthRoot>
      <AppContent />
    </DesktopAuthRoot>
  )
}

export default App



