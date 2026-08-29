import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { CalendarDays, Check, ChevronDown, Folder, Loader2, FileText, RefreshCw, Sparkles, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownIconSlot,
  DropdownItem,
  DropdownLabel,
  DropdownPopover,
  DropdownSeparator,
} from '@/components/ui/dropdown-list'
import { InfoBanner } from '@/components/ui/info-banner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import SavedTranscriptView from '@/features/notes/SavedTranscriptView'
import MarkdownEditor from '@/features/notes/MarkdownEditor'
import { useDashboardNotes } from '@/features/notes/DashboardNotesContext'
import NoteAttendeesDropdown from '@/features/notes/NoteAttendeesDropdown'
import { FolderOptionsList } from '@/features/notes/FolderOptionsList'
import { useNoteTranscriptQuery } from '@/features/notes/queries/useNotesQueries'
import { useEnhanceNoteMutation, useLinkNoteEventMutation, useMoveNoteMutation, useUpdateNoteMutation } from '@/features/notes/queries/useNoteMutations'
import { useCalendarEventSearchQuery } from '@/features/calendar/useCalendarEventSearchQuery'
import { useDebouncedValue } from '@/lib/use-debounced-value'
import { reconcileCanonicalDraft } from '@/features/notes/draft-reconciliation'


type MeetingOption = {
  id: string
  title: string
  start: string
  color: string
}

type NoteEditorViewProps = {
  userId?: string
}

type NoteView = 'notes' | 'summary'

function NoteViewSwitch() {
  return (
    <TabsList className="note-view-tabs h-8 shrink-0 rounded-full border border-neutral-200 bg-neutral-100/80 p-0.5 text-neutral-500 shadow-none dark:border-white/10 dark:bg-white/5 dark:text-neutral-400">
      <TabsTrigger
        value="notes"
        className="h-full rounded-full px-3 py-0 text-xs shadow-none data-[state=active]:bg-white data-[state=active]:text-neutral-950 dark:data-[state=active]:border-0 dark:data-[state=active]:bg-white/12 dark:data-[state=active]:text-white"
      >
        Notes
      </TabsTrigger>
      <TabsTrigger
        value="summary"
        className="h-full rounded-full px-3 py-0 text-xs shadow-none data-[state=active]:bg-white data-[state=active]:text-neutral-950 dark:data-[state=active]:border-0 dark:data-[state=active]:bg-white/12 dark:data-[state=active]:text-white"
      >
        Summary
      </TabsTrigger>
    </TabsList>
  )
}

function NoteLoadingIndicator() {
  return (
    <div
      className="flex h-full min-h-40 items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <span>Loading note…</span>
      </div>
    </div>
  )
}

