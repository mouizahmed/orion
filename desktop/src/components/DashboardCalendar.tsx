import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'

import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, MapPin, Users, X } from 'lucide-react'

import { auth } from '@/config/firebase'
import { Button } from '@/components/ui/button'
import {
  DashboardPanel,
  DashboardPanelBody,
  DashboardPanelHeader,
  DashboardPanelTitle,
} from '@/components/ui/dashboard-panel'
import { useAuth } from '@/contexts/AuthContext'
import { useDashboardNotes } from '@/contexts/DashboardNotesContext'
import { cn } from '@/lib/utils'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'
const CALENDAR_REFRESH_EVENT = 'dashboard-calendar-refresh'
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_HEIGHT = 44
const WEEK_TIME_GUTTER = 48
const START_HOUR = 0
const END_HOUR = 24

type CalendarView = 'agenda' | 'week' | 'month'

type ServerCalendarEvent = {
  id: string
  title: string
  start: string
  end: string
  location?: string
  description?: string
  organizer?: string
  provider: string
  is_meeting: boolean
  attendees?: string[]
}

type CalendarEvent = {
  id: string
  title: string
  start: string
  end: string
  calendarId: string
  calendarName: string
  color: string
  attendees: string[]
  meetingLink?: string
  location?: string
  description?: string
  organizer?: string
  provider: string
  isMeeting: boolean
}

type PositionedEvent = CalendarEvent & {
  top: number
  height: number
  left: number
  width: number
}

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS)
}

