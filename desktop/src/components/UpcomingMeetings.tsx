import { useCallback, useEffect, useRef, useState } from 'react'

import { MapPin, Users } from 'lucide-react'

import { DashboardRow } from '@/components/ui/dashboard-row'
import { auth } from '@/config/firebase'
import { useAuth } from '@/contexts/AuthContext'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'

interface Meeting {
  id: string
  title: string
  start: string
  end: string
  location?: string
  organizer?: string
  provider: string
  is_meeting: boolean
  attendees?: string[]
}

interface CalendarEvent {
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

function formatMeetingDate(startTime: string) {
  const date = new Date(startTime)
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  const day = date.getDate()
  return { month, day: day.toString() }
}

function formatTime(startTime: string) {
  const date = new Date(startTime)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatMeetingTime(startTime: string, endTime: string) {
  return `${formatTime(startTime)}-${formatTime(endTime)}`
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

interface UpcomingMeetingsProps {
  showOnlyMeetings: boolean
}

const POLL_INTERVAL = 2 * 60 * 1000 // 2 minutes
const CALENDAR_REFRESH_EVENT = 'dashboard-calendar-refresh'

export function UpcomingMeetings({ showOnlyMeetings }: UpcomingMeetingsProps) {
  const { user } = useAuth()
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const cacheKey = user ? `calendar_events_${user.id}` : null

  const fetchUpcomingMeetings = useCallback(async (silent: boolean, force = false) => {
    if (!user) return

    try {
      if (!silent) {
        setLoading(true)
        setError(null)
      }

      if (cacheKey && !force) {
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          const { data, timestamp } = JSON.parse(cached)
          if (Date.now() - timestamp < POLL_INTERVAL) {
            if (!cancelledRef.current) {
              setMeetings(data)
              if (!silent) setLoading(false)
            }
            return
          }
        }
      }

      const currentUser = auth.currentUser
      if (!currentUser) throw new Error('Not authenticated')
      const idToken = await currentUser.getIdToken()

      const response = await fetch(`${API_BASE_URL}/calendar/upcoming?limit=3`, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch calendar events: ${response.status}`)
      }

      const data = await response.json()

      if (cancelledRef.current) return

      if (data.status === 'success' && data.events) {
        const formattedMeetings: Meeting[] = data.events.map((event: CalendarEvent) => ({
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          location: event.location,
          organizer: event.organizer,
          provider: event.provider,
          is_meeting: event.is_meeting,
          attendees: event.attendees,
        }))

        setMeetings(formattedMeetings)

        if (cacheKey) {
          localStorage.setItem(cacheKey, JSON.stringify({ data: formattedMeetings, timestamp: Date.now() }))
        }
      } else {
        setMeetings([])
      }
    } catch (err) {
      if (!cancelledRef.current && !silent) {
        setError(err instanceof Error ? err.message : 'Failed to fetch meetings')
        setMeetings([])
      }
    } finally {
      if (!cancelledRef.current && !silent) setLoading(false)
    }
  }, [user, cacheKey])

  useEffect(() => {
    cancelledRef.current = false

    if (!user) {
      setMeetings([])
      setLoading(false)
      return
    }

    void fetchUpcomingMeetings(false)

    const interval = window.setInterval(() => {
      void fetchUpcomingMeetings(true)
    }, POLL_INTERVAL)
    const handleCalendarRefresh = () => {
      void fetchUpcomingMeetings(false, true)
    }

    window.addEventListener(CALENDAR_REFRESH_EVENT, handleCalendarRefresh)

    return () => {
      cancelledRef.current = true
      window.clearInterval(interval)
      window.removeEventListener(CALENDAR_REFRESH_EVENT, handleCalendarRefresh)
    }
  }, [user, fetchUpcomingMeetings])

  const filteredMeetings = showOnlyMeetings
    ? meetings.filter((m) => m.is_meeting)
    : meetings
  const today = new Date()
  const todayKey = dateKey(today)
  const groupedMeetings = filteredMeetings.reduce<Array<{ key: string; date: Date; meetings: Meeting[] }>>(
    (groups, meeting) => {
      const date = new Date(meeting.start)
      const key = dateKey(date)
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
            <div className="flex h-9 w-9 shrink-0 flex-col items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-1.5 py-1">
              <div className="h-2 w-6 animate-pulse rounded bg-white/15" />
              <div className="h-3 w-4 animate-pulse rounded bg-white/15" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
              <div className="h-3 animate-pulse rounded bg-white/15" style={{ width: `${w}%` }} />
              <div className="h-2.5 w-32 animate-pulse rounded bg-white/8" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-center">
        <p className="text-xs text-neutral-400">
          Calendar integration coming soon
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="space-y-0.5">
        {groupedMeetings.map((group) => {
          const { month, day } = formatMeetingDate(group.date.toISOString())
          const isToday = isSameDay(group.date, today)

          return (
            <DashboardRow
              key={group.key}
            >
              <div className="flex h-9 w-9 shrink-0 flex-col items-center overflow-hidden rounded-lg border border-white/10 bg-white/5 text-center">
                <div className="w-full border-b border-white/10 bg-white/8 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-neutral-300">
                  {month}
                </div>
                <div className="flex flex-1 items-center px-1.5 text-sm font-semibold leading-none text-neutral-100">{day}</div>
              </div>
              <div className="min-w-0 flex-1 space-y-2 py-0.5">
                {group.meetings.length === 0 ? (
                  <div className="flex min-h-9 items-center border-l-2 border-white/15 pl-3 text-xs font-medium text-neutral-400">
                    {isToday ? 'No events today' : 'No events'}
                  </div>
                ) : (
                  group.meetings.map((meeting) => (
                    <div key={meeting.id} className="min-w-0 border-l-2 border-[#9f73f2]/55 pl-3">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-medium text-neutral-100">
                          {meeting.title}
                        </span>
                        {meeting.is_meeting && (
                          <span className="shrink-0 rounded-full border border-white/12 bg-white/5 px-1.5 py-0.5 text-[10px] leading-none text-neutral-300">
                            Meeting
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-400">
                        {formatMeetingTime(meeting.start, meeting.end)}
                      </p>
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
                  ))
                )}
              </div>
            </DashboardRow>
          )
        })}
      </div>
    </div>
  )
}
