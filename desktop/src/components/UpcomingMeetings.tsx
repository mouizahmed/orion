import { MapPin, Users } from 'lucide-react'

import { useCalendarEvents, type CalendarEvent } from '@/hooks/useCalendarEvents'
import { dateKey, formatTime, isSameDay } from '@/lib/calendar-utils'

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

function formatMeetingTime(event: CalendarEvent) {
  if (event.allDay) return 'All day'
  return `${formatTime(event.start)}-${formatTime(event.end)}`
}

const CALENDAR_EVENT_OPEN_EVENT = 'dashboard-calendar-event-open'

export function UpcomingMeetings() {
  const { events, loading, error } = useCalendarEvents()
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

  if (loading) {
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

  if (error) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-center dark:border-white/10 dark:bg-white/[0.03]">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Calendar integration coming soon
        </p>
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
                    <button
                      key={meeting.id}
                      type="button"
                      className="block w-full rounded-lg border border-transparent text-left transition-colors hover:border-neutral-200/70 hover:bg-neutral-100/60 dark:hover:border-white/8 dark:hover:bg-white/[0.055]"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent(CALENDAR_EVENT_OPEN_EVENT, { detail: meeting }))
                      }}
                    >
                      <div
                        className="min-w-0 border-l-2 py-1 pl-3"
                        style={{ borderLeftColor: meeting.color || '#9f73f2' }}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-medium text-neutral-800 dark:text-neutral-200">
                            {meeting.title}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                          {formatMeetingTime(meeting)}
                        </p>
                        {(meeting.calendarName || meeting.accountEmail) && (
                          <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                            {[meeting.calendarName, meeting.accountEmail].filter(Boolean).join(' - ')}
                          </p>
                        )}
                        {meeting.location && (
                          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-neutral-500">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <span className="truncate">{meeting.location}</span>
                          </p>
                        )}
                        {meeting.attendees && meeting.attendees.length > 0 && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-neutral-500">
                            <Users className="h-3 w-3 shrink-0" />
                            <span>
                              {meeting.attendees.length} attendee{meeting.attendees.length !== 1 ? 's' : ''}
                            </span>
                          </p>
                        )}
                      </div>
                    </button>
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
