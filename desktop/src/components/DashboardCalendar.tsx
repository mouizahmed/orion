import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { CalendarDays, ExternalLink, MapPin, RefreshCw, Settings2, Users, X } from 'lucide-react'

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
import { CalendarEventRow } from '@/components/CalendarEventRow'
import { cn } from '@/lib/utils'
import { dateKey, formatTime } from '@/lib/calendar-utils'

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
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

function getAttendeeLabel(attendee: CalendarAttendee) {
  return attendee.name || attendee.email || 'Unknown attendee'
}

function normalizeDescription(description: string) {
  if (!/<[a-z][\s\S]*>/i.test(description) || typeof DOMParser === 'undefined') {
    return description
  }

  const document = new DOMParser().parseFromString(description, 'text/html')

  document.body.querySelectorAll('br').forEach((node) => {
    node.replaceWith(document.createTextNode('\n'))
  })

  document.body.querySelectorAll('p, div, li').forEach((node) => {
    node.append(document.createTextNode('\n'))
  })

  document.body.querySelectorAll('a').forEach((node) => {
    const href = node.getAttribute('href')?.trim()
    const text = node.textContent?.trim()
    const label = href && (!text || text === href) ? href : [text, href ? `(${href})` : ''].filter(Boolean).join(' ')
    node.replaceWith(document.createTextNode(label))
  })

  return document.body.textContent
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function renderLinkedText(text: string) {
  const parts = text.split(/(https?:\/\/[^\s<>"')]+)/gi)

  return parts.map((part, index) => {
    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={`${part}-${index}`}
          href={part}
          target="_blank"
          rel="noreferrer"
          className="text-[#7c3aed] underline-offset-2 hover:underline dark:text-[#bda1ff]"
        >
          {part}
        </a>
      )
    }

    return part
  })
}

function getEventCalendarAction(event: CalendarEvent) {
  if (event.provider === 'google') {
    return {
      label: 'Google Calendar',
      icon: '/google-calendar-icon.svg',
    }
  }

  if (event.provider === 'microsoft') {
    return {
      label: 'Outlook',
      icon: '/microsoft-outlook-icon.svg',
    }
  }

  return {
    label: 'Calendar',
    icon: null,
  }
}

function groupEventsByDay(events: CalendarEvent[]) {
  return events.reduce<Record<string, CalendarEvent[]>>((groups, event) => {
    const key = eventDateKey(event)
    groups[key] = groups[key] ?? []
    groups[key].push(event)
    return groups
  }, {})
}

function eventDateKey(event: CalendarEvent) {
  if (event.allDay) {
    const d = new Date(event.start)
    return [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')].join('-')
  }
  return dateKey(new Date(event.start))
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
  const calendarAction = getEventCalendarAction(event)
  const description = event.description ? normalizeDescription(event.description) : ''

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
    if (linkedNotes.length > 0) {
      selectNote(linkedNotes[0].id)
      onSelectNote?.(linkedNotes[0].id)
      return
    }
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

        {description ? (
          <section>
            <div className="mb-2 text-xs font-semibold text-neutral-400">Description</div>
            <div className="overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs leading-5 text-neutral-600 sidebar-scrollbar dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-300">
              {renderLinkedText(description)}
            </div>
          </section>
        ) : null}

        {canLinkNotes ? (
          <section>
            <div className="mb-2 text-xs font-semibold text-neutral-400">Note</div>
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

      <div className="sticky bottom-0 mt-3 flex shrink-0 items-center justify-between border-t border-neutral-200 pt-3 dark:border-white/10">
        <div className="flex gap-1.5">
          {event.eventLink ? (
            <Button type="button" variant="secondary" size="sm" asChild title={calendarAction.label}>
              <a href={event.eventLink} target="_blank" rel="noreferrer">
                {calendarAction.icon ? (
                  <img src={calendarAction.icon} alt={calendarAction.label} className="h-3.5 w-3.5" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
              </a>
            </Button>
          ) : null}
          {event.meetingLink ? (
            <Button type="button" variant="secondary" size="sm" asChild>
              <a href={event.meetingLink} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Join
              </a>
            </Button>
          ) : null}
        </div>
        <Button type="button" variant="secondary" size="sm" disabled={startingNote} onClick={() => void handleStartNote()}>
          {linkedNotes.length > 0 ? 'Open note' : 'Start note'}
        </Button>
      </div>
    </div>
  )
}

export function DashboardCalendar({
  onOpenCalendarSettings,
  onOpenNotes,
  initialSelectedEventId,
}: {
  onOpenCalendarSettings?: () => void
  onOpenNotes?: () => void
  initialSelectedEventId?: string | null
}) {
  const { createNewNote, selectNote } = useDashboardNotes()
  const { events, loading, error, syncing } = useCalendarEvents()
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const consumedInitialEventRef = useRef<string | null>(null)

  useEffect(() => {
    setSelectedEvent((current) => {
      if (!current) return null
      return events.find((event) => event.id === current.id) ?? null
    })
  }, [events])

  useEffect(() => {
    if (!initialSelectedEventId) return
    if (consumedInitialEventRef.current === initialSelectedEventId) return
    if (events.length === 0) return
    const event = events.find((e) => e.id === initialSelectedEventId)
    if (event) {
      setSelectedEvent(event)
      consumedInitialEventRef.current = initialSelectedEventId
    }
  }, [initialSelectedEventId, events])

  const visibleEvents = events
  const eventsByDay = useMemo(() => groupEventsByDay(visibleEvents), [visibleEvents])
  const visibleAgendaDays = useMemo(() => {
    const today = startOfDay(new Date())
    return Object.entries(eventsByDay)
      .map(([key, dayEvents]) => ({ key, date: new Date(`${key}T00:00:00`), events: dayEvents }))
      .filter((group) => group.date.getTime() >= today.getTime())
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 14)
  }, [eventsByDay])

  const toggleSelectedEvent = (event: CalendarEvent) => {
    setSelectedEvent((current) => (current?.id === event.id ? null : event))
  }
  const hasDetailsPanel = Boolean(selectedEvent)

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
    <div className="flex h-full min-h-0 gap-2">
      <DashboardPanel className="flex min-w-0 flex-1 flex-col">
        <DashboardPanelHeader>
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex min-w-0 items-baseline gap-2">
              <DashboardPanelTitle>Calendar</DashboardPanelTitle>
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
          </div>
        </DashboardPanelHeader>
        <DashboardPanelBody className="min-h-0 flex-1 p-0">
          {loading ? (
            <div className="space-y-3 p-1">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index}>
                  <div className="mb-1 h-3 w-28 animate-pulse rounded bg-neutral-200 dark:bg-white/15" />
                  <div className="space-y-0.5">
                    {[78, 64].map((width, row) => (
                      <div key={row} className="flex items-center gap-3 rounded-lg px-2.5 py-2">
                        <div className="h-8 w-1 animate-pulse rounded-full bg-neutral-200 dark:bg-white/15" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="h-3 animate-pulse rounded bg-neutral-200 dark:bg-white/15" style={{ width: `${width}%` }} />
                          <div className="h-2.5 w-32 animate-pulse rounded bg-neutral-100 dark:bg-white/8" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : visibleEvents.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <CalendarDays className="mb-2 h-5 w-5 text-neutral-400" />
              <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">No upcoming meetings</p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Connected calendar meetings will appear here.</p>
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-1 sidebar-scrollbar">
              {visibleAgendaDays.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-neutral-500">No upcoming events</div>
              ) : (
                <div className="space-y-3">
                  {visibleAgendaDays.map((group) => (
                    <div key={group.key}>
                      <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">{formatDayHeading(group.date)}</div>
                      <div className="space-y-0.5">
                        {group.events.map((event) => (
                          <CalendarEventRow
                            key={event.id}
                            event={event}
                            selected={selectedEvent?.id === event.id}
                            onClick={() => toggleSelectedEvent(event)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DashboardPanelBody>
      </DashboardPanel>

      <div
        className={cn(
          'flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
          hasDetailsPanel ? 'w-[304px]' : 'w-0',
        )}
      >
        <DashboardPanel className="h-full min-h-0 w-[304px]">
          <DashboardPanelBody className="h-full min-h-0 p-2">
            {selectedEvent ? (
              <EventDetail
                event={selectedEvent}
                onStartNote={handleStartNote}
                onClose={() => setSelectedEvent(null)}
                onSelectNote={onOpenNotes}
              />
            ) : null}
          </DashboardPanelBody>
        </DashboardPanel>
      </div>
    </div>
  )
}
