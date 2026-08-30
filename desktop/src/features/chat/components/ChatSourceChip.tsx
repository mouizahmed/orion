import { useState, type ComponentType } from 'react'
import {
  CalendarDays,
  FileText,
  Folder,
  Globe2,
  Link2Off,
  NotebookText,
  ScrollText,
  UserRound,
  UsersRound,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChatSource, ChatSourceKind } from '@/features/chat/chat-ui-types'

type ChatSourceChipProps = {
  source: ChatSource
  onOpen?: (source: ChatSource) => void
  showPreview?: boolean
  className?: string
}

const sourceIcons: Record<ChatSourceKind, ComponentType<{ className?: string }>> = {
  note: NotebookText,
  summary: FileText,
  transcript: ScrollText,
  person: UserRound,
  meeting: UsersRound,
  calendar_event: CalendarDays,
  attendee: UserRound,
  folder: Folder,
  web: Globe2,
}

const sourceLabels: Record<ChatSourceKind, string> = {
  note: 'Note',
  summary: 'Summary',
  transcript: 'Transcript',
  person: 'Person',
  meeting: 'Meeting',
  calendar_event: 'Event',
  attendee: 'Attendee',
  folder: 'Folder',
  web: 'Web',
}

const unavailableLabels: Record<Exclude<ChatSource['availability'], undefined | 'available'>, string> = {
  missing: 'Source unavailable',
  deleted: 'Source deleted',
  inaccessible: 'Source inaccessible',
}

function sourceMeta(source: ChatSource) {
  if (source.availability && source.availability !== 'available') return unavailableLabels[source.availability]
  if (source.kind === 'web') return source.domain || 'Web source'
  if (source.kind === 'calendar_event') {
    const timing = source.allDay && source.eventStart
      ? `All day · ${new Date(source.eventStart).toLocaleDateString()}`
      : source.eventStart
        ? new Date(source.eventStart).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
        : 'Calendar event'
    const context = [source.calendarName, source.recurring ? 'Recurring' : null, source.eventStatus && source.eventStatus !== 'confirmed' ? source.eventStatus : null]
      .filter(Boolean)
      .join(' · ')
    return context ? `${timing} · ${context}` : timing
  }
  return source.locationLabel || sourceLabels[source.kind]
}

function ChipContents({ source }: { source: ChatSource }) {
  const [faviconFailed, setFaviconFailed] = useState(false)
  const Icon = sourceIcons[source.kind]
  const unavailable = source.availability && source.availability !== 'available'

  return (
    <>
      {(source.citationIndices?.length ? source.citationIndices : source.citationIndex ? [source.citationIndex] : []).map((index) => (
        <span key={index} className="flex h-4 min-w-4 items-center justify-center rounded-full bg-neutral-200 px-1 text-[9px] font-semibold text-neutral-600 dark:bg-white/10 dark:text-neutral-300">
          {index}
        </span>
      ))}
      {unavailable ? (
        <Link2Off className="h-3 w-3 shrink-0" />
      ) : source.kind === 'web' && source.faviconUrl && !faviconFailed ? (
        <img
          src={source.faviconUrl}
          alt=""
          className="h-3 w-3 shrink-0 rounded-sm"
          onError={() => setFaviconFailed(true)}
        />
      ) : (
        <Icon className="h-3 w-3 shrink-0" />
      )}
      <span className="min-w-0 truncate">{source.title}</span>
      <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">{sourceMeta(source)}</span>
    </>
  )
}

export default function ChatSourceChip({ source, onOpen, showPreview = false, className }: ChatSourceChipProps) {
  const unavailable = Boolean(source.availability && source.availability !== 'available')
  const baseClassName = cn(
    'inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-neutral-200 bg-white/70 px-2.5 text-[11px] text-neutral-600 outline-none dark:border-white/10 dark:bg-white/5 dark:text-neutral-300',
    !unavailable && 'hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/10 dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:ring-white/20',
    unavailable && 'cursor-default opacity-60',
    className,
  )
  const citationLabel = source.citationIndices?.length
    ? `Citations ${source.citationIndices.join(', ')}: `
    : source.citationIndex
      ? `Citation ${source.citationIndex}: `
      : ''
  const accessibleName = `${citationLabel}${source.title}, ${sourceMeta(source)}`

  const chip = !unavailable && onOpen ? (
      <Button type="button" variant="ghost" size="sm" className={baseClassName} aria-label={accessibleName} title={accessibleName} onClick={() => onOpen(source)}>
        <ChipContents source={source} />
      </Button>
    ) : !unavailable && source.kind === 'web' && source.url ? (
      <a href={source.url} target="_blank" rel="noopener noreferrer" className={baseClassName} aria-label={accessibleName} title={accessibleName}>
        <ChipContents source={source} />
      </a>
    ) : (
      <span className={baseClassName} aria-label={accessibleName} title={accessibleName}>
        <ChipContents source={source} />
      </span>
    )

  if (!showPreview || !source.excerpt) return chip

  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1.5 rounded-xl border border-neutral-200 bg-neutral-50 p-2 dark:border-white/10 dark:bg-white/[0.03]">
      {chip}
      <span className="line-clamp-3 max-w-80 px-1 text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">{source.excerpt}</span>
    </span>
  )
}
