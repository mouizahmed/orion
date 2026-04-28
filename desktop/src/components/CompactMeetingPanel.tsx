import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ForwardedRef } from 'react'
import { Loader2 } from 'lucide-react'

import MarkdownEditor, { type MarkdownEditorHandle } from '@/components/MarkdownEditor'
import { getNote, updateNote } from '@/lib/notes-client'
import type { NoteRecord } from '@/types/note'
import type { LiveTranscriptSegment } from '@/types/live-insight'

type TranscriptionStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'disconnected'
const LOCAL_MEETING_NOTE_PREFIX = 'local-meeting-'
const LOCAL_MEETING_NOTE_STORAGE_PREFIX = 'sunless:'

function getLocalMeetingNoteStorageKey(noteId: string) {
  return `${LOCAL_MEETING_NOTE_STORAGE_PREFIX}${noteId}`
}

function readLocalMeetingNote(noteId: string) {
  try {
    return window.localStorage.getItem(getLocalMeetingNoteStorageKey(noteId)) ?? ''
  } catch {
    return ''
  }
}

function writeLocalMeetingNote(noteId: string, markdown: string) {
  try {
    window.localStorage.setItem(getLocalMeetingNoteStorageKey(noteId), markdown)
  } catch {
    // Local fallback is best-effort; editing should continue even if storage is unavailable.
  }
}

type CompactMeetingPanelProps = {
  noteId: string
  userId?: string
  transcriptSegments?: LiveTranscriptSegment[]
  transcriptStatus?: TranscriptionStatus
  transcriptionMode?: 'live' | 'notes_only'
  transcriptionNotice?: string | null
}

export type CompactMeetingPanelHandle = {
  focusEditor: () => void
  blurEditor: () => void
  isEditorFocused: () => boolean
}

function CompactMeetingPanel({
  noteId,
  userId,
  transcriptSegments,
  transcriptStatus,
  transcriptionMode = 'live',
  transcriptionNotice = null,
}: CompactMeetingPanelProps, ref: ForwardedRef<CompactMeetingPanelHandle>) {
  const [note, setNote] = useState<NoteRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [draftNote, setDraftNote] = useState('')

  const saveTimerRef = useRef<number | null>(null)
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const lastLoadedIdRef = useRef<string | null>(null)
  const isHydratingDraftsRef = useRef(false)
  const isLocalMeetingNote = noteId.startsWith(LOCAL_MEETING_NOTE_PREFIX)

  const latestTranscriptText = useMemo(() => {
    if (!transcriptSegments?.length) return ''
    return transcriptSegments[transcriptSegments.length - 1]?.text?.trim() ?? ''
  }, [transcriptSegments])

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    if (isLocalMeetingNote) {
      setNote({
        id: noteId,
        title: 'Meeting notes',
        noteMarkdown: readLocalMeetingNote(noteId),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      setIsLoading(false)
      return
    }

    try {
      const loaded = await getNote(userId, noteId)
      setNote(loaded)
      if (!loaded) {
        setError('Note not found')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load note')
    } finally {
      setIsLoading(false)
    }
  }, [isLocalMeetingNote, noteId, userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!note) return
    if (lastLoadedIdRef.current === note.id) return
    lastLoadedIdRef.current = note.id
    isHydratingDraftsRef.current = true
    setDraftNote(note.noteMarkdown)
  }, [note])

  const scheduleSave = useCallback(
    (patch: { noteMarkdown: string }) => {
      if (!noteId) return

      if (isLocalMeetingNote) {
        writeLocalMeetingNote(noteId, patch.noteMarkdown)
        setNote((current) =>
          current
            ? {
                ...current,
                noteMarkdown: patch.noteMarkdown,
                updatedAt: Date.now(),
              }
            : current,
        )
        return
      }

      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)

      saveTimerRef.current = window.setTimeout(() => {
        void updateNote(userId, noteId, patch).then((updated) => {
          if (updated) setNote(updated)
        })
      }, 350)
    },
    [isLocalMeetingNote, noteId, userId],
  )

  useEffect(() => {
    if (!note) return
    if (!noteId) return
    if (isHydratingDraftsRef.current) {
      isHydratingDraftsRef.current = false
      return
    }

    scheduleSave({ noteMarkdown: draftNote })
  }, [draftNote, note, noteId, scheduleSave])

  const captionText =
    transcriptionNotice ||
    latestTranscriptText ||
    (transcriptionMode === 'live' ? 'Listening...' : 'Transcript paused')
  const showCaption = Boolean(transcriptionNotice || latestTranscriptText || transcriptionMode === 'live')

  useImperativeHandle(ref, () => ({
    focusEditor: () => {
      editorRef.current?.focus()
    },
    blurEditor: () => {
      editorRef.current?.blur()
    },
    isEditorFocused: () => Boolean(editorRef.current?.isFocused()),
  }), [])

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="flex h-10 items-center gap-2 rounded-full border border-white/12 bg-[#171417]/80 px-4 text-sm text-white/70 backdrop-blur-md">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading...
        </div>
      )
    }

    if (error) {
      return (
        <div className="rounded-full border border-red-400/20 bg-red-500/20 px-4 py-2 text-sm text-red-50">
          {error}
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-2">
        <div className="h-[220px] overflow-hidden rounded-xl border border-white/12 bg-[#0f0d10]/72 p-1 backdrop-blur-md">
          <MarkdownEditor
            ref={editorRef}
            markdown={draftNote}
            onChange={setDraftNote}
            placeholder="Write notes in Markdown..."
            theme="dark"
            className="overlay-editor h-full min-h-0"
            noteId={noteId}
          />
        </div>

        {showCaption ? (
          <div className="flex min-h-8 items-center gap-2 rounded-full border border-white/12 bg-[#171417]/80 px-3 text-xs text-white/70 backdrop-blur-md">
            <span
              className={[
                'h-1.5 w-1.5 shrink-0 rounded-full',
                transcriptStatus === 'connected' && transcriptionMode === 'live'
                  ? 'bg-emerald-300'
                  : 'bg-white/35',
              ].join(' ')}
            />
            <span className="truncate">{captionText}</span>
          </div>
        ) : null}
      </div>
    )
  }, [
    captionText,
    draftNote,
    error,
    isLoading,
    noteId,
    showCaption,
    transcriptStatus,
    transcriptionMode,
  ])

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="relative overflow-hidden rounded-2xl border border-white/12 bg-[#171417]/80 p-1 text-white/80 ring-1 ring-white/8 backdrop-blur-md before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:bg-white/[0.02]">
        <div className="relative">
          {content}
        </div>
      </div>
    </div>
  )
}

export default forwardRef(CompactMeetingPanel)

