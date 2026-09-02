import MarkdownEditor from '@/features/notes/MarkdownEditor'

export default function RecordingOverlayNotepad({
  noteId,
  draft,
  onDraftChange,
}: {
  noteId: string
  draft: string
  onDraftChange: (draft: string) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 items-start px-3 pb-4 pt-2">
      <div className="h-full min-w-0 flex-1">
        <MarkdownEditor
          markdown={draft}
          onChange={onDraftChange}
          placeholder="Start writing..."
          theme="auto"
          className="recording-overlay-editor overlay-editor h-full min-h-0"
          noteId={noteId}
        />
      </div>
    </div>
  )
}
