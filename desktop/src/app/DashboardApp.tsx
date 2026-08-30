import { useAuth } from '@/features/auth/AuthContext'
import DashboardWorkspace from '@/features/dashboard/DashboardWorkspace'
import DashboardTopBar from '@/features/dashboard/DashboardTopBar'
import DashboardSidebar from '@/features/dashboard/DashboardSidebar'
import type { DashboardViewMode } from '@/features/dashboard/types'
import type { DashboardSettingsSection } from '@/features/settings/settings-config'
import { useSidebar } from '@/components/ui/sidebar'
import { DashboardNotesProvider } from '@/features/notes/DashboardNotesContext'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDashboardNotes } from '@/features/notes/DashboardNotesContext'
import { desktopApi } from '@/lib/desktop-api'
import { DashboardProviders } from '@/app/providers/DashboardProviders'


function useDashboardNoteIdFromUrl() {
  return useMemo(() => {
    if (typeof window === 'undefined') return null
    const params = new URLSearchParams(window.location.search)
    const noteId = params.get('noteId')
    return noteId && noteId.trim() ? noteId.trim() : null
  }, [])
}

function DashboardNoteSelector({ initialNoteId }: { initialNoteId: string | null }) {
  const { selectNote } = useDashboardNotes()
  const initialAppliedRef = useRef(false)

  useEffect(() => {
    if (initialAppliedRef.current) return
    if (!initialNoteId) return
    selectNote(initialNoteId)
    initialAppliedRef.current = true
    // Clear noteId from URL so a page refresh starts at home
    const url = new URL(window.location.href)
    url.searchParams.delete('noteId')
    window.history.replaceState(null, '', url.toString())
  }, [initialNoteId, selectNote])

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
  const [viewMode, setViewMode] = useState<DashboardViewMode>('home')
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
          <DashboardTopBar
            onBackToOverlay={() => desktopApi.dashboard.close()}
            onOpenNotes={() => setViewMode('notes')}
          />

          <div className={`flex h-full min-h-0 px-2 pb-2 ${isOpen ? 'gap-2' : ''}`}>
            <DashboardSidebar
              mode={viewMode}
              selectedSettingsSection={settingsSection}
              onOpenHome={() => setViewMode('home')}
              onOpenNotes={() => setViewMode('notes')}
              onOpenCalendar={handleOpenCalendar}
              onOpenPeople={() => setViewMode('people')}
              onOpenChat={() => setViewMode('chat')}
              onOpenSettings={() => setViewMode((current) => (current === 'settings' ? 'home' : 'settings'))}
              onCloseSettings={() => setViewMode('home')}
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
    </DashboardNotesProvider>
  )
}

export default function DashboardApp() {
  return (
    <DashboardProviders>
      <DashboardContent />
    </DashboardProviders>
  )
}
