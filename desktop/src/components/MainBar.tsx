import type { MouseEvent as ReactMouseEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Paperclip, History, Settings, GripVertical, Square, Pause, Play } from 'lucide-react'
import { AudioLines } from '@/components/animate-ui/icons/audio-lines'

type MainBarProps = {
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
  onAttach: () => void
  onOpenSettings?: () => void
  onOpenHistory?: () => void
  mode: 'default' | 'live' | 'paused'
  onStartSession: () => void
  onPauseSession: () => void
  onResumeSession: () => void
  onStopSession: () => void
}

function MainBar({
  onMouseDown,
  onAttach,
  onOpenSettings,
  onOpenHistory,
  mode,
  onStartSession,
  onPauseSession,
  onResumeSession,
  onStopSession,
}: MainBarProps) {
  const isPaused = mode === 'paused'

  return (
    <div className="flex w-full items-center gap-2 rounded-lg bg-black/70 px-2.5 py-2 backdrop-blur-xl">
      <div
        className="flex items-center p-0.5"
        onMouseDown={onMouseDown}
      >
        <GripVertical className="h-4 w-4 text-white/40" />
      </div>

      <div className="flex items-center gap-1.5">
        {mode === 'default' ? (
          <div
            role="button"
            tabIndex={0}
            onClick={onStartSession}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onStartSession()
              }
            }}
            className="flex h-8 w-10 shrink-0 items-center justify-center rounded-md border border-white/15 bg-white/20 text-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition hover:cursor-pointer hover:bg-white/20 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
            title="Start session"
            aria-label="Start session"
          >
            <img
              src="/logo.png"
              alt="Orionly logo"
              className="h-6 w-6 object-cover p-0.5"
              draggable={false}
            />
          </div>
        ) : (
          <>
            <div
              className="flex h-8 w-10 shrink-0 items-center justify-center rounded-md border border-white/25 bg-white/15 text-white shadow-[0_1px_3px_rgba(0,0,0,0.35)]"
              role="status"
              aria-label={isPaused ? 'Live mode paused' : 'Live mode is active'}
            >
              <AudioLines
                size={22}
                animate={isPaused ? false : 'default'}
                className={isPaused ? 'text-white/60' : 'text-white'}
              />
            </div>
            <div className="flex h-8 shrink-0 overflow-hidden rounded-md border border-white/20 bg-white/20 text-white shadow-[0_1px_3px_rgba(0,0,0,0.35)]">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className={`h-full w-9 rounded-none transition ${
                  isPaused
                    ? 'bg-white/20 text-white hover:bg-white/20'
                    : 'text-white hover:bg-white/20 hover:text-white'
                }`}
                onClick={isPaused ? onResumeSession : onPauseSession}
                title={isPaused ? 'Resume session' : 'Pause session'}
                aria-label={isPaused ? 'Resume session' : 'Pause session'}
              >
                {isPaused ? (
                  <Play className="size-3.5 text-white" fill="currentColor" stroke="none" />
                ) : (
                  <Pause className="size-3.5 text-white" fill="currentColor" stroke="none" />
                )}
              </Button>
              <div className="h-full w-px bg-white/15" aria-hidden />
            <Button
              type="button"
                size="icon-sm"
              variant="ghost"
                className="h-full w-9 rounded-none text-red-200 transition hover:bg-red-500/25 hover:text-red-50"
              onClick={onStopSession}
              title="Stop session"
              aria-label="Stop session"
            >
                <Square className="size-3.5 fill-current" />
            </Button>
            </div>
          </>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 rounded-md bg-white/20 p-0 text-white hover:bg-white/20 hover:text-white"
          title="Attach"
          onClick={onAttach}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 rounded-md bg-white/20 p-0 text-white hover:bg-white/20 hover:text-white"
          title="History"
          onClick={onOpenHistory}
        >
          <History className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 rounded-md bg-white/20 p-0 text-white hover:bg-white/20 hover:text-white"
          title="Settings"
          onClick={onOpenSettings}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

export default MainBar

