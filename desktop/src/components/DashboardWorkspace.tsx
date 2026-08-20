import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { CalendarDays, Check, ChevronDown, Folder, Loader2, FileText, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownIconSlot,
  DropdownItem,
  DropdownLabel,
  DropdownPopover,
  DropdownSeparator,
} from '@/components/ui/dropdown-list'
import { InfoBanner } from '@/components/ui/info-banner'
import { updateNote, enhanceNote, getNote } from '@/lib/notes-client'
import { toast } from 'sonner'
import { authenticatedFetch } from '@/lib/auth-session'
import { getTranscriptSegments, type TranscriptSegment } from '@/lib/transcript-client'
import SavedTranscriptView from '@/components/SavedTranscriptView'
import MarkdownEditor from '@/components/MarkdownEditor'
import { DashboardCalendar } from '@/components/DashboardCalendar'
import DashboardHome from '@/components/DashboardHome'
import DashboardSettingsPage, { type DashboardSettingsSection } from '@/components/DashboardSettingsPage'
import { useDashboardNotes } from '@/contexts/DashboardNotesContext'
import NoteAttendeesDropdown from '@/components/NoteAttendeesDropdown'
import { API_BASE_URL } from '@/lib/api-config'


type MeetingOption = {
  id: string
  title: string
  start: string
  color: string
}

type DashboardWorkspaceProps = {
  userId?: string
  mode?: 'notes' | 'calendar' | 'settings'
  selectedSettingsSection?: DashboardSettingsSection
  onOpenCalendar?: (eventId?: string) => void
  onOpenCalendarSettings?: () => void
  onOpenNotes?: () => void
  initialCalendarEventId?: string | null
}

