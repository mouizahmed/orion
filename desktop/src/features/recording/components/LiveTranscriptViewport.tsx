import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, AudioLines } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  getTranscriptEmptyMessage,
  shouldFollowLiveTranscript,
} from '@/features/recording/recording-overlay-presenter'
import type {
  RecordingTranscriptSegment,
  TranscriptPhase,
} from '@/features/recording/recording-types'
import { cn } from '@/lib/utils'

type LiveTranscriptViewportProps = {
  segments: readonly RecordingTranscriptSegment[]
  transcriptPhase: TranscriptPhase
}

export default function LiveTranscriptViewport({
  segments,
  transcriptPhase,
}: LiveTranscriptViewportProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const latestSegment = segments[segments.length - 1]

  const jumpToLive = (behavior: ScrollBehavior = 'smooth') => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior })
    setFollowing(true)
  }

  useLayoutEffect(() => {
    if (!following) return
    jumpToLive('auto')
  }, [following, latestSegment?.id, latestSegment?.isFinal, latestSegment?.text])

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget
          setFollowing(shouldFollowLiveTranscript(
            element.scrollHeight,
            element.scrollTop,
            element.clientHeight,
          ))
        }}
        className="recording-transcript-scrollbar h-full overflow-y-auto overscroll-contain px-3 pb-4 pt-2"
        aria-live="polite"
        aria-label="Live transcript"
      >
        {segments.length === 0 ? (
          <div className="flex items-start gap-3 py-3 text-sm text-neutral-500 dark:text-neutral-400">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-400/80 dark:bg-white/35" />
            <span>{getTranscriptEmptyMessage(transcriptPhase)}</span>
          </div>
        ) : (
          <div className="space-y-4">
            {segments.map((segment) => {
              const microphone = segment.source === 'microphone'
              return (
                <article key={segment.id} className="grid grid-cols-[52px_1fr] gap-3">
                  <div className="pt-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-neutral-400 dark:text-neutral-500">
                    {microphone ? 'You' : 'Speaker'}
                  </div>
                  <p
                    className={cn(
                      'm-0 text-[13px] leading-5 text-neutral-700 dark:text-neutral-200',
                      !segment.isFinal && 'text-neutral-500 dark:text-neutral-400',
                    )}
                  >
                    {segment.text}
                    {!segment.isFinal && (
                      <span className="ml-1 inline-flex align-middle text-emerald-500 dark:text-lime-400">
                        <AudioLines className="h-3 w-3" />
                      </span>
                    )}
                  </p>
                </article>
              )
            })}
          </div>
        )}
      </div>

      {!following && segments.length > 0 && (
        <Button
          type="button"
          size="sm"
          variant="default"
          onClick={() => jumpToLive()}
          className="absolute bottom-3 left-1/2 h-7 -translate-x-1/2 gap-1.5 bg-white/95 px-2.5 text-[11px] shadow-md backdrop-blur-xl dark:bg-[#2d292d]/95"
        >
          <ArrowDown className="h-3 w-3" />
          Jump to live
        </Button>
      )}
    </div>
  )
}
