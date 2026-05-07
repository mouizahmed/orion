import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'

import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, MapPin, RefreshCw, Settings2, Users, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DashboardPanel,
  DashboardPanelBody,
  DashboardPanelHeader,
  DashboardPanelTitle,
} from '@/components/ui/dashboard-panel'
import { useDashboardNotes } from '@/contexts/DashboardNotesContext'
import { useCalendarEvents, type CalendarAttendee, type CalendarEvent } from '@/hooks/useCalendarEvents'
import { listNotesByEvent } from '@/lib/notes-client'
import type { NoteRecord } from '@/types/note'
import { NoteRow } from '@/components/NoteRow'
import { LoadMoreButton } from '@/components/ui/load-more-button'
import { cn } from '@/lib/utils'
import { dateKey, formatTime, isSameDay } from '@/lib/calendar-utils'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_HEIGHT = 44
const WEEK_TIME_GUTTER = 48
const START_HOUR = 0
const END_HOUR = 24

type CalendarView = 'agenda' | 'week' | 'month'

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

function isSameMonth(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth()
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

function getReadableTextColor(backgroundColor: string) {
  const match = backgroundColor.match(/^#?([0-9a-f]{6})$/i)
  if (!match) return '#ffffff'

  const value = match[1]
  const red = parseInt(value.slice(0, 2), 16)
  const green = parseInt(value.slice(2, 4), 16)
  const blue = parseInt(value.slice(4, 6), 16)
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255

  return luminance > 0.62 ? '#111827' : '#ffffff'
}

function getAttendeeLabel(attendee: CalendarAttendee) {
  return attendee.name || attendee.email || 'Unknown attendee'
}

function buildMonthGrid(cursorDate: Date) {
  const first = startOfMonth(cursorDate)
  const gridStart = startOfWeek(first)
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

function groupEventsByDay(events: CalendarEvent[]) {
  return events.reduce<Record<string, CalendarEvent[]>>((groups, event) => {
    const key = eventDateKey(event)
    groups[key] = groups[key] ?? []
    groups[key].push(event)
    return groups
  }, {})
}

function getEventsForDay(events: CalendarEvent[], date: Date) {
  const key = dateKey(date)
  return events
    .filter((event) => eventDateKey(event) === key)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
}

function isAllDay(event: CalendarEvent) {
  return event.allDay
}

function eventDateKey(event: CalendarEvent) {
  if (event.allDay) {
    const d = new Date(event.start)
    return [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')].join('-')
  }
  return dateKey(new Date(event.start))
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
  onSelectNote,
}: {
  event: CalendarEvent
  onStartNote: (event: CalendarEvent) => Promise<void>
  onClose: () => void
  onSelectNote?: (id: string) => void
}) {
  const { selectNote } = useDashboardNotes()
  const [linkedNotes, setLinkedNotes] = useState<NoteRecord[]>([])
  const [linkedNotesLoading, setLinkedNotesLoading] = useState(false)
  const [linkedNotesLoadingMore, setLinkedNotesLoadingMore] = useState(false)
  const [linkedNotesHasMore, setLinkedNotesHasMore] = useState(false)
  const [linkedNotesCursor, setLinkedNotesCursor] = useState<string | undefined>(undefined)
  const [startingNote, setStartingNote] = useState(false)

  const canLinkNotes = Boolean(event.connectionId && event.calendarId && event.providerId)

  const refreshLinkedNotes = useCallback(async () => {
    if (!canLinkNotes) return
    setLinkedNotesLoading(true)
    try {
      const result = await listNotesByEvent(event.connectionId!, event.calendarId, event.providerId!)
      setLinkedNotes(result.notes)
      setLinkedNotesHasMore(result.hasMore)
      setLinkedNotesCursor(result.nextCursor)
    } catch {
      // silent
    } finally {
      setLinkedNotesLoading(false)
    }
  }, [canLinkNotes, event.connectionId, event.calendarId, event.providerId])

  const loadMoreLinkedNotes = useCallback(async () => {
    if (!canLinkNotes || linkedNotesLoadingMore || !linkedNotesHasMore) return
    setLinkedNotesLoadingMore(true)
    try {
      const result = await listNotesByEvent(event.connectionId!, event.calendarId, event.providerId!, linkedNotesCursor)
      setLinkedNotes((prev) => {
        const existing = new Set(prev.map((n) => n.id))
        return [...prev, ...result.notes.filter((n) => !existing.has(n.id))]
      })
      setLinkedNotesHasMore(result.hasMore)
      setLinkedNotesCursor(result.nextCursor)
    } catch {
      // silent
    } finally {
      setLinkedNotesLoadingMore(false)
    }
  }, [canLinkNotes, linkedNotesLoadingMore, linkedNotesHasMore, linkedNotesCursor, event.connectionId, event.calendarId, event.providerId])

  useEffect(() => {
    void refreshLinkedNotes()
  }, [refreshLinkedNotes])

  const handleStartNote = async () => {
    setStartingNote(true)
    try {
      await onStartNote(event)
      await refreshLinkedNotes()
    } finally {
      setStartingNote(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{event.title}</div>
          <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{event.allDay ? 'All day' : formatTimeRange(event)}</div>
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

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1 sidebar-scrollbar">
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
            {event.accountEmail ? (
              <div className="truncate">Account: {event.accountEmail}</div>
            ) : null}
          </div>
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold text-neutral-400">Attendees</div>
          {event.attendees.length > 0 ? (
            <div className="space-y-1.5">
              {event.attendees.slice(0, 8).map((attendee, index) => (
                <div
                  key={`${attendee.email || attendee.name || 'attendee'}-${index}`}
                  className="flex min-w-0 items-start gap-1.5 text-xs text-neutral-500 dark:text-neutral-400"
                >
                  <Users className="h-3.5 w-3.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate">{getAttendeeLabel(attendee)}</div>
                    {attendee.name && attendee.email ? (
                      <div className="truncate text-[11px] text-neutral-400 dark:text-neutral-500">{attendee.email}</div>
                    ) : null}
                  </div>
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

        {event.description ? (
          <section>
            <div className="mb-2 text-xs font-semibold text-neutral-400">Description</div>
            <div className="overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs leading-5 text-neutral-600 sidebar-scrollbar dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-300">
              {event.description}
            </div>
          </section>
        ) : null}

        {canLinkNotes ? (
          <section>
            <div className="mb-2 text-xs font-semibold text-neutral-400">Notes</div>
            {linkedNotesLoading ? (
              <div className="space-y-1">
                {[60, 80].map((w, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                    <div className="h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-neutral-200 dark:bg-white/15" />
                    <div className="h-3 animate-pulse rounded bg-neutral-200 dark:bg-white/15" style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
            ) : linkedNotes.length > 0 ? (
              <div className="space-y-0.5">
                {linkedNotes.map((note) => (
                  <NoteRow
                    key={note.id}
                    variant="sidebar"
                    title={note.title || 'Untitled'}
                    onClick={() => { selectNote(note.id); onSelectNote?.(note.id) }}
                  />
                ))}
                {linkedNotesHasMore ? (
                  <LoadMoreButton
                    isLoading={linkedNotesLoadingMore}
                    onClick={() => void loadMoreLinkedNotes()}
                  />
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

      </div>

      <div className="sticky bottom-0 mt-3 flex shrink-0 flex-wrap justify-center gap-1.5 border-t border-neutral-200 pt-3 dark:border-white/10">
        <Button type="button" variant="secondary" size="sm" disabled={startingNote} onClick={() => void handleStartNote()}>
          Start note
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

export function DashboardCalendar({
  onOpenCalendarSettings,
  onOpenNotes,
}: {
  onOpenCalendarSettings?: () => void
  onOpenNotes?: () => void
}) {
  const { createNewNote, selectNote } = useDashboardNotes()
  const { events, loading, error, syncing } = useCalendarEvents()
  const [view, setView] = useState<CalendarView>('week')
  const [cursorDate, setCursorDate] = useState(() => new Date())
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  useEffect(() => {
    setSelectedEvent((current) => {
      if (!current) return null
      return events.find((event) => event.id === current.id) ?? null
    })
  }, [events])

  const visibleEvents = events
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

  const handleStartNote = useCallback(async (event: CalendarEvent) => {
    const created = await createNewNote({
      title: event.title,
      eventLink: {
        providerEventId: event.providerId ?? '',
        connectionId: event.connectionId ?? '',
        calendarId: event.calendarId,
      },
    })
    if (created) {
      selectNote(created.id)
      onOpenNotes?.()
    }
  }, [createNewNote, selectNote, onOpenNotes])

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
              {syncing ? (
                <div className="flex items-center gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  <span>Syncing</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
            <Button
              type="button"
              onClick={onOpenCalendarSettings}
              variant="secondary"
              size="icon-sm"
              aria-label="Calendar settings"
              title="Calendar settings"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Button>
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
            <Button type="button" variant="secondary" size="icon-sm" aria-label="Previous" onClick={() => moveRange(-1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="secondary" size="icon-sm" aria-label="Next" onClick={() => moveRange(1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </DashboardPanelHeader>
      </DashboardPanel>

      <div className={cn('grid min-h-0 flex-1 gap-2', hasDetailsPanel && 'lg:grid-cols-[minmax(0,1fr)_304px]')}>
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
                <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">No upcoming meetings</p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Connected calendar meetings will appear here.</p>
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
                                  <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{event.allDay ? 'All day' : formatTimeRange(event)}</div>
                                  {event.accountEmail ? (
                                    <div className="mt-0.5 truncate text-xs text-neutral-400 dark:text-neutral-500">{event.accountEmail}</div>
                                  ) : null}
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
                    {weekDays.map((day) => {
                      const allDayEvents = getEventsForDay(visibleEvents, day).filter(isAllDay)
                      return (
                        <div key={dateKey(day)} className="px-2 py-2 text-center">
                          <div className="text-[10px] font-semibold uppercase text-neutral-400">{day.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                          <div className={cn('mx-auto mt-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold', isSameDay(day, new Date()) ? 'bg-[#7c3aed] text-white dark:bg-[#9f73f2]' : 'text-neutral-700 dark:text-neutral-200')}>
                            {day.getDate()}
                          </div>
                          {allDayEvents.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {allDayEvents.slice(0, 2).map((event) => (
                                <button
                                  key={event.id}
                                  type="button"
                                  onClick={() => toggleSelectedEvent(event)}
                                  className={cn(
                                    'w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium transition-[box-shadow,outline-color]',
                                    selectedEvent?.id === event.id && 'outline outline-2 outline-offset-1 outline-neutral-900/25 dark:outline-white/70',
                                  )}
                                  style={{
                                    backgroundColor: event.color,
                                    color: getReadableTextColor(event.color),
                                  }}
                                >
                                  {event.title}
                                </button>
                              ))}
                              {allDayEvents.length > 2 && (
                                <button
                                  type="button"
                                  onClick={() => openDayEvents(day)}
                                  className="w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium text-[#7c3aed] hover:bg-neutral-100 dark:text-[#9f73f2] dark:hover:bg-white/8"
                                >
                                  +{allDayEvents.length - 2} more
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
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
                        const dayEvents = positionWeekEvents(getEventsForDay(visibleEvents, day).filter((e) => !isAllDay(e)))
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
                                className={cn(
                                  'absolute overflow-hidden rounded-md border px-2 py-1 text-left shadow-sm transition-[box-shadow,outline-color]',
                                  selectedEvent?.id === event.id
                                    ? 'border-white outline outline-2 outline-offset-1 outline-neutral-900/25 dark:outline-white/70'
                                    : 'border-white/40',
                                )}
                                style={{
                                  top: event.top,
                                  height: event.height,
                                  left: `${event.left}%`,
                                  width: `calc(${event.width}% - 4px)`,
                                  backgroundColor: event.color,
                                  color: getReadableTextColor(event.color),
                                }}
                              >
                                <div className="truncate text-[11px] font-semibold">{event.title}</div>
                                {event.height > 28 && (
                                  <div className="truncate text-[10px] opacity-85">{formatTimeRange(event)}</div>
                                )}
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
                                  className={cn(
                                    'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] text-neutral-700 transition-colors hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-white/8',
                                    selectedEvent?.id === event.id && 'bg-neutral-100 ring-1 ring-neutral-300 dark:bg-white/10 dark:ring-white/20',
                                  )}
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
                  onStartNote={handleStartNote}
                  onClose={() => setSelectedEvent(null)}
                  onSelectNote={onOpenNotes}
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
