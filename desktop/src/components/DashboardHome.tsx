import { type CSSProperties, useState } from 'react'

import { FileText, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { UpcomingMeetings } from '@/components/UpcomingMeetings'
import { useAuth } from '@/contexts/AuthContext'
import { useDashboardNotes, excerpt } from '@/contexts/DashboardNotesContext'

function relativeTime(timestamp: number) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function DashboardHome() {
  const { user } = useAuth()
  const { notes, isLoading, selectNote, createNewNote } = useDashboardNotes()
  const [showOnlyMeetings, setShowOnlyMeetings] = useState(false)

  if (!user) return null

  const recentNotes = [...notes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Coming Up */}
      <div className="rounded-lg border border-white/10 bg-[#171417]/80 px-2.5 py-2 backdrop-blur-md">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
            Coming up
          </h2>
          <Button
            onClick={() => setShowOnlyMeetings(!showOnlyMeetings)}
            variant="ghost"
            size="sm"
            className="h-8 rounded-full border border-white/12 bg-white/5 px-3 text-xs text-neutral-300 hover:bg-white/10 hover:text-white"
            style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          >
            {showOnlyMeetings ? 'Show All' : 'Meetings Only'}
          </Button>
        </div>
        <UpcomingMeetings showOnlyMeetings={showOnlyMeetings} />
      </div>

      {/* Recent Activity */}
      <div className="flex-1 overflow-hidden rounded-lg border border-white/10 bg-[#171417]/80 backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-white/10 px-2.5 py-2">
          <h2 className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
            Recent Activity
          </h2>
          <Button
            onClick={() => void createNewNote()}
            size="sm"
            className="h-8 gap-1.5 rounded-full bg-violet-600 px-3 text-xs text-white hover:bg-violet-700"
          >
            <Plus className="h-3.5 w-3.5" />
            New note
          </Button>
        </div>

        <div className="overflow-y-auto p-1 sidebar-scrollbar">
          {isLoading ? (
            <div className="space-y-1 px-1 py-1">
              {[70, 50, 85, 60, 75].map((w, i) => (
                <div key={i} className="flex items-start gap-2.5 px-2.5 py-2">
                  <div className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="h-3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" style={{ width: `${w}%` }} />
                      <div className="h-2.5 w-8 shrink-0 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                    </div>
                    <div className="h-2.5 w-full animate-pulse rounded bg-neutral-100 dark:bg-neutral-800" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentNotes.length > 0 ? (
            <div className="space-y-0.5">
              {recentNotes.map((note) => (
                <div
                  key={note.id}
                  onClick={() => selectNote(note.id)}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-white/8"
                >
                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                        {note.title || 'Untitled'}
                      </span>
                      <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
                        {relativeTime(note.updatedAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                      {excerpt(note.noteMarkdown)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-2.5 py-2 text-xs text-neutral-500 dark:text-neutral-400">
              No recent activity
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
