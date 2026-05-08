import type { CalendarEvent } from '@/hooks/useCalendarEvents'
import { CalendarEventRow } from '@/components/CalendarEventRow'
import { dateKey, isSameDay } from '@/lib/calendar-utils'

function eventDisplayDate(event: CalendarEvent) {
  const date = new Date(event.start)
  if (event.allDay) {
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  }
  return date
}

function eventDateKey(event: CalendarEvent) {
  const date = new Date(event.start)
  if (event.allDay) {
    return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-')
  }
  return dateKey(date)
}

function formatDateBadge(date: Date) {
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  const day = date.getDate()
  return { month, day: day.toString() }
}

function formatMeetingDate(event: CalendarEvent) {
  return formatDateBadge(eventDisplayDate(event))
}


export function UpcomingMeetings({
  events,
  loading,
  onSelect,
}: {
  events: CalendarEvent[]
  loading: boolean
  onSelect?: (event: CalendarEvent) => void
}) {
  const meetings = events.slice(0, 3)

  const today = new Date()
  const todayKey = dateKey(today)
  const groupedMeetings = meetings.reduce<Array<{ key: string; date: Date; meetings: CalendarEvent[] }>>(
    (groups, meeting) => {
      const date = eventDisplayDate(meeting)
      const key = eventDateKey(meeting)
      const existing = groups.find((group) => group.key === key)

      if (existing) {
        existing.meetings.push(meeting)
      } else {
        groups.push({ key, date, meetings: [meeting] })
      }

      return groups
    },
    [],
  )

  if (!groupedMeetings.some((group) => group.key === todayKey)) {
    groupedMeetings.unshift({ key: todayKey, date: today, meetings: [] })
  }

  groupedMeetings.sort((a, b) => {
    if (a.key === todayKey) return -1
    if (b.key === todayKey) return 1
    return a.date.getTime() - b.date.getTime()
  })

  if (loading && meetings.length === 0) {
    return (
      <div className="space-y-0.5">
        {[70, 55, 80].map((w, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg px-2 py-1.5">
            <div className="flex h-9 w-9 shrink-0 flex-col items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-100 px-1.5 py-1 dark:border-white/10 dark:bg-white/5">
              <div className="h-2 w-6 animate-pulse rounded bg-neutral-200 dark:bg-white/15" />
              <div className="h-3 w-4 animate-pulse rounded bg-neutral-200 dark:bg-white/15" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
              <div className="h-3 animate-pulse rounded bg-neutral-200 dark:bg-white/15" style={{ width: `${w}%` }} />
              <div className="h-2.5 w-32 animate-pulse rounded bg-neutral-100 dark:bg-white/8" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="space-y-0.5">
        {groupedMeetings.map((group, index) => {
          const { month, day } = group.meetings[0] ? formatMeetingDate(group.meetings[0]) : formatDateBadge(group.date)
          const isToday = isSameDay(group.date, today)

          return (
            <div
              key={group.key}
              className={`flex items-start gap-2.5 pb-2 pl-2.5 pr-1.5 ${index === 0 ? 'pt-0' : 'pt-2'}`}
            >
              <div>
                <div className="flex h-9 w-9 shrink-0 flex-col items-center overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 text-center dark:border-white/10 dark:bg-white/5">
                  <div className="w-full border-b border-neutral-200 bg-neutral-200/60 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-neutral-500 dark:border-white/10 dark:bg-white/8 dark:text-neutral-300">
                    {month}
                  </div>
                  <div className="flex flex-1 items-center px-1.5 text-sm font-semibold leading-none text-neutral-800 dark:text-neutral-200">{day}</div>
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-0.5">
                {group.meetings.length === 0 ? (
                  <div className="flex min-h-9 items-center border-l-2 border-neutral-200 pl-3 text-xs font-medium text-neutral-500 dark:border-white/15 dark:text-neutral-400">
                    {isToday ? 'No meetings today' : 'No meetings'}
                  </div>
                ) : (
                  group.meetings.map((meeting) => (
                    <CalendarEventRow
                      key={meeting.id}
                      event={meeting}
                      variant="border"
                      onClick={onSelect ? () => onSelect(meeting) : undefined}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
