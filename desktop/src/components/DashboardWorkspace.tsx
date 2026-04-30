import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { Check, Folder, Loader2, Sparkles, FileText, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InfoBanner } from '@/components/ui/info-banner'
import { updateNote, enhanceNote } from '@/lib/notes-client'
import { getTranscriptSegments, type TranscriptSegment } from '@/lib/transcript-client'
import SavedTranscriptView from '@/components/SavedTranscriptView'
import MarkdownEditor from '@/components/MarkdownEditor'
import { DashboardCalendar } from '@/components/DashboardCalendar'
import DashboardHome from '@/components/DashboardHome'
import DashboardSettingsPage, { type DashboardSettingsSection } from '@/components/DashboardSettingsPage'
import { useDashboardNotes } from '@/contexts/DashboardNotesContext'

type DashboardWorkspaceProps = {
  userId?: string
  mode?: 'notes' | 'calendar' | 'settings'
  selectedSettingsSection?: DashboardSettingsSection
  onOpenCalendar?: () => void
}

export default function DashboardWorkspace({
  userId,
  mode = 'notes',
  selectedSettingsSection = 'account',
  onOpenCalendar,
}: DashboardWorkspaceProps) {
  const { folders, selectedId, selected, optimisticPatch, replaceNote, isLoading } = useDashboardNotes()

  const [draftTitle, setDraftTitle] = useState('')
  const [folderPickerOpen, setFolderPickerOpen] = useState(false)
  const folderPickerRef = useRef<HTMLDivElement | null>(null)
  const [draftFolderId, setDraftFolderId] = useState('')
  const [draftNote, setDraftNote] = useState('')

  const [isEnhancing, setIsEnhancing] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | null>(null)

  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([])
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const transcriptLoadedForRef = useRef<string | null>(null)

  const saveTimerRef = useRef<number | null>(null)
  const lastLoadedIdRef = useRef<string | null>(null)
  const isHydratingDraftsRef = useRef(false)

  // Hydrate drafts when a note is selected
  useEffect(() => {
    if (!selected) {
      lastLoadedIdRef.current = null
      isHydratingDraftsRef.current = false
      setDraftTitle('')
      setDraftFolderId('')
      setDraftNote('')
      setTranscriptOpen(false)
      return
    }
    if (lastLoadedIdRef.current === selected.id) return
    lastLoadedIdRef.current = selected.id
    isHydratingDraftsRef.current = true
    setDraftTitle(selected.title)
    setDraftFolderId(selected.folderId ?? '')
    setDraftNote(selected.noteMarkdown)
    setEnhanceError(null)
  }, [selected])

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

  // Close folder picker on outside click / escape
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (folderPickerRef.current && !folderPickerRef.current.contains(event.target as Node)) {
        setFolderPickerOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFolderPickerOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

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

      optimisticPatch(selectedId, patch)

      saveTimerRef.current = window.setTimeout(() => {
        void updateNote(userId, selectedId, patch).then((updated) => {
          if (!updated) return
          replaceNote(updated)
        })
      }, 400)
    },
    [optimisticPatch, replaceNote, selectedId, userId],
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
        <DashboardCalendar />
      </div>
    )
  }

  if (isLoading) {
    const hasSavedNote = Boolean(localStorage.getItem('dashboard:selectedNoteId'))
    return hasSavedNote ? (
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
    ) : (
      <div className="h-full">
        <DashboardHome onOpenCalendar={onOpenCalendar} />
      </div>
    )
  }

  if (!selectedId) {
    return (
      <div className="h-full">
        <DashboardHome onOpenCalendar={onOpenCalendar} />
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
              <div className="absolute right-0 top-[calc(100%+4px)] z-30 min-w-[160px] rounded-lg border border-neutral-200 bg-white/95 py-1 text-neutral-900 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-[#171417]/95 dark:text-neutral-100">
                <div className="px-3 py-1.5 text-xs text-neutral-400 dark:text-neutral-500">Add to folder</div>
                {[{ id: '', name: 'No folder' }, ...folders].map((f, i) => {
                  const active = (f.id === '' && !draftFolderId) || f.id === draftFolderId
                  return (
                    <Fragment key={f.id || '__none__'}>
                      {i === 1 && folders.length > 0 && (
                        <div className="my-1 border-t border-neutral-200 dark:border-white/10" />
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => { setDraftFolderId(f.id); setFolderPickerOpen(false) }}
                        className="mx-1 h-8 w-[calc(100%-8px)] justify-start gap-2 rounded-full px-3 text-xs font-normal"
                      >
                        <span className="w-3.5">{active ? <Check className="h-3.5 w-3.5" /> : null}</span>
                        <Folder className="h-3.5 w-3.5 text-neutral-400 dark:text-neutral-500" />
                        {f.name}
                      </Button>
                    </Fragment>
                  )
                })}
              </div>
            )}
          </div>
          {/* Enhance button */}
          <button
            type="button"
            onClick={() => void handleEnhance()}
            disabled={isEnhancing || !draftNote.trim()}
            title="Enhance note with AI"
            className="flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          >
            {isEnhancing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Enhance
          </button>

          {/* Transcript toggle */}
          <button
            type="button"
            onClick={() => setTranscriptOpen((v) => !v)}
            title={transcriptOpen ? 'Hide transcript' : 'Show transcript'}
            className={
              transcriptOpen
                ? 'flex items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-200 px-3 py-1 text-xs font-medium text-neutral-950 dark:border-white/12 dark:bg-white/12 dark:text-white'
                : 'flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white/70 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:border-white/12 dark:bg-white/5 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white'
            }
            style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          >
            <FileText className="h-3 w-3" />
            Transcript
          </button>
        </div>

        {enhanceError ? (
          <div className="m-2.5 rounded-lg border border-red-500/30 bg-red-50 p-2.5 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-200">
            {enhanceError}
          </div>
        ) : null}

        {/* Editor */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <MarkdownEditor
            markdown={draftNote}
            onChange={setDraftNote}
            placeholder="Markdown notes…"
            theme="auto"
            showToolbar
            className="h-full dashboard-editor"
            noteId={selectedId}
          />
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
