import { useState, type ComponentType } from 'react'
import { Brain, CalendarSearch, Check, ChevronDown, CircleAlert, FileSearch, Globe2, Loader2, PencilLine } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChatActivity, ChatActivityKind } from '@/features/chat/chat-ui-types'

type ChatActivityRowProps = {
  activity: ChatActivity
  className?: string
}

const activityIcons: Record<ChatActivityKind, ComponentType<{ className?: string }>> = {
  thinking: Brain,
  workspace_search: FileSearch,
  calendar_search: CalendarSearch,
  web_search: Globe2,
  reading: FileSearch,
  updating: PencilLine,
}

export default function ChatActivityRow({ activity, className }: ChatActivityRowProps) {
  const [expanded, setExpanded] = useState(false)
  const Icon = activityIcons[activity.kind]
  const running = activity.state === 'running'
  const failed = activity.state === 'failed'

  const content = (
    <>
      {running ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
      ) : failed ? (
        <CircleAlert className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          <Icon className="h-3.5 w-3.5" />
          <Check className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-white dark:bg-[#171417]" />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{activity.label}</span>
      {activity.detail ? (
        <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} />
      ) : null}
    </>
  )

  return (
    <div
      role="status"
      aria-live={running ? 'polite' : 'off'}
      className={cn(
        'max-w-full text-xs',
        failed ? 'text-red-600 dark:text-red-300' : 'text-neutral-500 dark:text-neutral-400',
        className,
      )}
    >
      {activity.detail ? (
        <Button
          type="button"
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
          className="flex max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-neutral-900/10 dark:hover:bg-white/5 dark:focus-visible:ring-white/20"
        >
          {content}
        </Button>
      ) : (
        <div className="flex max-w-full items-center gap-2 px-1.5 py-1">{content}</div>
      )}
      {expanded && activity.detail ? (
        <div className="ml-7 max-w-[calc(100%-1.75rem)] whitespace-pre-wrap break-words pb-1 text-[11px] leading-5 text-neutral-500 dark:text-neutral-400">
          {activity.detail}
        </div>
      ) : null}
    </div>
  )
}
