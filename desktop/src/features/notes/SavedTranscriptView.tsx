import { useState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'

import type { TranscriptSegment } from '@/features/notes/api/transcript-client'
import { cn } from '@/lib/utils'

type SavedTranscriptViewProps = {
  segments: TranscriptSegment[]
  loading: boolean
  theme?: 'light' | 'dark'
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function SegmentRow({ seg, isDark }: { seg: TranscriptSegment; isDark: boolean }) {
  const [copied, setCopied] = useState(false)
  const isMic = seg.channel === 0

  const handleCopy = () => {
    void navigator.clipboard.writeText(seg.text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className={cn('flex', isMic ? 'justify-end' : 'justify-start')}>
      <div className="group flex max-w-[85%] flex-col gap-0.5">
        {seg.start_time != null && (
          <span className={cn('text-[10px] tabular-nums', isMic ? 'text-right' : 'text-left', isDark ? 'text-white/35' : 'text-neutral-400 dark:text-neutral-500')}>
            {formatTime(seg.start_time)}
          </span>
        )}
        <div className={cn('flex items-center gap-1.5', isMic ? 'flex-row-reverse' : 'flex-row')}>
          <div
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm',
              isMic
                ? isDark ? 'bg-white/15 text-white/90' : 'bg-neutral-200 text-neutral-900 dark:bg-white/15 dark:text-white/90'
                : isDark ? 'bg-white/10 text-white/85' : 'bg-neutral-100 text-neutral-800 dark:bg-white/10 dark:text-white/85',
            )}
          >
            {seg.text}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              'flex shrink-0 items-center justify-center rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100',
              isDark ? 'text-white/40 hover:text-white/70' : 'text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300',
            )}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function SavedTranscriptView({
  segments,
  loading,
  theme = 'light',
}: SavedTranscriptViewProps) {
  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${theme === 'dark' ? 'text-white/45' : 'text-neutral-500 dark:text-neutral-400'}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading transcript...
      </div>
    )
  }

  if (segments.length === 0) {
    return (
      <p className={theme === 'dark' ? 'text-white/45' : 'text-neutral-500 dark:text-neutral-400'}>
        No transcript yet.
      </p>
    )
  }

  const isDark = theme === 'dark'

  return (
    <div className="space-y-1.5">
      {segments.map((seg) => (
        <SegmentRow key={seg.id} seg={seg} isDark={isDark} />
      ))}
    </div>
  )
}
