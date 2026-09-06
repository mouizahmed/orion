import React, { useState } from 'react'
import { Plus, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import DashboardSearchDialog from '@/features/dashboard/DashboardSearchDialog'
import { useWindowState } from '@/features/dashboard/useWindowState'
import { useDashboardNotes } from '@/features/notes/DashboardNotesContext'
import { desktopApi } from '@/lib/desktop-api'
import { useAuth } from '@/features/auth/AuthContext'
import { useNoteQuery } from '@/features/notes/queries/useNotesQueries'
import { useCalendarSyncMutation } from '@/features/calendar/useCalendarSyncMutation'
import { useDashboardRecordingSession } from '@/features/recording/DashboardRecordingContext'
import RecordingStatusPill from '@/features/recording/components/RecordingStatusPill'
import type { DashboardViewMode } from '@/features/dashboard/types'

export default function DashboardTopBar({
  mode,
  onOpenNotes,
}: {
  mode: DashboardViewMode
  onOpenNotes?: () => void
}) {
  const isMacOS = desktopApi.platform.current() === 'darwin'
  const { isCompact, setOpen: setNavigationOpen, setCompactPanel } = useSidebar()
  const { user } = useAuth()
  const { isMaximized } = useWindowState()
  const { folders, refresh, selectedId, selectFolder, selectNote, createNewNote } = useDashboardNotes()
  const { session: recordingSession, hasPendingDraft } = useDashboardRecordingSession()
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isStartingRecording, setIsStartingRecording] = useState(false)
  const calendarSyncMutation = useCalendarSyncMutation(user?.id)
  const activeRecording = recordingSession?.phase !== 'complete' ? recordingSession : null
  const activeRecordingNoteQuery = useNoteQuery(user?.id, activeRecording?.noteId ?? null)
  const activeRecordingDisplay = activeRecording && activeRecordingNoteQuery.data
    ? { ...activeRecording, noteTitle: activeRecordingNoteQuery.data.title }
    : activeRecording
  const noteEditorVisible = !['settings', 'chat'].includes(mode) && Boolean(selectedId)
  const activeRecordingNoteVisible = noteEditorVisible && selectedId === activeRecording?.noteId

  const closeCompactOverlay = () => {
    if (!isCompact) return
    setNavigationOpen(false)
    setCompactPanel(null)
  }

  const handleRefresh = async () => {
    if (isRefreshing || calendarSyncMutation.isPending) return
    setIsRefreshing(true)
    try {
      await refresh()
      await calendarSyncMutation.mutateAsync()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to refresh dashboard')
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleStartRecording = async () => {
    if (activeRecording || hasPendingDraft || isStartingRecording) return
    setIsStartingRecording(true)
    let createdNoteId: string | null = null
    try {
      const note = await createNewNote({ title: 'New note' }, { select: false })
      if (!note) throw new Error('Could not create a note for this recording')
      createdNoteId = note.id
      await desktopApi.recording.start({
        noteId: note.id,
        noteTitle: note.title,
        noteMarkdown: note.noteMarkdown,
      })
      // Main hides the dashboard before resolving start. Select the recording
      // note now so its editor can synchronize and autosave while hidden without
      // flashing the note page before the overlay appears.
      onOpenNotes?.()
      selectNote(note.id)
    } catch (error) {
      // Creation succeeded but overlay startup did not. Open the note so the user
      // can recover it instead of leaving an apparently missing empty note.
      if (createdNoteId) {
        onOpenNotes?.()
        selectNote(createdNoteId)
      }
      toast.error(error instanceof Error ? error.message : 'Could not start recording')
    } finally {
      setIsStartingRecording(false)
    }
  }

  return (
    <div
      className="relative flex h-12 w-full min-w-0 items-center gap-1.5 px-2 text-xs"
      style={
        {
          paddingLeft: isMacOS && !isMaximized ? '80px' : undefined,
          paddingRight: !isMacOS ? '140px' : undefined,
        } as React.CSSProperties
      }
    >
      <div
        className="absolute bottom-0 left-0 top-0 z-0"
        style={
          {
            right: isMacOS ? '0px' : '140px',
            WebkitAppRegion: 'drag',
          } as React.CSSProperties
        }
      />
      <div className="relative z-10 flex min-w-0 items-center gap-1.5">
        <SidebarTrigger />

        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => {
            closeCompactOverlay()
            setIsSearchOpen(true)
          }}
          aria-label="Search"
          title="Search"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Search size={15} />
        </Button>
      </div>

      <DashboardSearchDialog
        open={isSearchOpen}
        onOpenChange={setIsSearchOpen}
        accountId={user?.id}
        folders={folders}
        onSelectFolder={(folderId) => {
          onOpenNotes?.()
          selectNote(null)
          selectFolder(folderId)
        }}
        onSelectNote={(noteId, folderId) => {
          onOpenNotes?.()
          selectNote(noteId)
          selectFolder(folderId)
        }}
      />

      <div className="relative z-10 flex shrink-0 items-center gap-1.5">
        {activeRecordingDisplay && !activeRecordingNoteVisible ? (
          <RecordingStatusPill
            session={activeRecordingDisplay}
            onClick={() => {
              closeCompactOverlay()
              onOpenNotes?.()
              selectNote(activeRecordingDisplay.noteId)
            }}
            onStop={() => {
              void desktopApi.recording.stop().catch((error) => {
                toast.error(error instanceof Error ? error.message : 'Could not stop recording')
              })
            }}
          />
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 rounded-full"
          onClick={() => {
            closeCompactOverlay()
            void handleRefresh()
          }}
          disabled={isRefreshing || calendarSyncMutation.isPending}
          aria-busy={isRefreshing || calendarSyncMutation.isPending}
          aria-label="Refresh dashboard"
          title="Refresh dashboard"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <RefreshCw
            size={14}
            className={isRefreshing || calendarSyncMutation.isPending ? 'animate-spin' : undefined}
          />
        </Button>
        <Button
          type="button"
          variant="default"
          size="sm"
          className="h-8 rounded-full"
          disabled={Boolean(activeRecording) || hasPendingDraft || isStartingRecording}
          onClick={() => {
            closeCompactOverlay()
            void handleStartRecording()
          }}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Plus size={14} />
          {isStartingRecording ? 'Starting...' : 'New Note'}
        </Button>
      </div>
    </div>
  )
}
