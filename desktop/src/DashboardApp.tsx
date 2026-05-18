import { DashboardAuthRoot, useAuth } from '@/contexts/AuthContext'
import { ChatProvider } from '@/contexts/ChatContext'
import DashboardWorkspace from '@/components/DashboardWorkspace'
import DashboardTopBar from '@/components/DashboardTopBar'
import DashboardSidebar from '@/components/DashboardSidebar'
import type { DashboardSettingsSection } from '@/components/DashboardSettingsPage'
import { SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { DashboardNotesProvider } from '@/contexts/DashboardNotesContext'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDashboardNotes } from '@/contexts/DashboardNotesContext'
import { desktopApi } from '@/lib/desktop-api'
import { Toaster } from 'sonner'


function useDashboardNoteIdFromUrl() {
  return useMemo(() => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    const noteId = params.get('noteId')
    return noteId && noteId.trim() ? noteId.trim() : null
  }, [])
}

function DashboardNoteSelector({ initialNoteId }: { initialNoteId: string | null }) {
  const { noteSummariesById, selectNote } = useDashboardNotes()
  const initialAppliedRef = useRef(false)

  useEffect(() => {
    if (initialAppliedRef.current) return
    if (!initialNoteId) return
    const exists = initialNoteId in noteSummariesById
    if (exists) {
      selectNote(initialNoteId)
      initialAppliedRef.current = true
      // Clear noteId from URL so a page refresh starts at home
      const url = new URL(window.location.href)
      url.searchParams.delete('noteId')
      window.history.replaceState(null, '', url.toString())
    }
  }, [initialNoteId, noteSummariesById, selectNote])

  useEffect(() => {
    const unsubscribe = desktopApi.dashboard.onSelectNote((payload) => {
      const noteId = typeof payload?.noteId === 'string' ? payload.noteId : ''
      if (!noteId) return
      selectNote(noteId)
    })

    return () => {
      unsubscribe()
    }
  }, [selectNote])

  return null
}

function DashboardContent() {
  const { user, isLoading } = useAuth()
  const { isOpen } = useSidebar()
  const initialNoteId = useDashboardNoteIdFromUrl()
  const [viewMode, setViewMode] = useState<'notes' | 'calendar' | 'settings'>('notes')
  const [settingsSection, setSettingsSection] = useState<DashboardSettingsSection>('account')
  const [pendingCalendarEventId, setPendingCalendarEventId] = useState<string | null>(null)

  const handleOpenCalendar = useCallback((eventId?: string) => {
    setViewMode('calendar')
    setPendingCalendarEventId(eventId ?? null)
  }, [])

  useEffect(() => {
    if (viewMode !== 'calendar') {
      setPendingCalendarEventId(null)
    }
  }, [viewMode])

  useEffect(() => {
    if (!isLoading && !user) {
      desktopApi.dashboard.close()
    }
  }, [isLoading, user])

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#0f0d10] text-sm text-neutral-400">
        Opening dashboard...
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#0f0d10] text-sm text-neutral-400">
        Returning to sign in...
      </div>
    )
  }

  return (
    <DashboardNotesProvider userId={user.id}>
      <DashboardNoteSelector initialNoteId={initialNoteId} />
      <div className="dashboard-root h-screen w-full bg-[#eef1ee] text-neutral-900 dark:bg-[#0f0d10] dark:text-neutral-100">
        <div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
          <DashboardTopBar onBackToOverlay={() => desktopApi.dashboard.close()} />

          <div className={`flex h-full min-h-0 px-2 pb-2 ${isOpen ? 'gap-2' : ''}`}>
            <DashboardSidebar
              mode={viewMode}
              selectedSettingsSection={settingsSection}
              onOpenHome={() => setViewMode('notes')}
              onOpenCalendar={handleOpenCalendar}
              onOpenSettings={() => setViewMode((current) => (current === 'settings' ? 'notes' : 'settings'))}
              onCloseSettings={() => setViewMode('notes')}
              onSelectSettingsSection={setSettingsSection}
            />
            <div className="flex-1 min-h-0 min-w-0 overflow-hidden select-none">
              <DashboardWorkspace
                userId={user.id}
                mode={viewMode}
                selectedSettingsSection={settingsSection}
                onOpenCalendar={handleOpenCalendar}
                onOpenCalendarSettings={() => {
                  setSettingsSection('calendar')
                  setViewMode('settings')
                }}
                onOpenNotes={() => setViewMode('notes')}
                initialCalendarEventId={pendingCalendarEventId}
              />
            </div>
          </div>
        </div>
      </div>
      {/* {viewMode === 'notes' ? <ChatWidget variant="dashboard" /> : null} */}
    </DashboardNotesProvider>
  )
}

export default function DashboardApp() {
  return (
    <DashboardAuthRoot>
      <ChatProvider>
        <SidebarProvider defaultOpen={true}>
          <DashboardContent />
        </SidebarProvider>
      </ChatProvider>
      <Toaster
        position="bottom-center"
        theme="system"
        toastOptions={{
          style: {
            borderRadius: '10px',
            fontSize: '13px',
          },
        }}
      />
    </DashboardAuthRoot>
  )
}
