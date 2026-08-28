import { type CSSProperties, useMemo, useState } from 'react'

import { ArrowDownUp, ArrowUpDown, FileText, Plus, RefreshCw, Settings2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { NoteMenuContent } from '@/features/notes/NoteMenuContent'
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
import { NoteRow } from '@/features/notes/NoteRow'
import { LoadMoreButton } from '@/components/ui/load-more-button'
import { UpcomingMeetings } from '@/features/home/UpcomingMeetings'
import { useAuth } from '@/features/auth/AuthContext'
import { useDashboardNotes } from '@/features/notes/DashboardNotesContext'
import { useCalendarEvents } from '@/features/calendar/useCalendarEvents'
import { useActivityQuery } from '@/features/home/useActivityQuery'
import type { ActivityRecord, ActivityScope, ActivitySort, ActivitySortDirection } from '@/features/home/types'

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

export default function HomeView({
  onOpenCalendar,
  onOpenCalendarSettings,
}: {
  onOpenCalendar?: (eventId?: string) => void
  onOpenCalendarSettings?: () => void
}) {
  const { user } = useAuth()
  const { selectNote, openCreateNoteDialog, requestDeleteNote, renameNote, moveNote, folders } = useDashboardNotes()
  const [activitySort, setActivitySort] = useState<ActivitySort>('updated')
  const [activitySortDirection, setActivitySortDirection] = useState<ActivitySortDirection>('desc')
  const [activityScope, setActivityScope] = useState<ActivityScope>('owned')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showMove, setShowMove] = useState(false)
  const activityQuery = useActivityQuery(user?.id, {
    sort: activitySort,
    direction: activitySortDirection,
    scope: activityScope,
  })
  const activity = useMemo(
    () => activityQuery.data?.pages.flatMap((page) => page.activity) ?? [],
    [activityQuery.data],
  )

  const startRename = (noteId: string, currentTitle: string) => {
    setRenamingId(noteId)
    setRenameValue(currentTitle)
  }

  const commitRename = async (noteId: string) => {
    const val = renameValue.trim()
    setRenamingId(null)
    setRenameValue('')
    if (val) await renameNote(noteId, val)
  }

  const cancelRename = () => { setRenamingId(null); setRenameValue('') }
  const {
    events: calendarEvents,
    loading: calendarLoading,
    syncing: calendarSyncing,
    error: calendarError,
    lastError: calendarLastError,
    refresh: refreshCalendar,
  } = useCalendarEvents()

  const groupedActivity = useMemo(() => groupActivityByDate(activity), [activity])

  if (!user) return null

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* Coming Up */}
      <div>
        <DashboardPanel>
          <DashboardPanelHeader>
            <div className="flex min-w-0 items-baseline gap-2">
              <DashboardPanelTitle>Coming up</DashboardPanelTitle>
              {calendarSyncing ? (
                <div className="flex items-center gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  <span>Syncing</span>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                onClick={onOpenCalendarSettings}
                variant="secondary"
                size="icon-sm"
                aria-label="Calendar settings"
                title="Calendar settings"
                style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              >
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
              <Button
                onClick={() => onOpenCalendar?.()}
                variant="secondary"
                size="sm"
                style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
              >
                View all
              </Button>
            </div>
          </DashboardPanelHeader>
          <DashboardPanelBody>
            <UpcomingMeetings
              events={calendarEvents}
              loading={calendarLoading}
              failed={Boolean(calendarError || calendarLastError)}
              errorMessage={calendarError ?? calendarLastError}
              onRetry={() => void refreshCalendar()}
              onSelect={onOpenCalendar ? (event) => onOpenCalendar(event.id) : undefined}
            />
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
            <Select value={activitySort} onValueChange={(value) => setActivitySort(value as ActivitySort)}>
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
            <Select value={activityScope} onValueChange={(value) => setActivityScope(value as ActivityScope)}>
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
              onClick={openCreateNoteDialog}
              variant="secondary"
              size="sm"
              className="shrink-0"
              style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
            >
              <Plus className="h-3.5 w-3.5" />
              New note
            </Button>
          </div>
        </DashboardPanelHeader>

        <DashboardPanelBody className="min-h-0 flex-1">
          {activityQuery.isLoading ? (
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
          ) : groupedActivity.length > 0 ? (
            <div className="space-y-3">
              {groupedActivity.map((group) => (
                <div key={group.key}>
                  <div className="px-2.5 pb-1 text-xs font-semibold text-neutral-400">
                    {group.label}
                  </div>
                  <div className="space-y-0.5">
                    {group.items.map((item) => (
                      <NoteRow
                        key={item.id}
                        variant="card"
                        title={item.title || 'Untitled'}
                        onClick={item.noteId ? () => selectNote(item.noteId!) : undefined}
                        subtitle={item.actorLabel}
                        timestamp={formatActivityTime(item.timestamp)}
                        isRenaming={renamingId === item.noteId}
                        renameValue={renameValue}
                        onRenameChange={setRenameValue}
                        onRenameCommit={() => void commitRename(item.noteId!)}
                        onRenameCancel={cancelRename}
                        onMenuClose={() => setShowMove(false)}
                        menuContent={item.noteId ? (close) => (
                          <NoteMenuContent
                            noteId={item.noteId!}
                            noteTitle={item.title || 'Untitled'}
                            noteFolderId={item.folderId}
                            folders={folders}
                            showMove={showMove}
                            onShowMoveChange={setShowMove}
                            onRename={startRename}
                            onDelete={(id, title) => requestDeleteNote(id, title)}
                            onMove={(id, folderId) => void moveNote(id, folderId)}
                            close={close}
                          />
                        ) : undefined}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {activityQuery.hasNextPage ? (
                <LoadMoreButton
                  isLoading={activityQuery.isFetchingNextPage}
                  onClick={() => void activityQuery.fetchNextPage()}
                />
              ) : null}
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
