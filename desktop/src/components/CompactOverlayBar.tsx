import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  Captions,
  CornerDownLeft,
  Grid3X3,
  MessageCircle,
  Mic,
  MicOff,
  NotebookPen,
  Pause,
  Play,
  Settings,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type CompactOverlayBarProps = {
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
  meetingActive: boolean
  meetingPaused?: boolean
  onToggleMeeting: () => void
  onToggleMeetingPaused?: () => void
  micMuted: boolean
  onToggleMicMuted: () => void
  speakerMuted: boolean
  onToggleSpeakerMuted: () => void
  onOpenDashboard: () => void
  onToggleSettings: () => void
  settingsOpen?: boolean
  compact?: boolean
  notepadOpen?: boolean
  activeMeetingTool?: 'transcript' | 'insights' | 'ask' | null
  onToggleNotepad?: () => void
  onOpenTranscript?: () => void
  onOpenInsights?: () => void
  onOpenAsk?: () => void
}

export default function CompactOverlayBar({
  onMouseDown,
  meetingActive,
  meetingPaused = false,
  onToggleMeeting,
  onToggleMeetingPaused,
  micMuted,
  onToggleMicMuted,
  speakerMuted,
  onToggleSpeakerMuted,
  onOpenDashboard,
  onToggleSettings,
  settingsOpen = false,
  compact = false,
  notepadOpen = false,
  activeMeetingTool = null,
  onToggleNotepad,
  onOpenTranscript,
  onOpenInsights,
  onOpenAsk,
}: CompactOverlayBarProps) {
  return (
    <div
      data-overlay-visible
      className={cn(
        'flex transform-gpu select-none items-center gap-2 overflow-hidden transition-[width] duration-200 ease-out will-change-transform [backface-visibility:hidden]',
        compact ? 'w-max' : 'w-full',
      )}
    >
      <div
        className="flex h-10 w-10 shrink-0 transform-gpu cursor-grab items-center justify-center rounded-full border border-white/12 bg-[#171417]/80 ring-1 ring-white/8 backdrop-blur-md will-change-transform [backface-visibility:hidden] active:cursor-grabbing"
        onMouseDown={onMouseDown}
      >
        <span
          className={cn(
            'pointer-events-none flex h-7 w-7 items-center justify-center',
            meetingActive && !meetingPaused ? 'animate-[logo-size-pulse_1.8s_ease-in-out_infinite]' : null,
          )}
        >
          <img
            src="/Document.svg"
            alt="Sunless logo"
            className={cn(
              'h-7 w-7 select-none object-contain',
              meetingActive && !meetingPaused ? 'animate-[spin_4s_linear_infinite]' : null,
            )}
            draggable={false}
            onContextMenu={(event) => event.preventDefault()}
          />
        </span>
      </div>

      <div
        className={cn(
          'relative flex min-w-0 transform-gpu items-center gap-1 overflow-hidden rounded-full border border-white/12 bg-[#171417]/80 p-1 ring-1 ring-white/8 backdrop-blur-md will-change-transform [backface-visibility:hidden] before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:bg-white/[0.02]',
          compact ? 'flex-none' : 'flex-1 transition-[flex-basis,width] duration-200 ease-out',
        )}
      >
        <Button
          type="button"
          size={meetingActive ? 'icon' : 'default'}
          variant={meetingActive ? 'ghost' : 'secondary'}
          className={cn(
            'relative h-8 rounded-full border shadow-none',
            meetingActive
              ? 'w-8 shrink-0 border-red-400/20 bg-red-500/20 p-0 text-red-50 hover:bg-red-500/25 hover:text-red-50'
              : 'border-white/15 bg-zinc-900/55 px-3 text-xs font-semibold text-zinc-50 hover:bg-zinc-800/65',
          )}
          onClick={onToggleMeeting}
          title={meetingActive ? 'Stop meeting' : 'Start meeting'}
          aria-label={meetingActive ? 'Stop meeting' : 'Start meeting'}
        >
          {meetingActive ? <Square className="h-3 w-3 fill-current" /> : 'Start meeting'}
        </Button>

        {meetingActive ? (
          <>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                'relative h-8 w-8 shrink-0 rounded-full border p-0 text-zinc-100 hover:text-white',
                meetingPaused
                  ? 'border-white/25 bg-white/15 hover:bg-white/20'
                  : 'border-white/15 bg-zinc-900/55 hover:bg-zinc-800/65',
              )}
              title={meetingPaused ? 'Resume meeting' : 'Pause meeting'}
              aria-label={meetingPaused ? 'Resume meeting' : 'Pause meeting'}
              onClick={onToggleMeetingPaused}
            >
              {meetingPaused ? (
                <Play className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Pause className="h-3.5 w-3.5 fill-current" />
              )}
            </Button>

            <div className="mx-1 h-5 w-px bg-white/10" />

            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                'relative h-8 w-8 shrink-0 rounded-full border p-0 text-zinc-100 hover:text-white',
                notepadOpen
                  ? 'border-white/25 bg-white/15 hover:bg-white/20'
                  : 'border-white/15 bg-zinc-900/55 hover:bg-zinc-800/65',
              )}
              title={notepadOpen ? 'Hide notepad' : 'Show notepad'}
              aria-label={notepadOpen ? 'Hide notepad' : 'Show notepad'}
              onClick={onToggleNotepad}
            >
              <NotebookPen className="h-4 w-4" />
            </Button>

            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                'relative h-8 w-8 shrink-0 rounded-full border p-0 text-zinc-100 hover:text-white',
                activeMeetingTool === 'transcript'
                  ? 'border-white/25 bg-white/15 hover:bg-white/20'
                  : 'border-white/15 bg-zinc-900/55 hover:bg-zinc-800/65',
              )}
              title="Transcript"
              aria-label="Transcript"
              onClick={onOpenTranscript}
            >
              <Captions className="h-4 w-4" />
            </Button>

            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                'relative h-8 w-8 shrink-0 rounded-full border p-0 text-zinc-100 hover:text-white',
                activeMeetingTool === 'ask'
                  ? 'border-white/25 bg-white/15 hover:bg-white/20'
                  : 'border-white/15 bg-zinc-900/55 hover:bg-zinc-800/65',
              )}
              title="Ask"
              aria-label="Ask"
              onClick={onOpenAsk}
            >
              <MessageCircle className="h-4 w-4" />
            </Button>

            <Button
              type="button"
              size="icon"
              variant="ghost"
              className={cn(
                'relative h-8 w-8 shrink-0 rounded-full border p-0 text-zinc-100 hover:text-white',
                activeMeetingTool === 'insights'
                  ? 'border-white/25 bg-white/15 hover:bg-white/20'
                  : 'border-white/15 bg-zinc-900/55 hover:bg-zinc-800/65',
              )}
              title="Insights"
              aria-label="Insights"
              onClick={onOpenInsights}
            >
              <Sparkles className="h-4 w-4" />
            </Button>

            <div className="mx-1 h-5 w-px bg-white/10" />
          </>
        ) : null}

        {!compact ? <div className="flex-1" /> : null}

        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn(
              'relative h-8 w-8 shrink-0 rounded-full border p-0 text-zinc-100 hover:text-white',
              micMuted
                ? 'border-red-400/20 bg-red-500/20 hover:bg-red-500/25'
                : 'border-white/15 bg-zinc-900/55 hover:bg-zinc-800/65',
            )}
            title={micMuted ? 'Mic muted' : 'Mic unmuted'}
            aria-label="Toggle mic mute"
            onClick={onToggleMicMuted}
          >
            {micMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn(
              'relative h-8 w-8 shrink-0 rounded-full border p-0 text-zinc-100 hover:text-white',
              speakerMuted
                ? 'border-red-400/20 bg-red-500/20 hover:bg-red-500/25'
                : 'border-white/15 bg-zinc-900/55 hover:bg-zinc-800/65',
            )}
            title={speakerMuted ? 'Speaker muted' : 'Speaker unmuted'}
            aria-label="Toggle speaker mute"
            onClick={onToggleSpeakerMuted}
          >
            {speakerMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="relative h-8 w-8 shrink-0 rounded-full border border-white/15 bg-zinc-900/55 p-0 text-zinc-100 hover:bg-zinc-800/65 hover:text-white"
            title="Open dashboard"
            aria-label="Open dashboard"
            onClick={onOpenDashboard}
          >
            <Grid3X3 className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="relative h-8 w-8 shrink-0 rounded-full border border-white/15 bg-zinc-900/55 p-0 text-zinc-100 hover:bg-zinc-800/65 hover:text-white"
            title={settingsOpen ? 'Back' : 'Settings'}
            aria-label={settingsOpen ? 'Back' : 'Settings'}
            onClick={onToggleSettings}
          >
            {settingsOpen ? <CornerDownLeft className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}


