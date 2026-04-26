import type { MouseEvent as ReactMouseEvent } from 'react'
import { CornerDownLeft, Grid3X3, Mic, MicOff, Settings, Volume2, VolumeX } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type CompactOverlayBarProps = {
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
  meetingActive: boolean
  onToggleMeeting: () => void
  micMuted: boolean
  onToggleMicMuted: () => void
  speakerMuted: boolean
  onToggleSpeakerMuted: () => void
  onOpenDashboard: () => void
  onToggleSettings: () => void
  settingsOpen?: boolean
}

export default function CompactOverlayBar({
  onMouseDown,
  meetingActive,
  onToggleMeeting,
  micMuted,
  onToggleMicMuted,
  speakerMuted,
  onToggleSpeakerMuted,
  onOpenDashboard,
  onToggleSettings,
  settingsOpen = false,
}: CompactOverlayBarProps) {
  return (
    <div className="flex w-full transform-gpu select-none items-center gap-2 will-change-transform [backface-visibility:hidden]">
      <div
        className="flex h-10 w-10 shrink-0 transform-gpu cursor-grab items-center justify-center rounded-full border border-white/15 bg-zinc-950/55 ring-1 ring-white/10 will-change-transform [backface-visibility:hidden] active:cursor-grabbing"
        onMouseDown={onMouseDown}
      >
        <img
          src="/sunless_ring_exact_editable_svg.svg"
          alt="Sunless logo"
          className="pointer-events-none h-7 w-7 select-none object-contain"
          draggable={false}
          onContextMenu={(event) => event.preventDefault()}
        />
      </div>

      <div className="relative flex min-w-0 flex-1 transform-gpu items-center gap-1 overflow-hidden rounded-full border border-white/15 bg-zinc-950/55 p-1 ring-1 ring-white/10 will-change-transform [backface-visibility:hidden] before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:bg-violet-500/5">
        <Button
          type="button"
          variant={meetingActive ? 'destructive' : 'secondary'}
          className={cn(
            'relative h-8 rounded-full border px-3 text-xs font-semibold shadow-none',
            meetingActive
              ? 'border-red-400/20 bg-red-500/20 text-red-50 hover:bg-red-500/25'
              : 'border-white/15 bg-zinc-900/55 text-zinc-50 hover:bg-zinc-800/65',
          )}
          onClick={onToggleMeeting}
          title={meetingActive ? 'Stop meeting' : 'Start meeting'}
        >
          {meetingActive ? 'Stop meeting' : 'Start meeting'}
        </Button>

        <div className="flex-1" />

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