export default function NoteEditorView({
  userId,
}: NoteEditorViewProps) {
  const { folders, selectedId, selectedNote, selectedNoteLoading, selectNote } = useDashboardNotes()
  const { mutateAsync: updateNoteAsync } = useUpdateNoteMutation(userId ?? '')
  const { mutateAsync: moveNoteAsync } = useMoveNoteMutation(userId ?? '')
  const { mutateAsync: enhanceNoteAsync } = useEnhanceNoteMutation(userId ?? '')
  const { mutateAsync: linkNoteEventAsync } = useLinkNoteEventMutation(userId ?? '')

  const [draftTitle, setDraftTitle] = useState('')
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const folderPickerRef = useRef<HTMLDivElement | null>(null)
  const [draftFolderId, setDraftFolderId] = useState('')
  const [draftNote, setDraftNote] = useState('')
  const [hydratedNoteId, setHydratedNoteId] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<NoteView>('notes')
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | null>(null)

  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const transcriptQuery = useNoteTranscriptQuery(userId, selectedId, transcriptOpen)

  const [meetingPickerOpen, setMeetingPickerOpen] = useState(false)
  const meetingPickerRef = useRef<HTMLDivElement | null>(null)
  const meetingSearchRef = useRef<HTMLInputElement | null>(null)
  const [meetingSearch, setMeetingSearch] = useState('')
  const [linkingMeeting, setLinkingMeeting] = useState(false)
  const debouncedMeetingSearch = useDebouncedValue(meetingSearch, 300)
  const meetingResultsQuery = useCalendarEventSearchQuery(
    userId,
    selectedId,
    debouncedMeetingSearch,
    meetingPickerOpen,
  )
  const meetingResults = meetingResultsQuery.data ?? []
  const meetingResultsLoading = meetingResultsQuery.isLoading

  const titleSaveTimerRef = useRef<number | null>(null)
  const bodySaveTimerRef = useRef<number | null>(null)
  const canonicalTitleRef = useRef('')
  const canonicalBodyRef = useRef('')
  const lastLoadedIdRef = useRef<string | null>(null)

  // Hydrate drafts when selected note detail arrives from context
  useEffect(() => {
    if (!selectedNote) {
      lastLoadedIdRef.current = null
      setHydratedNoteId(null)
      setDraftTitle('')
      setDraftFolderId('')
      setDraftNote('')
      setTranscriptOpen(false)
      return
    }
    if (lastLoadedIdRef.current === selectedNote.id) return
    lastLoadedIdRef.current = selectedNote.id
    setDraftTitle(selectedNote.title)
    setDraftFolderId(selectedNote.folderId ?? '')
    setDraftNote(selectedNote.noteMarkdown)
    canonicalTitleRef.current = selectedNote.title
    canonicalBodyRef.current = selectedNote.noteMarkdown
    setMeetingSearch('')
    setEnhanceError(null)

    setHydratedNoteId(selectedNote.id)
  }, [selectedNote])

  useEffect(() => {
    setActiveView('notes')
  }, [selectedId])

  // Folder moves can also originate from the sidebar while this editor stays open.
  useEffect(() => {
    if (!selectedNote || selectedNote.id !== selectedId) return
    setDraftFolderId(selectedNote.folderId ?? '')
  }, [selectedId, selectedNote])

  // Reconcile canonical title changes without overwriting a dirty title draft.
  useEffect(() => {
    if (!selectedNote || selectedNote.id !== selectedId) return
    const nextTitle = reconcileCanonicalDraft(
      canonicalTitleRef.current,
      draftTitle,
      selectedNote.title,
    )
    if (nextTitle === null) return
    canonicalTitleRef.current = nextTitle
    setDraftTitle(nextTitle)
  }, [draftTitle, selectedId, selectedNote])

  // Reconcile canonical body changes (including chat/AI updates) without overwriting a dirty draft.
  useEffect(() => {
    if (!selectedNote || selectedNote.id !== selectedId) return
    const nextBody = reconcileCanonicalDraft(
      canonicalBodyRef.current,
      draftNote,
      selectedNote.noteMarkdown,
    )
    if (nextBody === null) return
    canonicalBodyRef.current = nextBody
    setDraftNote(nextBody)
  }, [draftNote, selectedId, selectedNote])

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

  const openMeetingPicker = () => {
    setMeetingSearch('')
    setMeetingPickerOpen(true)
    setTimeout(() => meetingSearchRef.current?.focus(), 0)
  }

  const handleMeetingSearchChange = (q: string) => {
    setMeetingSearch(q)
  }

  const selectedCalendarEventId = selectedNote?.calendarEventId ?? selectedNote?.linkedEvent?.id
  const linkedMeetingFromDetail: MeetingOption | null = selectedNote?.linkedEvent
    ? { id: selectedNote.linkedEvent.id, title: selectedNote.linkedEvent.title, start: selectedNote.linkedEvent.start, color: selectedNote.linkedEvent.color }
    : null
  const linkedMeeting = selectedCalendarEventId
    ? (meetingResults.find((m) => m.id === selectedCalendarEventId) ?? linkedMeetingFromDetail ?? null)
    : null
  const displayedMeetingResults =
    linkedMeeting && !meetingSearch.trim() && !meetingResults.some((m) => m.id === linkedMeeting.id)
      ? [linkedMeeting, ...meetingResults]
      : meetingResults

  const handleLinkMeeting = async (meeting: MeetingOption | null) => {
    if (!selectedId || linkingMeeting) return
    setLinkingMeeting(true)
    setMeetingPickerOpen(false)
    try {
      await linkNoteEventAsync({
        noteID: selectedId,
        eventID: meeting?.id ?? null,
      })
    } catch (err) {
      if (err instanceof Error && err.message === 'note not found') {
        selectNote(null)
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to link event')
      }
    } finally {
      setLinkingMeeting(false)
    }
  }

  // Title and body are independent drafts. Relationship changes use dedicated mutations.
  useEffect(() => {
    if (!selectedId) return
    if (lastLoadedIdRef.current !== selectedId) return
    if (draftTitle === canonicalTitleRef.current) return
    if (titleSaveTimerRef.current) window.clearTimeout(titleSaveTimerRef.current)
    const noteID = selectedId
    titleSaveTimerRef.current = window.setTimeout(() => {
      void updateNoteAsync({ noteID, patch: { title: draftTitle } })
        .then((note) => { if (note) canonicalTitleRef.current = note.title })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message === 'note not found') selectNote(null)
          else if (error instanceof Error && error.message === 'note has changed') toast.error('This note changed elsewhere. Your title draft was kept.')
        })
    }, 400)
    return () => {
      if (titleSaveTimerRef.current) window.clearTimeout(titleSaveTimerRef.current)
    }
  }, [draftTitle, selectNote, selectedId, updateNoteAsync])

  useEffect(() => {
    if (!selectedId) return
    if (lastLoadedIdRef.current !== selectedId) return
    if (draftNote === canonicalBodyRef.current) return
    if (bodySaveTimerRef.current) window.clearTimeout(bodySaveTimerRef.current)
    const noteID = selectedId
    bodySaveTimerRef.current = window.setTimeout(() => {
      void updateNoteAsync({ noteID, patch: { noteMarkdown: draftNote } })
        .then((note) => { if (note) canonicalBodyRef.current = note.noteMarkdown })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message === 'note not found') selectNote(null)
          else if (error instanceof Error && error.message === 'note has changed') toast.error('This note changed elsewhere. Your note draft was kept.')
        })
    }, 400)
    return () => {
      if (bodySaveTimerRef.current) window.clearTimeout(bodySaveTimerRef.current)
    }
  }, [draftNote, selectNote, selectedId, updateNoteAsync])

  const handleMoveNote = useCallback((folderID: string | null) => {
    if (!selectedId) return
    setDraftFolderId(folderID ?? '')
    setFolderPickerOpen(false)
    void moveNoteAsync({ noteID: selectedId, folderID }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Failed to move note')
    })
  }, [moveNoteAsync, selectedId])

  // Enhance: save version, overwrite note in-place
  const handleEnhance = useCallback(async () => {
    if (!selectedId) return
    setIsEnhancing(true)
    setEnhanceError(null)
    try {
      const { note } = await enhanceNoteAsync(selectedId)
      setDraftNote(note.noteMarkdown)
    } catch (error) {
      setEnhanceError(error instanceof Error ? error.message : 'Failed to enhance note')
    } finally {
      setIsEnhancing(false)
    }
  }, [enhanceNoteAsync, selectedId])

  const handleEditorEnhance = useCallback(() => {
    void handleEnhance()
  }, [handleEnhance])

  if (!selectedId) return null
  const noteIsLoading = selectedNoteLoading || hydratedNoteId !== selectedId

  return (
    <Tabs
      value={activeView}
      onValueChange={(value) => setActiveView(value === 'summary' ? 'summary' : 'notes')}
      className="h-full min-h-0 gap-0"
    >
      <div className="flex h-full min-h-0">

      {/* ── Main panel ── */}
      <div className="relative flex min-w-0 flex-1 flex-col rounded-lg border border-neutral-300/70 bg-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_18px_46px_-34px_rgba(15,23,42,0.5)] backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/80 dark:shadow-none">

        {/* Title row */}
        <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
          {noteIsLoading ? (
            <div className="flex h-8 w-full items-center gap-2" aria-hidden="true">
              <div className="h-3 w-28 animate-pulse rounded bg-neutral-200/80 dark:bg-white/10" />
              <div className="ml-auto h-8 w-24 animate-pulse rounded-full bg-neutral-200/70 dark:bg-white/8" />
              <div className="h-8 w-32 animate-pulse rounded-full bg-neutral-200/70 dark:bg-white/8" />
              <div className="h-8 w-24 animate-pulse rounded-full bg-neutral-200/70 dark:bg-white/8" />
            </div>
          ) : (
            <>
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
                <FolderOptionsList
                  folders={folders}
                  selectedFolderId={draftFolderId || null}
                  onSelect={handleMoveNote}
                />
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

          {/* Enhance */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={activeView === 'notes' ? handleEditorEnhance : undefined}
            disabled={activeView === 'summary' || isEnhancing || !draftNote.trim()}
            title={activeView === 'notes' ? 'Enhance note with AI' : 'Summary regeneration is not available yet'}
            className="h-8 rounded-full border-violet-500/25 bg-violet-500/10 px-3 text-violet-700 hover:border-violet-500/35 hover:bg-violet-500/15 hover:text-violet-800 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-200 dark:hover:border-violet-400/35 dark:hover:bg-violet-400/15 dark:hover:text-violet-100"
            style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          >
            {activeView === 'summary' ? (
              <RefreshCw className="h-3.5 w-3.5" />
            ) : isEnhancing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {activeView === 'summary' ? 'Regenerate' : 'Enhance'}
          </Button>

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
            </>
          )}
        </div>

        {enhanceError ? (
          <div className="m-2.5 rounded-lg border border-red-500/30 bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-200">
            {enhanceError}
          </div>
        ) : null}

        {/* Editor */}
        <div className="relative flex-1 min-h-0 overflow-hidden">
          {noteIsLoading ? (
            <NoteLoadingIndicator />
          ) : (
            <>
              <TabsContent value="notes" className="h-full min-h-0">
                <MarkdownEditor
              markdown={draftNote}
              onChange={setDraftNote}
              placeholder="Markdown notes…"
              theme="auto"
              showToolbar
              className="h-full dashboard-editor"
              noteId={selectedId}
              toolbarLeading={<NoteViewSwitch />}
            />
              </TabsContent>

              <TabsContent value="summary" className="h-full min-h-0">
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex min-h-[47px] shrink-0 items-start border-b border-neutral-200/80 bg-white p-[7px_8px] dark:border-white/10 dark:bg-[#171417]">
                    <NoteViewSwitch />
                  </div>
                  <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
                    <div className="max-w-xs">
                      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100 text-neutral-500 dark:border-white/10 dark:bg-white/5 dark:text-neutral-400">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">No summary yet</p>
                      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                        A summary generated from the transcript will appear here.
                      </p>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </>
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
              segments={transcriptQuery.data?.segments ?? []}
              loading={transcriptQuery.isLoading}
              theme="light"
            />
          </div>
        </div>
      </div>

      </div>
    </Tabs>
  )
}