export default function DashboardWorkspace({
  userId,
  mode = 'notes',
  selectedSettingsSection = 'account',
  onOpenCalendar,
  onOpenCalendarSettings,
  onOpenNotes,
  initialCalendarEventId,
}: DashboardWorkspaceProps) {
  const { folders, selectedId, selectedNote, selectedNoteLoading, noteSummariesById, optimisticPatch, replaceNote, evictNote, isLoading, addAttendee } = useDashboardNotes()

  const [draftTitle, setDraftTitle] = useState('')
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const folderPickerRef = useRef<HTMLDivElement | null>(null)
  const [draftFolderId, setDraftFolderId] = useState('')
  const [draftNote, setDraftNote] = useState('')
  const [hydratedNoteId, setHydratedNoteId] = useState<string | null>(null)
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | null>(null)

  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([])
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const transcriptLoadedForRef = useRef<string | null>(null)

  const [meetingPickerOpen, setMeetingPickerOpen] = useState(false)
  const meetingPickerRef = useRef<HTMLDivElement | null>(null)
  const meetingSearchRef = useRef<HTMLInputElement | null>(null)
  const meetingSearchTimerRef = useRef<number | null>(null)
  const linkedMeetingHydratedForRef = useRef<string | null>(null)
  const [meetingSearch, setMeetingSearch] = useState('')
  const [meetingResults, setMeetingResults] = useState<MeetingOption[]>([])
  const [selectedLinkedMeeting, setSelectedLinkedMeeting] = useState<MeetingOption | null>(null)
  const [meetingResultsLoading, setMeetingResultsLoading] = useState(false)
  const [linkingMeeting, setLinkingMeeting] = useState(false)

  const saveTimerRef = useRef<number | null>(null)
  const lastLoadedIdRef = useRef<string | null>(null)
  const isHydratingDraftsRef = useRef(false)
  const linkedMeetingCache = useRef<Map<string, MeetingOption | null>>(new Map())
  const selectedIdRef = useRef(selectedId)
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])

  // Hydrate drafts when selected note detail arrives from context
  useEffect(() => {
    if (!selectedNote) {
      lastLoadedIdRef.current = null
      isHydratingDraftsRef.current = false
      setHydratedNoteId(null)
      setDraftTitle('')
      setDraftFolderId('')
      setDraftNote('')
      setSelectedLinkedMeeting(null)
      setTranscriptOpen(false)
      return
    }
    if (lastLoadedIdRef.current === selectedNote.id) return
    lastLoadedIdRef.current = selectedNote.id
    isHydratingDraftsRef.current = true
    setDraftTitle(selectedNote.title)
    setDraftFolderId(selectedNote.folderId ?? '')
    setDraftNote(selectedNote.noteMarkdown)
    setMeetingResults([])
    setMeetingSearch('')
    setEnhanceError(null)

    if (selectedNote.linkedEvent) {
      const le = selectedNote.linkedEvent
      const option: MeetingOption = { id: le.id, title: le.title, start: le.start, color: le.color }
      linkedMeetingCache.current.set(selectedNote.id, option)
      setSelectedLinkedMeeting(option)
      linkedMeetingHydratedForRef.current = le.id
      setMeetingResults((prev) => {
        const exists = prev.some((m) => m.id === le.id)
        if (exists) return prev
        return [option, ...prev]
      })
    } else {
      linkedMeetingCache.current.set(selectedNote.id, null)
      setSelectedLinkedMeeting(null)
    }
    setHydratedNoteId(selectedNote.id)
  }, [selectedNote])

  // Sync AI-driven note edits into the local draft so the editor updates in real time
  useEffect(() => {
    const handler = (e: Event) => {
      const { noteId, content } = (e as CustomEvent<{ noteId: string; content: string }>).detail
      if (noteId === selectedId && content != null) {
        setDraftNote(content)
      }
    }
    window.addEventListener('note-updated-by-ai', handler)
    return () => window.removeEventListener('note-updated-by-ai', handler)
  }, [selectedId])

  // Close pickers on outside click / escape
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(event.target as Node)) {
        setFolderPickerOpen(false)
      }
      if (meetingPickerRef.current && !meetingPickerRef.current.contains(event.target as Node)) {
        setMeetingPickerOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFolderPickerOpen(false)
        setMeetingPickerOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const searchMeetings = useCallback(async (q: string) => {
    setMeetingResultsLoading(true)
    try {
      const url = new URL(`${API_BASE_URL}/calendar/events/search`)
      url.searchParams.set('limit', '20')
      if (q.trim()) url.searchParams.set('q', q.trim())
      if (selectedIdRef.current) url.searchParams.set('note_id', selectedIdRef.current)
      const res = await authenticatedFetch(url.toString(), {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) return
      const data = await res.json() as {
        status: string
        events?: Array<{
          id: string
          provider_id?: string
          connection_id?: string
          calendar_id?: string
          title: string
          start: string
          color?: string
          provider: string
        }>
      }
      if (data.status === 'success' && Array.isArray(data.events)) {
        setMeetingResults(data.events.map((e) => ({
          id: e.id,
          title: e.title || 'Untitled event',
          start: e.start,
          color: e.color ?? '#9f73f2',
        })))
      }
    } catch {
      // ignore
    } finally {
      setMeetingResultsLoading(false)
    }
  }, [])

  const openMeetingPicker = () => {
    setMeetingSearch('')
    setMeetingPickerOpen(true)
    void searchMeetings('')
    setTimeout(() => meetingSearchRef.current?.focus(), 0)
  }

  const handleMeetingSearchChange = (q: string) => {
    setMeetingSearch(q)
    if (meetingSearchTimerRef.current !== null) window.clearTimeout(meetingSearchTimerRef.current)
    meetingSearchTimerRef.current = window.setTimeout(() => {
      meetingSearchTimerRef.current = null
      void searchMeetings(q)
    }, 300)
  }

  const selectedCalendarEventId =
    selectedNote?.calendarEventId ??
    (selectedNoteLoading && selectedId ? noteSummariesById[selectedId]?.calendarEventId : undefined) ??
    selectedLinkedMeeting?.id
  const linkedMeetingFromDetail: MeetingOption | null = selectedNote?.linkedEvent
    ? { id: selectedNote.linkedEvent.id, title: selectedNote.linkedEvent.title, start: selectedNote.linkedEvent.start, color: selectedNote.linkedEvent.color }
    : null
  const linkedMeeting = selectedCalendarEventId
    ? (meetingResults.find((m) => m.id === selectedCalendarEventId) ?? selectedLinkedMeeting ?? linkedMeetingFromDetail ?? null)
    : null
  const displayedMeetingResults =
    linkedMeeting && !meetingSearch.trim() && !meetingResults.some((m) => m.id === linkedMeeting.id)
      ? [linkedMeeting, ...meetingResults]
      : meetingResults

  useEffect(() => {
    if (!selectedCalendarEventId) {
      linkedMeetingHydratedForRef.current = null
      return
    }
    if (linkedMeetingHydratedForRef.current === selectedCalendarEventId) return
    const alreadyLoaded = meetingResults.some((m) => m.id === selectedCalendarEventId)
    if (alreadyLoaded) {
      linkedMeetingHydratedForRef.current = selectedCalendarEventId
      return
    }
    linkedMeetingHydratedForRef.current = selectedCalendarEventId
    void searchMeetings('')
  }, [meetingResults, searchMeetings, selectedCalendarEventId])

  const handleLinkMeeting = async (meeting: MeetingOption | null) => {
    if (!selectedId || linkingMeeting) return
    setLinkingMeeting(true)
    setMeetingPickerOpen(false)
    try {
      const updated = await updateNote(userId, selectedId, {
        calendarEventId: meeting?.id ?? '',
      })
      if (updated) replaceNote(updated)
      if (meeting) {
        linkedMeetingCache.current.set(selectedId, meeting)
        setSelectedLinkedMeeting(meeting)
        const fullNote = await getNote(userId, selectedId)
        if (fullNote?.linkedEvent?.attendees) {
          for (const a of fullNote.linkedEvent.attendees) {
            if (a.email) await addAttendee(selectedId, a.email)
          }
        }
      } else {
        linkedMeetingCache.current.set(selectedId, null)
        setSelectedLinkedMeeting(null)
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'note not found') {
        evictNote(selectedId)
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to link event')
      }
    } finally {
      setLinkingMeeting(false)
    }
  }

  // Load transcript when sidebar opens
  useEffect(() => {
    if (!transcriptOpen || !selectedId) return
    if (transcriptLoadedForRef.current === selectedId) return
    transcriptLoadedForRef.current = selectedId
    setTranscriptLoading(true)
    void getTranscriptSegments(selectedId)
      .then(({ segments }) => { setTranscriptSegments(segments) })
      .catch(() => { setTranscriptSegments([]) })
      .finally(() => setTranscriptLoading(false))
  }, [transcriptOpen, selectedId])

  // Reset transcript when note changes
  useEffect(() => {
    transcriptLoadedForRef.current = null
    setTranscriptSegments([])
  }, [selectedId])

  // Auto-save with debounce
  const scheduleSave = useCallback(
    (patch: {
      title: string
      folderId?: string
      noteMarkdown: string
    }) => {
      if (!selectedId) return
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)

      optimisticPatch(selectedId, { title: patch.title, folderId: patch.folderId })

      saveTimerRef.current = window.setTimeout(() => {
        void updateNote(userId, selectedId, patch).then((updated) => {
          if (!updated) return
          replaceNote(updated)
        }).catch((err: unknown) => {
          if (err instanceof Error && err.message === 'note not found') evictNote(selectedId)
        })
      }, 400)
    },
    [optimisticPatch, replaceNote, selectedId, userId, evictNote],
  )

  // Trigger save on draft changes
  useEffect(() => {
    if (!selectedId) return
    if (lastLoadedIdRef.current !== selectedId) return
    if (isHydratingDraftsRef.current) {
      isHydratingDraftsRef.current = false
      return
    }
    scheduleSave({
      title: draftTitle,
      folderId: draftFolderId || '',
      noteMarkdown: draftNote,
    })
  }, [draftTitle, draftFolderId, draftNote, scheduleSave, selectedId])

  // Enhance: save version, overwrite note in-place
  const handleEnhance = useCallback(async () => {
    if (!selectedId) return
    setIsEnhancing(true)
    setEnhanceError(null)
    try {
      const { note } = await enhanceNote(selectedId)
      isHydratingDraftsRef.current = true
      setDraftNote(note.noteMarkdown)
      replaceNote(note)
    } catch (error) {
      setEnhanceError(error instanceof Error ? error.message : 'Failed to enhance note')
    } finally {
      setIsEnhancing(false)
    }
  }, [replaceNote, selectedId])

  const handleEditorEnhance = useCallback(() => {
    void handleEnhance()
  }, [handleEnhance])

  if (mode === 'settings') {
    return (
      <div className="h-full">
        <DashboardSettingsPage selectedSection={selectedSettingsSection} />
      </div>
    )
  }

  if (mode === 'calendar') {
    return (
      <div className="h-full">
        <DashboardCalendar
          onOpenCalendarSettings={onOpenCalendarSettings}
          onOpenNotes={onOpenNotes}
          initialSelectedEventId={initialCalendarEventId}
        />
      </div>
    )
  }

  if (isLoading) {
    return (
      // Skeleton matching the note editor layout
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

  if (!selectedId) {
    return (
      <div className="h-full">
        <DashboardHome onOpenCalendar={onOpenCalendar} onOpenCalendarSettings={onOpenCalendarSettings} />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0">

      {/* ── Main panel ── */}
      <div className="relative flex min-w-0 flex-1 flex-col rounded-lg border border-neutral-300/70 bg-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_18px_46px_-34px_rgba(15,23,42,0.5)] backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/80 dark:shadow-none">

        {/* Title row */}
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault()
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            placeholder="Untitled note"
            disabled={!selectedId}
            className="h-8 min-w-0 flex-1 truncate bg-transparent text-xs font-medium text-neutral-900 outline-none placeholder:text-neutral-400 dark:text-neutral-50 dark:placeholder:text-neutral-500"
          />
          <div ref={folderPickerRef} className="relative" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
            <Button
              type="button"
              variant="secondary"
              disabled={!selectedId}
              onClick={() => setFolderPickerOpen((v) => !v)}
              className="h-8 gap-1.5"
            >
              <Folder className="h-3.5 w-3.5" />
              <span>{draftFolderId ? (folders.find((f) => f.id === draftFolderId)?.name ?? 'Folder') : 'No folder'}</span>
            </Button>
            {folderPickerOpen && (
              <DropdownPopover width="md">
                <DropdownLabel>Add to folder</DropdownLabel>
                {[{ id: '', name: 'No folder' }, ...folders].map((f, i) => {
                  const active = (f.id === '' && !draftFolderId) || f.id === draftFolderId
                  return (
                    <Fragment key={f.id || '__none__'}>
                      {i === 1 && folders.length > 0 && (
                        <DropdownSeparator />
                      )}
                      <DropdownItem
                        onClick={() => { setDraftFolderId(f.id); setFolderPickerOpen(false) }}
                      >
                        <DropdownIconSlot>{active ? <Check className="h-3.5 w-3.5" /> : null}</DropdownIconSlot>
                        <Folder className="h-3.5 w-3.5 text-neutral-400 dark:text-neutral-500" />
                        {f.name}
                      </DropdownItem>
                    </Fragment>
                  )
                })}
              </DropdownPopover>
            )}
          </div>
          {/* Meeting link picker */}
          <div ref={meetingPickerRef} className="relative" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
            <Button
              type="button"
              variant="secondary"
              disabled={!selectedId || linkingMeeting}
              onClick={() => meetingPickerOpen ? setMeetingPickerOpen(false) : openMeetingPicker()}
              className="h-8 gap-1.5"
            >
              {selectedNoteLoading && selectedCalendarEventId && !linkedMeeting ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="max-w-[140px] truncate leading-4">
                {linkingMeeting
                  ? 'Saving…'
                  : selectedNoteLoading && selectedCalendarEventId && !linkedMeeting
                  ? 'Loading…'
                  : !selectedCalendarEventId
                  ? 'Select event'
                  : linkedMeeting
                  ? linkedMeeting.title
                  : meetingResults.length > 0 && !meetingResultsLoading
                  ? 'No longer linked'
                  : 'Linked to event'}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
            </Button>
            {meetingPickerOpen && (
              <DropdownPopover width="lg">
                <DropdownLabel>
                  <input
                    ref={meetingSearchRef}
                    value={meetingSearch}
                    onChange={(e) => handleMeetingSearchChange(e.target.value)}
                    placeholder="Search events…"
                    className="w-full bg-transparent outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
                  />
                </DropdownLabel>
                {selectedCalendarEventId && !meetingSearch ? (
                  <>
                    <DropdownSeparator />
                    <DropdownItem
                      onClick={() => void handleLinkMeeting(null)}
                    >
                      <DropdownIconSlot><X className="h-3.5 w-3.5" /></DropdownIconSlot>
                      Remove event link
                    </DropdownItem>
                  </>
                ) : null}
                <DropdownSeparator />
                {meetingResultsLoading ? (
                  <div className="flex items-center gap-2 px-4 py-2 text-xs text-neutral-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Searching…
                  </div>
                ) : displayedMeetingResults.length === 0 ? (
                  <div className="px-3 py-1.5 text-xs text-neutral-400 dark:text-neutral-500">
                    {meetingSearch.trim() ? 'No matching events' : 'No events found'}
                  </div>
                ) : (
                  <div className="max-h-56 overflow-y-auto sidebar-scrollbar">
                    {displayedMeetingResults.map((meeting) => {
                      const isLinked = selectedCalendarEventId === meeting.id
                      const date = new Date(meeting.start)
                      const dateLabel = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                      return (
                        <DropdownItem
                          key={meeting.id}
                          onClick={() => void handleLinkMeeting(meeting)}
                          layout="multiline"
                        >
                          <DropdownIconSlot>{isLinked ? <Check className="h-3.5 w-3.5" /> : null}</DropdownIconSlot>
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: meeting.color }} />
                          <span className="min-w-0 text-left">
                            <span className="block truncate leading-4">{meeting.title}</span>
                            <span className="block text-[11px] text-neutral-400 dark:text-neutral-500">{dateLabel}</span>
                          </span>
                        </DropdownItem>
                      )
                    })}
                  </div>
                )}
              </DropdownPopover>
            )}
          </div>

          {/* Attendees */}
          {selectedNote && (
            <NoteAttendeesDropdown note={selectedNote} />
          )}

          {/* Transcript toggle */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setTranscriptOpen((v) => !v)}
            title={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
            className={cn(
              'h-8 rounded-full px-3',
              transcriptOpen
                ? 'border-neutral-300/70 bg-neutral-200/80 text-neutral-950 hover:bg-neutral-200 dark:border-white/20 dark:bg-white/12 dark:text-white dark:hover:bg-white/16'
                : 'border-neutral-200 bg-white/70 text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:border-white/12 dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white',
            )}
            style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          >
            <FileText className="h-3.5 w-3.5" />
            Transcript
          </Button>
        </div>

        {enhanceError ? (
          <div className="m-2.5 rounded-lg border border-red-500/30 bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-200">
            {enhanceError}
          </div>
        ) : null}

        {/* Editor */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {selectedNoteLoading || hydratedNoteId !== selectedId ? (
            <div className="flex-1 space-y-3 p-5">
              <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
              <div className="h-3 w-full animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
              <div className="mt-6 h-3 w-full animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
            </div>
          ) : (
            <MarkdownEditor
              markdown={draftNote}
              onChange={setDraftNote}
              placeholder="Markdown notes…"
              theme="auto"
              showToolbar
              className="h-full dashboard-editor"
              noteId={selectedId}
              onEnhance={handleEditorEnhance}
              isEnhancing={isEnhancing}
              canEnhance={Boolean(draftNote.trim())}
            />
          )}
        </div>

      </div>

      {/* ── Transcript sidebar ── */}
      <div
        className={cn(
          'flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
          transcriptOpen ? 'w-[328px]' : 'w-0',
        )}
      >
        <div className="ml-2 flex h-full w-80 flex-col rounded-lg border border-neutral-300/70 bg-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_18px_46px_-34px_rgba(15,23,42,0.5)] backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/80 dark:shadow-none">
          <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-white/10">
            <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">Transcript</span>
            <button
              type="button"
              onClick={() => setTranscriptOpen(false)}
              className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2.5 sidebar-scrollbar">
            <InfoBanner className="mb-2">
              The transcript may show repeated sentences without headphones, but your final notes will be unaffected. For the best experience, use headphones.
            </InfoBanner>
            <SavedTranscriptView
              segments={transcriptSegments}
              loading={transcriptLoading}
              theme="light"
            />
          </div>
        </div>
      </div>

    </div>
  )
}