function startOfWeek(date: Date) {
  const day = startOfDay(date)
  return addDays(day, -day.getDay())
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function isSameDay(first: Date, second: Date) {
  return dateKey(first) === dateKey(second)
}

function isSameMonth(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth()
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatHourLabel(hour: number) {
  if (hour === 0) return '12 AM'
  if (hour === 12) return '12 PM'
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`
}

function formatTimeRange(event: CalendarEvent) {
  return `${formatTime(event.start)}-${formatTime(event.end)}`
}

function formatDayHeading(date: Date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function formatCalendarTitle(view: CalendarView, cursorDate: Date) {
  if (view === 'month') {
    return cursorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  }

  const weekStart = startOfWeek(cursorDate)
  const weekEnd = addDays(weekStart, 6)
  const sameMonth = weekStart.getMonth() === weekEnd.getMonth()

  if (sameMonth) {
    return `${weekStart.toLocaleDateString('en-US', { month: 'long' })} ${weekStart.getDate()}-${weekEnd.getDate()}, ${weekStart.getFullYear()}`
  }

  return `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function extractMeetingLink(event: ServerCalendarEvent) {
  const text = `${event.location ?? ''} ${event.description ?? ''}`
  return text.match(/https?:\/\/[^\s<>"')]+/i)?.[0]
}

function normalizeEvent(event: ServerCalendarEvent): CalendarEvent {
  const providerLabel = event.provider === 'google' ? 'Google Calendar' : event.provider === 'microsoft' ? 'Microsoft Calendar' : 'Calendar'

  return {
    id: event.id,
    title: event.title || 'Untitled event',
    start: event.start,
    end: event.end,
    calendarId: event.provider,
    calendarName: providerLabel,
    color: event.provider === 'microsoft' ? '#38bdf8' : '#9f73f2',
    attendees: event.attendees ?? [],
    meetingLink: extractMeetingLink(event),
    location: event.location,
    description: event.description,
    organizer: event.organizer,
    provider: event.provider,
    isMeeting: event.is_meeting,
  }
}

function buildMonthGrid(cursorDate: Date) {
  const first = startOfMonth(cursorDate)
  const gridStart = startOfWeek(first)
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

function groupEventsByDay(events: CalendarEvent[]) {
  return events.reduce<Record<string, CalendarEvent[]>>((groups, event) => {
    const key = dateKey(new Date(event.start))
    groups[key] = groups[key] ?? []
    groups[key].push(event)
    return groups
  }, {})
}

function getEventsForDay(events: CalendarEvent[], date: Date) {
  return events
    .filter((event) => isSameDay(new Date(event.start), date))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
}

function positionWeekEvents(events: CalendarEvent[]) {
  const sorted = [...events].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  return sorted.map((event, index) => {
    const start = new Date(event.start)
    const end = new Date(event.end)
    const startMinutes = Math.max(0, start.getHours() * 60 + start.getMinutes() - START_HOUR * 60)
    const endMinutes = Math.min((END_HOUR - START_HOUR) * 60, end.getHours() * 60 + end.getMinutes() - START_HOUR * 60)
    const overlapping = sorted.filter((candidate) => {
      const candidateStart = new Date(candidate.start).getTime()
      const candidateEnd = new Date(candidate.end).getTime()
      return candidateStart < end.getTime() && candidateEnd > start.getTime()
    })
    const overlapCount = Math.max(1, overlapping.length)
    const column = index % overlapCount

    return {
      ...event,
      top: (startMinutes / 60) * HOUR_HEIGHT,
      height: Math.max(28, ((Math.max(endMinutes, startMinutes + 30) - startMinutes) / 60) * HOUR_HEIGHT),
      left: (column / overlapCount) * 100,
      width: 100 / overlapCount,
    }
  })
}

function EventDetail({
  event,
  onStartNote,
  onClose,
}: {
  event: CalendarEvent
  onStartNote: () => void
  onClose: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col p-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{event.title}</div>
          <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{formatTimeRange(event)}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: event.color }} />
          <button
            type="button"
            aria-label="Close event details"
            onClick={onClose}
            className="rounded-full p-1 text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button type="button" variant="secondary" size="sm" onClick={onStartNote}>
          Start note
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled>
          Start transcript
        </Button>
        {event.meetingLink ? (
          <Button type="button" variant="secondary" size="sm" asChild>
            <a href={event.meetingLink} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              Join
            </a>
          </Button>
        ) : null}
      </div>

      <div className="mt-4 space-y-4 overflow-y-auto pr-1 sidebar-scrollbar">
        <section>
          <div className="mb-2 text-xs font-semibold text-neutral-400">Details</div>
          <div className="space-y-2 text-xs text-neutral-500 dark:text-neutral-400">
            {event.location ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{event.location}</span>
              </div>
            ) : null}
            {event.organizer ? (
              <div className="truncate">Organizer: {event.organizer}</div>
            ) : null}
            <div className="truncate">Calendar: {event.calendarName}</div>
          </div>
        </section>

        {event.description ? (
          <section>
            <div className="mb-2 text-xs font-semibold text-neutral-400">Description</div>
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs leading-5 text-neutral-600 sidebar-scrollbar dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-300">
              {event.description}
            </div>
          </section>
        ) : null}

        <section>
          <div className="mb-2 text-xs font-semibold text-neutral-400">Attendees</div>
          {event.attendees.length > 0 ? (
            <div className="space-y-1.5">
              {event.attendees.slice(0, 8).map((attendee) => (
                <div key={attendee} className="flex min-w-0 items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{attendee}</span>
                </div>
              ))}
              {event.attendees.length > 8 ? (
                <div className="text-xs text-neutral-400">+{event.attendees.length - 8} more</div>
              ) : null}
            </div>
          ) : (
            <div className="text-xs text-neutral-500 dark:text-neutral-400">No attendees listed</div>
          )}
        </section>

      </div>
    </div>
  )
}

function DayEventsDetail({
  date,
  events,
  onSelectEvent,
  onClose,
}: {
  date: Date
  events: CalendarEvent[]
  onSelectEvent: (event: CalendarEvent) => void
  onClose: () => void
}) {
  return (
    <div className="p-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {formatDayHeading(date)}
          </div>
          <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {events.length} event{events.length === 1 ? '' : 's'}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close day details"
          onClick={onClose}
          className="rounded-full p-1 text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 dark:hover:bg-white/10 dark:hover:text-neutral-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-3 space-y-1">
        {events.map((event) => (
          <button
            key={event.id}
            type="button"
            onClick={() => onSelectEvent(event)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-white/[0.06]"
          >
            <span className="h-7 w-1 shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">{event.title}</div>
              <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{formatTimeRange(event)}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

export function DashboardCalendar() {
  const { user } = useAuth()
  const { openCreateNoteDialog } = useDashboardNotes()
  const [view, setView] = useState<CalendarView>('week')
  const [cursorDate, setCursorDate] = useState(() => new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [showOnlyMeetings, setShowOnlyMeetings] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadEvents = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)

    try {
      const currentUser = auth.currentUser
      if (!currentUser) throw new Error('Not authenticated')
      const idToken = await currentUser.getIdToken()
      const response = await fetch(`${API_BASE_URL}/calendar/upcoming?limit=100`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      })

      if (!response.ok) throw new Error(`Failed to fetch calendar events: ${response.status}`)
      const data = await response.json()
      const nextEvents = data.status === 'success' && Array.isArray(data.events)
        ? data.events.map((event: ServerCalendarEvent) => normalizeEvent(event))
        : []
      setEvents(nextEvents)
      setSelectedEvent(null)
      setSelectedDay(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load calendar')
      setEvents([])
      setSelectedEvent(null)
      setSelectedDay(null)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadEvents()
    window.addEventListener(CALENDAR_REFRESH_EVENT, loadEvents)
    return () => {
      window.removeEventListener(CALENDAR_REFRESH_EVENT, loadEvents)
    }
  }, [loadEvents])

  const visibleEvents = useMemo(
    () => showOnlyMeetings ? events.filter((event) => event.isMeeting) : events,
    [events, showOnlyMeetings],
  )
  const weekDays = useMemo(() => {
    const start = startOfWeek(cursorDate)
    return Array.from({ length: 7 }, (_, index) => addDays(start, index))
  }, [cursorDate])
  const monthDays = useMemo(() => buildMonthGrid(cursorDate), [cursorDate])
  const eventsByDay = useMemo(() => groupEventsByDay(visibleEvents), [visibleEvents])
  const visibleAgendaDays = useMemo(() => {
    const today = startOfDay(new Date())
    return Object.entries(eventsByDay)
      .map(([key, dayEvents]) => ({ key, date: new Date(`${key}T00:00:00`), events: dayEvents }))
      .filter((group) => group.date.getTime() >= today.getTime())
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 14)
  }, [eventsByDay])

  const moveRange = (direction: -1 | 1) => {
    const amount = view === 'month' ? direction : direction * 7
    const next = view === 'month'
      ? new Date(cursorDate.getFullYear(), cursorDate.getMonth() + direction, 1)
      : addDays(cursorDate, amount)
    setCursorDate(next)
  }

  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, index) => START_HOUR + index)
  const toggleSelectedEvent = (event: CalendarEvent) => {
    setSelectedDay(null)
    setSelectedEvent((current) => (current?.id === event.id ? null : event))
  }
  const openDayEvents = (date: Date) => {
    setSelectedEvent(null)
    setSelectedDay(date)
  }
  const selectedDayEvents = selectedDay ? getEventsForDay(visibleEvents, selectedDay) : []
  const hasDetailsPanel = Boolean(selectedEvent || selectedDay)

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <DashboardPanel className="shrink-0">
        <DashboardPanelHeader>
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <DashboardPanelTitle>Calendar</DashboardPanelTitle>
              <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
                {formatCalendarTitle(view, cursorDate)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
            <div className="flex rounded-full border border-neutral-200 bg-white/60 p-0.5 dark:border-white/10 dark:bg-white/5">
              {(['agenda', 'week', 'month'] as CalendarView[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setView(option)}
                  className={cn(
                    'h-7 rounded-full px-3 text-xs font-medium capitalize transition-colors',
                    view === option
                      ? 'bg-[#7c3aed] text-white dark:bg-[#9f73f2]'
                      : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white',
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setCursorDate(new Date())}>
              Today
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowOnlyMeetings((current) => !current)
                setSelectedEvent(null)
                setSelectedDay(null)
              }}
            >
              {showOnlyMeetings ? 'Show All' : 'Meetings Only'}
            </Button>
            <Button type="button" variant="secondary" size="icon-sm" aria-label="Previous" onClick={() => moveRange(-1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="secondary" size="icon-sm" aria-label="Next" onClick={() => moveRange(1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </DashboardPanelHeader>
      </DashboardPanel>

      <div className={cn('grid min-h-0 flex-1 gap-2', hasDetailsPanel && 'lg:grid-cols-[minmax(0,1fr)_280px]')}>
        <DashboardPanel className="flex min-h-0 flex-col">
          <DashboardPanelBody className="min-h-0 flex-1 p-0">
            {loading ? (
              <div className="grid h-full grid-cols-7 gap-1">
                {Array.from({ length: 14 }, (_, index) => (
                  <div key={index} className="animate-pulse rounded-lg bg-neutral-100 dark:bg-white/[0.04]" />
                ))}
              </div>
            ) : error ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-xs text-neutral-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-400">
                Failed to load calendar
              </div>
            ) : visibleEvents.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-center dark:border-white/10 dark:bg-white/[0.03]">
                <CalendarDays className="mb-2 h-5 w-5 text-neutral-400" />
                <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  {showOnlyMeetings ? 'No upcoming meetings' : 'No upcoming events'}
                </p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Connected calendar events will appear here.</p>
              </div>
            ) : (
              <div className="h-full min-h-0 overflow-hidden">
              {view === 'agenda' ? (
                <div className="h-full overflow-y-auto p-1 sidebar-scrollbar">
                  {visibleAgendaDays.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-xs text-neutral-500">No upcoming events in this range</div>
                  ) : (
                    <div className="space-y-3">
                      {visibleAgendaDays.map((group) => (
                        <div key={group.key}>
                          <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">{formatDayHeading(group.date)}</div>
                          <div className="space-y-0.5">
                            {group.events.map((event) => (
                              <button
                                key={event.id}
                                type="button"
                                onClick={() => toggleSelectedEvent(event)}
                                className={cn(
                                  'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                                  selectedEvent?.id === event.id ? 'bg-neutral-100 dark:bg-white/10' : 'hover:bg-neutral-100/70 dark:hover:bg-white/[0.06]',
                                )}
                              >
                                <span className="h-8 w-1 rounded-full" style={{ backgroundColor: event.color }} />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">{event.title}</div>
                                  <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{formatTimeRange(event)}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {view === 'week' ? (
                <div className="h-full min-h-0 overflow-y-auto sidebar-scrollbar">
                  <div
                    className="sticky top-0 z-20 grid border-b border-neutral-200 bg-white/95 backdrop-blur dark:border-white/10 dark:bg-[#171417]/95"
                    style={{ gridTemplateColumns: `${WEEK_TIME_GUTTER}px repeat(7, minmax(0, 1fr))` }}
                  >
                    <div className="border-r border-neutral-200 bg-white/95 dark:border-white/10 dark:bg-[#171417]/95" />
                    {weekDays.map((day) => (
                      <div key={dateKey(day)} className="px-2 py-2 text-center">
                        <div className="text-[10px] font-semibold uppercase text-neutral-400">{day.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                        <div className={cn('mx-auto mt-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold', isSameDay(day, new Date()) ? 'bg-[#7c3aed] text-white dark:bg-[#9f73f2]' : 'text-neutral-700 dark:text-neutral-200')}>
                          {day.getDate()}
                        </div>
                      </div>
                    ))}
                  </div>
                    <div
                      className="grid"
                      style={{
                        gridTemplateColumns: `${WEEK_TIME_GUTTER}px repeat(7, minmax(0, 1fr))`,
                        height: (END_HOUR - START_HOUR) * HOUR_HEIGHT,
                      }}
                    >
                      <div className="relative border-r border-neutral-200 dark:border-white/10">
                        {hours.slice(0, -1).map((hour) => (
                          <div key={hour} className="absolute right-2 text-[10px] leading-none text-neutral-400" style={{ top: Math.max(0, (hour - START_HOUR) * HOUR_HEIGHT + 2) }}>
                            {formatHourLabel(hour)}
                          </div>
                        ))}
                      </div>
                      {weekDays.map((day) => {
                        const dayEvents = positionWeekEvents(getEventsForDay(visibleEvents, day))
                        return (
                          <div key={dateKey(day)} className="relative border-r border-neutral-200 last:border-r-0 dark:border-white/10">
                            {hours.slice(0, -1).map((hour) => (
                              <div key={hour} className="border-t border-neutral-200/70 dark:border-white/8" style={{ height: HOUR_HEIGHT }} />
                            ))}
                            {dayEvents.map((event: PositionedEvent) => (
                              <button
                                key={event.id}
                                type="button"
                                onClick={() => toggleSelectedEvent(event)}
                                className="absolute overflow-hidden rounded-md border border-white/40 px-2 py-1 text-left text-white shadow-sm"
                                style={{
                                  top: event.top,
                                  height: event.height,
                                  left: `${event.left}%`,
                                  width: `calc(${event.width}% - 4px)`,
                                  backgroundColor: event.color,
                                }}
                              >
                                <div className="truncate text-[11px] font-semibold">{event.title}</div>
                                <div className="truncate text-[10px] opacity-85">{formatTimeRange(event)}</div>
                              </button>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                </div>
              ) : null}

              {view === 'month' ? (
                <div className="grid h-full grid-rows-[auto_repeat(6,minmax(0,1fr))]">
                  <div className="grid grid-cols-7 border-b border-neutral-200 dark:border-white/10">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                      <div key={day} className="px-2 py-2 text-center text-[10px] font-semibold uppercase text-neutral-400">{day}</div>
                    ))}
                  </div>
                  {Array.from({ length: 6 }, (_, row) => (
                    <div key={row} className="grid min-h-0 grid-cols-7 border-b border-neutral-200 last:border-b-0 dark:border-white/10">
                      {monthDays.slice(row * 7, row * 7 + 7).map((day) => {
                        const dayEvents = getEventsForDay(visibleEvents, day)
                        const hiddenCount = Math.max(0, dayEvents.length - 3)
                        return (
                          <div key={dateKey(day)} className="min-h-0 border-l border-neutral-200 p-1 first:border-l-0 dark:border-white/10">
                            <div className={cn('mb-1 flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium', isSameDay(day, new Date()) ? 'bg-[#7c3aed] text-white dark:bg-[#9f73f2]' : isSameMonth(day, cursorDate) ? 'text-neutral-800 dark:text-neutral-200' : 'text-neutral-300 dark:text-neutral-600')}>
                              {day.getDate()}
                            </div>
                            <div className="space-y-0.5">
                              {dayEvents.slice(0, 3).map((event) => (
                                <button
                                  key={event.id}
                                  type="button"
                                  onClick={() => toggleSelectedEvent(event)}
                                  className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/8"
                                >
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
                                  <span className="truncate">{event.title}</span>
                                </button>
                              ))}
                              {hiddenCount > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => openDayEvents(day)}
                                  className="rounded px-1 text-left text-[10px] font-medium text-[#7c3aed] hover:bg-neutral-100 dark:text-[#9f73f2] dark:hover:bg-white/8"
                                >
                                  +{hiddenCount} more
                                </button>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              ) : null}
              </div>
            )}
          </DashboardPanelBody>
        </DashboardPanel>

        {hasDetailsPanel ? (
          <DashboardPanel className="min-h-0">
            <DashboardPanelBody className="h-full min-h-0 p-2">
              {selectedEvent ? (
                <EventDetail
                  event={selectedEvent}
                  onStartNote={openCreateNoteDialog}
                  onClose={() => setSelectedEvent(null)}
                />
              ) : selectedDay ? (
                <DayEventsDetail
                  date={selectedDay}
                  events={selectedDayEvents}
                  onSelectEvent={(event) => {
                    setSelectedDay(null)
                    setSelectedEvent(event)
                  }}
                  onClose={() => setSelectedDay(null)}
                />
              ) : null}
            </DashboardPanelBody>
          </DashboardPanel>
        ) : null}
      </div>
    </div>
  )
}
