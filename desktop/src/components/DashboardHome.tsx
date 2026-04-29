import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ArrowDownUp, ArrowUpDown, CalendarDays, FileText, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DashboardPanel,
  DashboardPanelBody,
  DashboardPanelHeader,
  DashboardPanelTitle,
} from '@/components/ui/dashboard-panel'
import { DashboardIconTile, DashboardRow } from '@/components/ui/dashboard-row'
import { UpcomingMeetings } from '@/components/UpcomingMeetings'
import { useAuth } from '@/contexts/AuthContext'
import { useDashboardNotes } from '@/contexts/DashboardNotesContext'
import { listActivityPage } from '@/lib/activity-client'
import type { ActivityRecord } from '@/types/activity'

const ACTIVITY_REFRESH_EVENT = 'dashboard-activity-refresh'
const CALENDAR_FOCUS_EVENT = 'dashboard-calendar-focus'
const CALENDAR_OPEN_EVENT = 'dashboard-calendar-open'

function formatActivityDate(timestamp: number) {
  const date = new Date(timestamp)
  const now = new Date()
  const sameYear = date.getFullYear() === now.getFullYear()

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

function formatActivityTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function activityDateKey(timestamp: number) {
  const date = new Date(timestamp)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function groupActivityByDate(activity: ActivityRecord[]) {
  return activity.reduce<Array<{ key: string; label: string; items: ActivityRecord[] }>>((groups, item) => {
    const key = activityDateKey(item.timestamp)
    const existing = groups.find((group) => group.key === key)
    if (existing) {
      existing.items.push(item)
    } else {
      groups.push({ key, label: formatActivityDate(item.timestamp), items: [item] })
    }
    return groups
  }, [])
}

export default function DashboardHome() {
  const { user } = useAuth()
  const { selectNote, createNewNote } = useDashboardNotes()
  const calendarPanelRef = useRef<HTMLDivElement | null>(null)
  const [showOnlyMeetings, setShowOnlyMeetings] = useState(false)
  const [activitySort, setActivitySort] = useState('updated')
  const [activitySortDirection, setActivitySortDirection] = useState<'asc' | 'desc'>('desc')
  const [activityScope, setActivityScope] = useState('owned')
  const [activity, setActivity] = useState<ActivityRecord[]>([])
  const [activityLoading, setActivityLoading] = useState(true)
  const [activityError, setActivityError] = useState<string | null>(null)

  const loadActivity = useCallback(async () => {
    setActivityLoading(true)
    setActivityError(null)
    try {
      const page = await listActivityPage({ limit: 20 })
      setActivity(page.activity)
    } catch (error) {
      setActivity([])
      setActivityError(error instanceof Error ? error.message : 'Failed to load activity')
    } finally {
      setActivityLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    void loadActivity()

    window.addEventListener(ACTIVITY_REFRESH_EVENT, loadActivity)
    return () => {
      window.removeEventListener(ACTIVITY_REFRESH_EVENT, loadActivity)
    }
  }, [loadActivity, user])

  useEffect(() => {
    const handleCalendarFocus = () => {
      calendarPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }

    window.addEventListener(CALENDAR_FOCUS_EVENT, handleCalendarFocus)
    return () => {
      window.removeEventListener(CALENDAR_FOCUS_EVENT, handleCalendarFocus)
    }
  }, [])

  const groupedActivity = useMemo(() => groupActivityByDate(activity), [activity])

  const handleCreateNewNote = async () => {
    const created = await createNewNote()
    if (created) {
      void loadActivity()
    }
  }

  if (!user) return null

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Coming Up */}
      <div ref={calendarPanelRef}>
        <DashboardPanel>
          <DashboardPanelHeader>
            <DashboardPanelTitle>Coming up</DashboardPanelTitle>
            <div className="flex items-center gap-1.5">
              <Button
                onClick={() => {
                  window.dispatchEvent(new Event(CALENDAR_OPEN_EVENT))
                }}
                variant="secondary"
                size="sm"
                style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                View calendar
              </Button>
              <Button
                onClick={() => setShowOnlyMeetings(!showOnlyMeetings)}
                variant="secondary"
                size="sm"
                style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              >
                {showOnlyMeetings ? 'Show All' : 'Meetings Only'}
              </Button>
            </div>
          </DashboardPanelHeader>
          <DashboardPanelBody>
            <UpcomingMeetings showOnlyMeetings={showOnlyMeetings} />
          </DashboardPanelBody>
        </DashboardPanel>
      </div>

      {/* Recent Activity */}
      <DashboardPanel className="flex min-h-0 flex-1 flex-col">
        <DashboardPanelHeader>
          <div className="min-w-0">
            <DashboardPanelTitle>Recent Activity</DashboardPanelTitle>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={activitySortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
              title={activitySortDirection === 'asc' ? 'Sort ascending' : 'Sort descending'}
              onClick={() => {
                setActivitySortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'))
              }}
              style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
            >
              {activitySortDirection === 'asc' ? (
                <ArrowUpDown className="h-3.5 w-3.5" />
              ) : (
                <ArrowDownUp className="h-3.5 w-3.5" />
              )}
            </Button>
            <Select value={activitySort} onValueChange={setActivitySort}>
              <SelectTrigger
                size="sm"
                aria-label="Sort recent activity"
                style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="updated">Last updated</SelectItem>
                <SelectItem value="created">Created</SelectItem>
                <SelectItem value="title">Title</SelectItem>
              </SelectContent>
            </Select>
            <Select value={activityScope} onValueChange={setActivityScope}>
              <SelectTrigger
                size="sm"
                aria-label="Filter recent activity"
                style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="owned">Mine</SelectItem>
                <SelectItem value="shared">Shared</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => void handleCreateNewNote()}
              variant="secondary"
              size="sm"
              className="shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              New note
            </Button>
          </div>
        </DashboardPanelHeader>

        <DashboardPanelBody className="min-h-0 flex-1">
          {activityLoading ? (
            <div className="space-y-0.5">
              {[70, 50, 85, 60, 75].map((w, i) => (
                <div key={i} className="flex items-start gap-2.5 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-2 dark:border-white/8 dark:bg-white/[0.03]">
                  <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg border border-neutral-200 bg-neutral-200/70 dark:border-white/10 dark:bg-white/8" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="h-3 animate-pulse rounded bg-neutral-200 dark:bg-white/15" style={{ width: `${w}%` }} />
                      <div className="h-2.5 w-8 shrink-0 animate-pulse rounded bg-neutral-200 dark:bg-white/10" />
                    </div>
                    <div className="h-2.5 w-full animate-pulse rounded bg-neutral-100 dark:bg-white/8" />
                  </div>
                </div>
              ))}
            </div>
          ) : activityError ? (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Failed to load activity</p>
            </div>
          ) : groupedActivity.length > 0 ? (
            <div className="space-y-3">
              {groupedActivity.map((group) => (
                <div key={group.key}>
                  <div className="px-2.5 pb-1 text-xs font-semibold text-neutral-400">
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((item) => (
                      <DashboardRow
                        key={item.id}
                        onClick={() => item.noteId ? selectNote(item.noteId) : undefined}
                        interactive={Boolean(item.noteId)}
                        className="items-center"
                      >
                        <DashboardIconTile className="h-8 w-8">
                          <FileText className="h-4 w-4" />
                        </DashboardIconTile>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <span className="block truncate text-xs font-medium leading-4 text-neutral-800 dark:text-neutral-200">
                                {item.title || 'Untitled'}
                              </span>
                              {item.actorLabel ? (
                                <span className="block truncate text-xs leading-4 text-neutral-500 dark:text-neutral-400">
                                  {item.actorLabel}
                                </span>
                              ) : null}
                            </div>
                            <span className="shrink-0 text-xs leading-4 text-neutral-400 dark:text-neutral-500">
                              {formatActivityTime(item.timestamp)}
                            </span>
                          </div>
                        </div>
                      </DashboardRow>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-h-24 flex-col items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-5 text-center dark:border-white/10 dark:bg-white/[0.03]">
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100 text-neutral-500 dark:border-white/10 dark:bg-white/5 dark:text-neutral-400">
                <FileText className="h-4 w-4" />
              </div>
              <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">No recent activity</p>
              <p className="mt-1 text-xs text-neutral-500">New notes will appear here</p>
            </div>
          )}
        </DashboardPanelBody>
      </DashboardPanel>
    </div>
  )
}
