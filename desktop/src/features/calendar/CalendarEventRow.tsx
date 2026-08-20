import { cn } from '@/lib/utils'
import { formatTime } from '@/features/calendar/calendar-utils'
import type { CalendarEvent } from '@/features/calendar/useCalendarEvents'

function formatEventTime(event: CalendarEvent) {
  if (event.allDay) return 'All day'
  return `${formatTime(event.start)}-${formatTime(event.end)}`
}

export function CalendarEventRow({
  event,
  selected = false,
  onClick,
  variant = 'pill',
}: {
  event: CalendarEvent
  selected?: boolean
  onClick?: () => void
  variant?: 'pill' | 'border'
}) {
  if (variant === 'pill') {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
          selected ? 'bg-neutral-100 dark:bg-white/10' : 'hover:bg-neutral-100/70 dark:hover:bg-white/[0.06]',
        )}
      >
        <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">{event.title}</div>
          <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{formatEventTime(event)}</div>
          {event.accountEmail ? (
            <div className="mt-0.5 truncate text-xs text-neutral-400 dark:text-neutral-500">{event.accountEmail}</div>
          ) : null}
        </div>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'block w-full rounded-lg border border-transparent text-left transition-colors',
        selected ? 'bg-neutral-100 dark:bg-white/10' : 'hover:bg-neutral-100/70 dark:hover:bg-white/[0.06]',
      )}
    >
      <div
        className="min-w-0 border-l-2 py-1 pl-3"
        style={{ borderLeftColor: event.color || '#9f73f2' }}
      >
        <div className="truncate text-xs font-medium text-neutral-800 dark:text-neutral-200">{event.title}</div>
        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{formatEventTime(event)}</p>
        {event.accountEmail ? (
          <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{event.accountEmail}</p>
        ) : null}
      </div>
    </button>
  )
}
