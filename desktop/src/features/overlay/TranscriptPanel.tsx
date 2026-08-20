import { useMemo } from 'react'

import type { LiveTranscriptSegment } from '@/features/overlay/types'
import { cn } from '@/lib/utils'
import { InfoBanner } from '@/components/ui/info-banner'

type TranscriptPanelProps = {
  segments: LiveTranscriptSegment[]
  status: 'live' | 'paused' | 'disabled'
  isProcessing?: boolean
  appearance?: 'default' | 'embedded'
  className?: string
}

const TRANSCRIPT_WARNING_TEXT =
  'The transcript may show repeated sentences without headphones, but your final notes will be unaffected. For the best experience, use headphones.'

export default function TranscriptPanel({
  segments,
  status,
  isProcessing = false,
  appearance = 'default',
  className,
}: TranscriptPanelProps) {
  const content = useMemo(() => {
    if (segments.length === 0) {
      if (status === 'disabled') {
        return "Live transcript isn't available right now."
      }

      if (isProcessing) {
        return "Listening\u2026 I'll drop notes here as soon as I hear something worth capturing."
      }

      return "I'll jot down a running transcript here once the live session gets going."
    }

    return null
  }, [segments.length, status, isProcessing])

  const containerClassName =
    appearance === 'embedded'
      ? 'flex w-full flex-col gap-3'
      : 'flex w-full flex-col gap-3 rounded-2xl border border-neutral-200 bg-white/90 px-4 py-3 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-black/70'

  return (
    <div className={cn(containerClassName, className)}>
      <InfoBanner>
        {TRANSCRIPT_WARNING_TEXT}
      </InfoBanner>
      {content ? (
        <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-100 px-4 py-6 text-sm text-neutral-600 dark:border-white/15 dark:bg-white/15 dark:text-white/70">
          {content}
        </div>
      ) : (
        <div className="attachments-scrollbar max-h-60 space-y-1.5 overflow-y-auto pr-1">
          {segments.map((segment) => {
            const isMic = (segment.channel ?? 0) === 0
            return (
              <div
                key={segment.id}
                className={cn('flex', isMic ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[80%] rounded-lg px-3 py-1.5 text-sm',
                    isMic
                      ? 'bg-neutral-200 text-neutral-900 dark:bg-white/15 dark:text-white/90'
                      : 'bg-neutral-100 text-neutral-800 dark:bg-white/10 dark:text-white/85',
                    segment.pending && 'opacity-70',
                  )}
                >
                  {segment.text}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
