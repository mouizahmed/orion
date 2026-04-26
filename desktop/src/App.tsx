import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import CompactOverlayBar from '@/components/CompactOverlayBar'
import CompactMeetingPanel from '@/components/CompactMeetingPanel'
import SettingsPanel from '@/components/SettingsPanel'
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

const LAYOUT_WIDTH: Record<'welcome' | 'settings' | 'compact' | 'compactMeeting', number> = {
  welcome: 640,
  settings: 640,
  compact: 640,
  compactMeeting: 640,
}

function AppContent() {
  const { user, isLoading, logout, logoutEverywhere } = useAuth()
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [activePanel, setActivePanel] = useState<'main' | 'settings'>('main')
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null)
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    setContentEl(node)
  }, [])

  const [meetingActive, setMeetingActive] = useState(false)
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
    if (user) {
      setActivePanel('main')
    }
  }, [user])

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

  const layoutKey: 'welcome' | 'settings' | 'compact' | 'compactMeeting' = useMemo(() => {
    if (!user) return 'welcome'
    if (activePanel === 'settings' || settingsPanelMounted) return 'settings'
    return meetingActive ? 'compactMeeting' : 'compact'
  }, [activePanel, meetingActive, settingsPanelMounted, user])

  const shouldRenderSettingsPanel = activePanel === 'settings' || settingsPanelMounted

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
      const contentHeight = Math.min(contentEl.scrollHeight, MAX_APP_HEIGHT)
      const height = contentHeight + WINDOW_VERTICAL_PADDING
      const width = LAYOUT_WIDTH[layoutKey] + WINDOW_HORIZONTAL_PADDING
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
  }, [contentEl, layoutKey])

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
    setMeetingSessionId(null)
    setMeetingNoteId(null)
    setTranscriptionEnabled(false)
    setTranscriptionMode('live')
    setTranscriptionNotice(null)
  }

  const resumeTranscription = () => {
    if (!meetingActive) return
    setTranscriptionMode('live')
    setTranscriptionNotice(null)
    setTranscriptionEnabled(true)
  }

  const handleToggleMeeting = async () => {
    if (!meetingActive) {
      const now = new Date()
      const title = `Meeting - ${now.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
      try {
        const created = await createNote(user?.id, { title, folderId: null })
        setMeetingNoteId(created.id)
        setMeetingActive(true)
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
    <div className="flex w-full flex-col items-center justify-center">
      <div
        ref={contentRef}
        style={{ maxHeight: MAX_APP_HEIGHT, width: LAYOUT_WIDTH[layoutKey] }}
        className="flex flex-col gap-2 p-2"
      >
        <Dialog
          open={showDashboardConfirm}
          overlayClassName="bg-transparent"
          onOpenChange={(open) => !open && setShowDashboardConfirm(false)}
        >
          <DialogContent className="sm:max-w-md bg-black/80 dark:bg-black/80 border-white/10">
            <DialogHeader>
              <DialogTitle className="text-neutral-900 dark:text-neutral-100">
                End meeting and open dashboard?
              </DialogTitle>
              <DialogDescription className="text-neutral-600 dark:text-neutral-400">
                Opening the dashboard will end the active meeting.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDashboardConfirm(false)}
                className="h-8 px-3 text-xs border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmOpenDashboard}
                className="h-8 px-3 text-xs bg-violet-600 hover:bg-violet-700 text-white"
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
              onToggleMeeting={() => void handleToggleMeeting()}
              micMuted={micMuted}
              onToggleMicMuted={() => setMicMuted((v) => !v)}
              speakerMuted={speakerMuted}
              onToggleSpeakerMuted={() => setSpeakerMuted((v) => !v)}
              onOpenDashboard={handleOpenDashboard}
              settingsOpen={activePanel === 'settings'}
              onToggleSettings={() =>
                setActivePanel((current) => (current === 'settings' ? 'main' : 'settings'))
              }
            />

            {shouldRenderSettingsPanel ? (
              <div
                className={cn(
                  'origin-top transition-all duration-150 ease-out',
                  settingsPanelClosing
                    ? 'translate-y-[-4px] scale-[0.985] opacity-0'
                    : 'translate-y-0 scale-100 opacity-100',
                )}
              >
                <SettingsPanel
                  onLogout={logout}
                  onLogoutEverywhere={logoutEverywhere}
                />
              </div>
            ) : meetingActive && meetingNoteId ? (
              <CompactMeetingPanel
                noteId={meetingNoteId}
                userId={user.id}
                transcriptSegments={transcriptSegments}
                transcriptStatus={transcriptStatus}
                transcriptionMode={transcriptionMode}
                transcriptionNotice={transcriptionNotice}
                onResumeTranscription={resumeTranscription}
              />
            ) : null}
          </>
        ) : (
          <Welcome onMouseDown={handleMouseDown} />
        )}
      </div>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App


