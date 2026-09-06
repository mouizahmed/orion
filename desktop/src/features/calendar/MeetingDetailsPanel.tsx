import { useEffect, useMemo, useRef, useState } from 'react'

import { ChevronDown, ExternalLink, FileText, Users, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DropdownPopover, dropdownItemClassName } from '@/components/ui/dropdown-list'
import { LoadMoreButton } from '@/components/ui/load-more-button'
import { NoteRow } from '@/features/notes/NoteRow'
import { useAuth } from '@/features/auth/AuthContext'
import { useDashboardNotes } from '@/features/notes/DashboardNotesContext'
import { useNotesByEventQuery } from '@/features/notes/queries/useNotesQueries'
import type { CalendarAttendee, CalendarEvent } from '@/features/calendar/useCalendarEvents'
import { publicAssetUrl } from '@/lib/public-asset'
import { formatTime } from '@/features/calendar/calendar-utils'
import { cn } from '@/lib/utils'

function formatTimeRange(event: CalendarEvent) {
  return `${formatTime(event.start)}-${formatTime(event.end)}`
}

function eventDisplayDate(event: CalendarEvent) {
  const date = new Date(event.start)
  if (event.allDay) {
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  }
  return date
}

function formatEventDate(event: CalendarEvent) {
  return eventDisplayDate(event).toLocaleDateString('en-US', {
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
      icon: publicAssetUrl('google-calendar-icon.svg'),
    }
  }

  if (event.provider === 'microsoft') {
    return {
      label: 'Outlook',
      icon: publicAssetUrl('microsoft-outlook-icon.svg'),
    }
  }

  return {
    label: 'Calendar',
    icon: null,
  }
}

export function MeetingDetailsPanel({
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
  const { user } = useAuth()
  const linkedNotesQuery = useNotesByEventQuery(user?.id, event.id)
  const linkedNotes = useMemo(
    () => linkedNotesQuery.data?.pages.flatMap((page) => page.notes) ?? [],
    [linkedNotesQuery.data],
  )
  const [startingNote, setStartingNote] = useState(false)
  const [attendeesExpanded, setAttendeesExpanded] = useState(false)
  const attendeesRef = useRef<HTMLElement | null>(null)

  const calendarAction = getEventCalendarAction(event)
  const description = event.description ? normalizeDescription(event.description) : ''

  useEffect(() => {
    if (!attendeesExpanded) return

    const closeOnPointerDown = (pointerEvent: PointerEvent) => {
      if (!attendeesRef.current?.contains(pointerEvent.target as Node)) {
        setAttendeesExpanded(false)
      }
    }
    const closeOnEscape = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') setAttendeesExpanded(false)
    }

    document.addEventListener('pointerdown', closeOnPointerDown)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [attendeesExpanded])

  const handleStartNote = async () => {
    if (linkedNotes.length > 0) {
      selectNote(linkedNotes[0].id)
      onSelectNote?.(linkedNotes[0].id)
      return
    }
    setStartingNote(true)
    try {
      await onStartNote(event)
      await linkedNotesQuery.refetch()
    } finally {
      setStartingNote(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{event.title}</div>
          <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {formatEventDate(event)} · {event.allDay ? 'All day' : formatTimeRange(event)}
          </div>
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

      <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        <section>
          <div className="mb-2 text-xs font-semibold text-neutral-400">Details</div>
          <dl className="space-y-1.5 text-xs">
            {event.location ? (
              <div className="flex min-w-0 items-baseline gap-3">
                <dt className="w-20 shrink-0 text-neutral-400 dark:text-neutral-500">Location</dt>
                <dd className="min-w-0 flex-1 truncate text-right text-neutral-700 dark:text-neutral-300">{event.location}</dd>
              </div>
            ) : null}
            {event.organizerName || event.organizerEmail ? (
              <div className="flex min-w-0 items-baseline gap-3">
                <dt className="w-20 shrink-0 text-neutral-400 dark:text-neutral-500">Organizer</dt>
                <dd className="min-w-0 flex-1 truncate text-right text-neutral-700 dark:text-neutral-300">
                  {event.organizerName || event.organizerEmail}
                </dd>
              </div>
            ) : null}
            <div className="flex min-w-0 items-baseline gap-3">
              <dt className="w-20 shrink-0 text-neutral-400 dark:text-neutral-500">Calendar</dt>
              <dd className="min-w-0 flex-1 truncate text-right text-neutral-700 dark:text-neutral-300">{event.calendarName}</dd>
            </div>
            {event.accountEmail ? (
              <div className="flex min-w-0 items-baseline gap-3">
                <dt className="w-20 shrink-0 text-neutral-400 dark:text-neutral-500">Account</dt>
                <dd className="min-w-0 flex-1 truncate text-right text-neutral-700 dark:text-neutral-300">{event.accountEmail}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section ref={attendeesRef} className="relative">
          <Button
            type="button"
            variant="ghost"
            aria-expanded={attendeesExpanded}
            aria-controls="meeting-attendees-list"
            onClick={() => setAttendeesExpanded((expanded) => !expanded)}
            className="flex w-full items-center justify-between rounded-md px-1.5 text-left text-neutral-400 hover:bg-neutral-100/70 hover:text-neutral-600 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-300"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="text-xs font-semibold">Attendees</span>
              <span className="text-[11px] font-normal text-neutral-400 dark:text-neutral-500">({event.attendees.length})</span>
            </span>
            <ChevronDown
              className={cn(
                'h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none',
                attendeesExpanded && 'rotate-180',
              )}
            />
          </Button>
          {attendeesExpanded ? (
            <DropdownPopover
              id="meeting-attendees-list"
              align="end"
              width="lg"
              role="list"
              aria-label="Meeting attendees"
              className="max-h-56 w-full min-w-0 overflow-y-auto sidebar-scrollbar"
            >
              {event.attendees.length > 0 ? (
                event.attendees.map((attendee, index) => (
                  <div
                    key={`${attendee.email || attendee.name || 'attendee'}-${index}`}
                    role="listitem"
                    className={dropdownItemClassName({ layout: 'multiline', className: 'cursor-default' })}
                  >
                    <Users className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
                    <div className="min-w-0">
                      <div className="truncate">{getAttendeeLabel(attendee)}</div>
                      {attendee.name && attendee.email ? (
                        <div className="truncate text-[11px] text-neutral-400 dark:text-neutral-500">{attendee.email}</div>
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-3 py-2 text-xs text-neutral-400 dark:text-neutral-500">No attendees listed</div>
              )}
            </DropdownPopover>
          ) : null}
        </section>

        {description ? (
          <section className="flex min-h-0 flex-1 flex-col">
            <div className="mb-2 shrink-0 text-xs font-semibold text-neutral-400">Description</div>
            <div className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs leading-5 text-neutral-600 sidebar-scrollbar dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-300">
              {renderLinkedText(description)}
            </div>
          </section>
        ) : null}

        <section>
          <div className="mb-2 text-xs font-semibold text-neutral-400">Note</div>
          {linkedNotesQuery.isLoading ? (
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
              {linkedNotesQuery.hasNextPage ? (
                <LoadMoreButton
                  isLoading={linkedNotesQuery.isFetchingNextPage}
                  onClick={() => void linkedNotesQuery.fetchNextPage()}
                />
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-neutral-200 px-3 py-2.5 text-xs text-neutral-500 dark:border-white/10 dark:text-neutral-400">
              <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
              <span>No note yet</span>
            </div>
          )}
        </section>
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
