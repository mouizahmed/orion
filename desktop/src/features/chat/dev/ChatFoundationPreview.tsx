import { useEffect, useState, type ReactNode } from 'react'
import { Moon, PanelRight, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import ChatActionCard from '@/features/chat/components/ChatActionCard'
import ChatActivityRow from '@/features/chat/components/ChatActivityRow'
import ChatComposer from '@/features/chat/components/ChatComposer'
import ChatMessage from '@/features/chat/components/ChatMessage'
import ChatSourceChip from '@/features/chat/components/ChatSourceChip'
import type { ChatAttachment, ChatInternetAccessState } from '@/features/chat/chat-ui-types'
import {
  activities,
  attachments as attachmentFixtures,
  calendarSources,
  failedMessage,
  longMarkdownMessage,
  noteActions,
  orionSources,
  shortMessages,
  streamingMessage,
  unavailableSources,
  webSources,
} from '@/features/chat/dev/chat-ui-fixtures'
import { cn } from '@/lib/utils'

type PreviewWidth = 'page' | 'panel' | 'narrow'

const previewWidths: Record<PreviewWidth, string> = {
  page: 'max-w-[720px]',
  panel: 'max-w-[360px]',
  narrow: 'max-w-[320px]',
}

function PreviewSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white/75 p-4 shadow-sm dark:border-white/10 dark:bg-[#171417]/85 dark:shadow-none">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400 dark:text-neutral-500">{title}</h2>
      {children}
    </section>
  )
}

export default function ChatFoundationPreview() {
  const [dark, setDark] = useState(true)
  const [width, setWidth] = useState<PreviewWidth>('page')
  const [composerValue, setComposerValue] = useState('Who did I meet with about the beta launch?')
  const [panelComposerValue, setPanelComposerValue] = useState('Summarize the decisions in this note.')
  const [internetAccess, setInternetAccess] = useState<ChatInternetAccessState>('enabled')
  const [attachments, setAttachments] = useState<ChatAttachment[]>(attachmentFixtures.slice(0, 3))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  return (
    <div className="h-screen w-full overflow-y-auto bg-[#eef1ee] text-neutral-900 sidebar-scrollbar dark:bg-[#0f0d10] dark:text-neutral-100">
      <header className="sticky top-0 z-20 border-b border-neutral-200 bg-[#eef1ee]/90 px-5 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-[#0f0d10]/90">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h1 className="text-base font-semibold">Chat foundation fixtures</h1>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">Temporary manual test gallery — no backend connections</p>
          </div>
          <div className="flex rounded-full border border-neutral-200 bg-white/70 p-0.5 dark:border-white/10 dark:bg-white/5">
            {(['page', 'panel', 'narrow'] as const).map((option) => (
              <Button
                key={option}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setWidth(option)}
                className={cn('h-7 rounded-full px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/10 dark:focus-visible:ring-white/20', width === option && 'bg-white shadow-sm dark:bg-white/10')}
              >
                {option === 'page' ? '720px' : option === 'panel' ? '360px' : '320px'}
              </Button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => setDark((current) => !current)}>
            {dark ? <Sun /> : <Moon />}{dark ? 'Light' : 'Dark'}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 p-5">
        <div className={cn('mx-auto w-full transition-[max-width] duration-200 motion-reduce:transition-none', previewWidths[width])}>
          <div className="space-y-5">
            <PreviewSection title="Short conversation">
              <div className="space-y-5">{shortMessages.map((message) => <ChatMessage key={message.id} message={message} density={width === 'page' ? 'page' : 'panel'} />)}</div>
            </PreviewSection>

            <PreviewSection title="Long markdown and citations">
              <ChatMessage message={longMarkdownMessage} density={width === 'page' ? 'page' : 'panel'} onOpenSource={() => undefined} />
            </PreviewSection>

            <PreviewSection title="Sources and edge cases">
              <div className="flex flex-wrap gap-2">
                {[...orionSources, ...calendarSources, ...webSources, ...unavailableSources].map((source) => (
                  <ChatSourceChip key={source.id} source={source} showPreview={source.id === 'note-roadmap'} onOpen={source.kind === 'web' ? undefined : () => undefined} />
                ))}
              </div>
            </PreviewSection>

            <PreviewSection title="Activity states">
              <div className="space-y-1">{activities.map((activity) => <ChatActivityRow key={activity.id} activity={activity} />)}</div>
            </PreviewSection>

            <PreviewSection title="Streaming and failure">
              <div className="space-y-5">
                <ChatMessage message={streamingMessage} density={width === 'page' ? 'page' : 'panel'} />
                <ChatMessage message={failedMessage} density={width === 'page' ? 'page' : 'panel'} onRetry={() => undefined} />
              </div>
            </PreviewSection>

            <PreviewSection title="Current-note actions">
              <div className="space-y-2">
                {noteActions.map((action) => <ChatActionCard key={action.id} action={action} onApply={() => undefined} onCancel={() => undefined} onRetry={() => undefined} onViewChange={() => undefined} onUndo={() => undefined} />)}
              </div>
            </PreviewSection>

            <PreviewSection title="Page composer">
              <ChatComposer
                value={composerValue}
                onValueChange={setComposerValue}
                onSubmit={() => undefined}
                variant="page"
                attachments={attachments}
                onAttach={() => undefined}
                onRemoveAttachment={(attachment) => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                onRetryAttachment={() => undefined}
                internetAccess={internetAccess}
                onInternetAccessChange={setInternetAccess}
                limits={{ maxPromptLength: 500, maxAttachments: 4, maxAttachmentSizeBytes: 5_000_000 }}
              />
            </PreviewSection>

            <PreviewSection title="Panel composer and validation">
              <div className="mb-3 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400"><PanelRight className="h-3.5 w-3.5" />Note-panel density</div>
              <ChatComposer
                value={panelComposerValue}
                onValueChange={setPanelComposerValue}
                onSubmit={() => undefined}
                variant="panel"
                attachments={attachmentFixtures.slice(3)}
                onRemoveAttachment={() => undefined}
                onRetryAttachment={() => undefined}
                internetAccess="disabled"
                onInternetAccessChange={() => undefined}
                limits={{ maxPromptLength: 20, maxAttachments: 1, maxAttachmentSizeBytes: 800_000 }}
              />
            </PreviewSection>

            <PreviewSection title="Submitting composer">
              <ChatComposer value="Reviewing the current note" onValueChange={() => undefined} onSubmit={() => undefined} submitting onStop={() => undefined} variant={width === 'page' ? 'page' : 'panel'} internetAccess="unavailable" />
            </PreviewSection>
          </div>
        </div>
      </main>
    </div>
  )
}
