import { LoaderCircle, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InfoBanner } from '@/components/ui/info-banner'
import type { MeetingArtifactsResult } from '@/features/notes/api/meeting-artifacts-client'

export type MeetingArtifactGenerationState =
  | { status: 'loading' }
  | { status: 'ready'; result: MeetingArtifactsResult }
  | { status: 'error'; message: string }

export function MeetingArtifactsContent({
  result,
  idPrefix,
}: {
  result: MeetingArtifactsResult
  idPrefix: string
}) {
  const { artifacts, summaryTemplate } = result
  return (
    <div className="space-y-5 text-sm">
      <section aria-labelledby={`${idPrefix}-summary-heading`}>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h3 id={`${idPrefix}-summary-heading`} className="font-semibold text-neutral-900 dark:text-neutral-100">
            Summary
          </h3>
          <span className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
            {summaryTemplate?.name ?? 'Default format'}
          </span>
        </div>
        <p className="whitespace-pre-wrap leading-6 text-neutral-700 dark:text-neutral-200">{artifacts.summary}</p>
      </section>

      <section aria-labelledby={`${idPrefix}-decisions-heading`}>
        <h3 id={`${idPrefix}-decisions-heading`} className="mb-1.5 font-semibold text-neutral-900 dark:text-neutral-100">
          Decisions
        </h3>
        {artifacts.decisions.length === 0 ? (
          <p className="text-neutral-500 dark:text-neutral-400">No explicit decisions found.</p>
        ) : (
          <ul className="list-disc space-y-1.5 pl-5 text-neutral-700 dark:text-neutral-200">
            {artifacts.decisions.map((decision, index) => <li key={`${index}:${decision.text}`}>{decision.text}</li>)}
          </ul>
        )}
      </section>

      <section aria-labelledby={`${idPrefix}-actions-heading`}>
        <h3 id={`${idPrefix}-actions-heading`} className="mb-1.5 font-semibold text-neutral-900 dark:text-neutral-100">
          Action items
        </h3>
        {artifacts.actionItems.length === 0 ? (
          <p className="text-neutral-500 dark:text-neutral-400">No action items found.</p>
        ) : (
          <ul className="space-y-2">
            {artifacts.actionItems.map((item, index) => (
              <li key={`${index}:${item.description}`} className="rounded-xl border border-neutral-200 p-2.5 dark:border-white/10">
                <p className="text-neutral-700 dark:text-neutral-200">{item.description}</p>
                {(item.owner || item.dueDate) && (
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {[item.owner && `Owner: ${item.owner}`, item.dueDate && `Due: ${item.dueDate}`].filter(Boolean).join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default function NoteMeetingArtifactsReview({
  state,
  onGenerate,
  onInsert,
}: {
  state: MeetingArtifactGenerationState
  onGenerate: () => void
  onInsert: (result: MeetingArtifactsResult) => void
}) {
  if (state.status === 'loading') {
    return (
      <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
        Generating meeting notes…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{state.message}</p>
        <Button type="button" variant="secondary" size="sm" onClick={onGenerate}>
          <RotateCcw aria-hidden="true" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1 sidebar-scrollbar">
      <InfoBanner className="mb-3">
        Generated from saved transcript. Review before adding anything to note.
      </InfoBanner>

      <div className="pb-3">
        <MeetingArtifactsContent result={state.result} idPrefix="meeting-review" />
        <div className="mt-5 flex items-center gap-2">
          <Button type="button" variant="brand" size="sm" onClick={() => onInsert(state.result)}>
            Add to note
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={onGenerate}>
            <RotateCcw aria-hidden="true" />
            Regenerate
          </Button>
        </div>
      </div>
    </div>
  )
}
