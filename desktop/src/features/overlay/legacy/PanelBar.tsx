import { GripVertical } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'

type PanelBarProps = {
  onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void
  title: string
  endAdornment?: React.ReactNode
}

export default function PanelBar({
  onMouseDown,
  title,
  endAdornment,
}: PanelBarProps) {
  return (
    <div className="flex w-full items-center justify-between gap-2 rounded-lg bg-black/70 px-2.5 py-2 backdrop-blur-xl">
      <div className="flex items-center gap-2 overflow-hidden">
        <div
          className="flex items-center p-0.5"
          onMouseDown={onMouseDown}
        >
          <GripVertical className="h-4 w-4 text-white/40" />
        </div>
        <h2 className="truncate text-lg font-medium text-white">
          {title}
        </h2>
      </div>

      {endAdornment}
    </div>
  )
}

