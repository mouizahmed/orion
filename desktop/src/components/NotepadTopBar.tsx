import type { MouseEvent as ReactMouseEvent } from 'react'
import { GripVertical, Plus, Settings } from 'lucide-react'

import { Button } from '@/components/ui/button'

type NotepadTopBarProps = {
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
  onCreateNote: () => void
  onOpenSettings: () => void
}

export default function NotepadTopBar({ onMouseDown, onCreateNote, onOpenSettings }: NotepadTopBarProps) {
  return (
    <div className="flex w-full items-center gap-2 rounded-lg bg-black/70 px-2.5 py-2 backdrop-blur-xl">
      <div className="flex items-center p-0.5" onMouseDown={onMouseDown}>
        <GripVertical className="h-4 w-4 text-white/40" />
      </div>

      <div className="flex items-center gap-2">
        <img
          src="/orionly-mark.png"
          alt="Orionly logo"
          className="h-6 w-6 rounded-md border border-white/10 bg-white/15 object-cover p-0.5"
          draggable={false}
        />
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] font-semibold uppercase tracking-[0.26em] text-white/40">
            Orionly
          </span>
          <span className="text-sm font-medium text-white">
            AI Notepad
          </span>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 rounded-md bg-white/20 p-0 text-white hover:bg-white/20 hover:text-white"
          title="New note"
          aria-label="New note"
          onClick={onCreateNote}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 rounded-md bg-white/20 p-0 text-white hover:bg-white/20 hover:text-white"
          title="Settings"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

