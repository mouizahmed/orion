import { Button } from '@/components/ui/button'
import type { MeetingArtifactsResult } from '@/features/notes/api/meeting-artifacts-client'
import { MeetingArtifactsContent } from '@/features/notes/NoteMeetingArtifactsReview'

export default function NoteMeetingArtifactsSummary({
  result,
  onInsert,
}: {
  result: MeetingArtifactsResult
  onInsert: (result: MeetingArtifactsResult) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 sidebar-scrollbar">
      <div className="mx-auto max-w-2xl pb-8">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Generated meeting notes</h2>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              Provisional until explicitly added to note.
            </p>
          </div>
          <Button type="button" variant="brand" size="sm" onClick={() => onInsert(result)}>
            Add to note
          </Button>
        </div>
        <MeetingArtifactsContent result={result} idPrefix="meeting-summary-view" />
      </div>
    </div>
  )
}
