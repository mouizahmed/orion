import { useDashboardNotes } from '@/features/notes/DashboardNotesContext'
import { CalendarView } from '@/features/calendar/CalendarView'
import HomeView from '@/features/home/HomeView'
import NoteEditorView from '@/features/notes/NoteEditorView'
import NotesLibraryView from '@/features/notes/NotesLibraryView'
import SettingsView from '@/features/settings/SettingsView'
import PeopleView from '@/features/people/PeopleView'
import GlobalChatView from '@/features/chat/global/GlobalChatView'
import type { DashboardSettingsSection } from '@/features/settings/settings-config'
import type { DashboardViewMode } from '@/features/dashboard/types'

type DashboardWorkspaceProps = {
  userId?: string
  mode?: DashboardViewMode
  selectedSettingsSection?: DashboardSettingsSection
  onOpenCalendar?: (eventId?: string) => void
  onOpenCalendarSettings?: () => void
  onOpenNotes?: () => void
  initialCalendarEventId?: string | null
}

function NotesLoadingView() {
  return (
    <div className="flex h-full min-h-0 gap-2">
      <div className="flex min-w-0 flex-1 flex-col rounded-lg border border-neutral-300/70 bg-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_18px_46px_-34px_rgba(15,23,42,0.5)] backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/80 dark:shadow-none">
        <div className="flex items-center gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
          <div className="h-4 w-48 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-4 w-20 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
        <div className="flex-1 space-y-3 p-5">
          <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
          <div className="h-3 w-full animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
          <div className="mt-6 h-3 w-full animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
        </div>
      </div>
    </div>
  )
}

export default function DashboardWorkspace({
  userId,
  mode = 'home',
  selectedSettingsSection = 'account',
  onOpenCalendar,
  onOpenCalendarSettings,
  onOpenNotes,
  initialCalendarEventId,
}: DashboardWorkspaceProps) {
  const { selectedId, isLoading } = useDashboardNotes()

  if (mode === 'settings') {
    return <div className="h-full"><SettingsView selectedSection={selectedSettingsSection} /></div>
  }

  if (mode === 'calendar') {
    return (
      <div className="h-full">
        <CalendarView
          onOpenCalendarSettings={onOpenCalendarSettings}
          onOpenNotes={onOpenNotes}
          initialSelectedEventId={initialCalendarEventId}
        />
      </div>
    )
  }

  if (mode === 'people') {
    return <div className="h-full"><PeopleView /></div>
  }

  if (mode === 'chat') {
    return <div className="h-full"><GlobalChatView /></div>
  }

  if (isLoading) return <NotesLoadingView />
  if (selectedId) return <NoteEditorView userId={userId} />
  if (mode === 'notes') return <NotesLibraryView />

  return <div className="h-full"><HomeView onOpenCalendar={onOpenCalendar} onOpenCalendarSettings={onOpenCalendarSettings} /></div>
}
