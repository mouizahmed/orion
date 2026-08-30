import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowUp,
  FileAudio,
  FileText,
  Globe2,
  Image,
  Loader2,
  Paperclip,
  RotateCcw,
  Square,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  ChatAttachment,
  ChatComposerLimits,
  ChatInternetAccessState,
} from '@/features/chat/chat-ui-types'

type ChatComposerProps = {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  variant?: 'page' | 'panel'
  placeholder?: string
  disabled?: boolean
  submitting?: boolean
  onStop?: () => void
  attachments?: ChatAttachment[]
  onAttach?: () => void
  onRemoveAttachment?: (attachment: ChatAttachment) => void
  onRetryAttachment?: (attachment: ChatAttachment) => void
  internetAccess?: ChatInternetAccessState
  onInternetAccessChange?: (state: Exclude<ChatInternetAccessState, 'unavailable'>) => void
  limits?: ChatComposerLimits
  className?: string
}

function formatBytes(value?: number) {
  if (value == null) return null
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function AttachmentIcon({ attachment }: { attachment: ChatAttachment }) {
  if (attachment.kind === 'image') return <Image className="h-3.5 w-3.5" />
  if (attachment.kind === 'audio') return <FileAudio className="h-3.5 w-3.5" />
  return <FileText className="h-3.5 w-3.5" />
}

export default function ChatComposer({
  value,
  onValueChange,
  onSubmit,
  variant = 'page',
  placeholder = 'Ask anything...',
  disabled = false,
  submitting = false,
  onStop,
  attachments = [],
  onAttach,
  onRemoveAttachment,
  onRetryAttachment,
  internetAccess,
  onInternetAccessChange,
  limits,
  className,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composingRef = useRef(false)
  const generatedErrorId = useId()
  const [announcement, setAnnouncement] = useState('')
  const maxTextareaHeight = variant === 'page' ? 160 : 112

  const validationErrors = useMemo(() => {
    const errors: string[] = []
    if (limits?.maxPromptLength && value.length > limits.maxPromptLength) {
      errors.push(`Message is ${value.length - limits.maxPromptLength} characters over the limit.`)
    }
    if (limits?.maxAttachments && attachments.length > limits.maxAttachments) {
      errors.push(`Only ${limits.maxAttachments} attachments are allowed.`)
    }
    if (limits?.maxAttachmentSizeBytes) {
      const oversized = attachments.find((attachment) =>
        attachment.sizeBytes != null && attachment.sizeBytes > limits.maxAttachmentSizeBytes!,
      )
      if (oversized) errors.push(`${oversized.name} exceeds the attachment size limit.`)
    }
    const invalidAttachment = attachments.find((attachment) => attachment.kind === 'unsupported' || attachment.state === 'rejected')
    if (invalidAttachment) errors.push(invalidAttachment.error || `${invalidAttachment.name} is not supported.`)
    return errors
  }, [attachments, limits, value.length])

  const hasReadyContent = Boolean(value.trim()) || attachments.some((attachment) => attachment.state === 'ready')
  const canSubmit = !disabled && !submitting && hasReadyContent && validationErrors.length === 0
  const errorId = validationErrors.length ? `${generatedErrorId}-errors` : undefined

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = '0px'
    const contentHeight = value.trim() ? textarea.scrollHeight : 32
    textarea.style.height = `${Math.max(32, Math.min(contentHeight, maxTextareaHeight))}px`
    textarea.style.overflowY = contentHeight > maxTextareaHeight ? 'auto' : 'hidden'
  }, [maxTextareaHeight, value])

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || composingRef.current) return
    event.preventDefault()
    handleSubmit()
  }

  const handleCompositionStart = () => {
    composingRef.current = true
  }

  const handleCompositionEnd = () => {
    composingRef.current = false
  }

  const toggleInternet = () => {
    if (!internetAccess || internetAccess === 'unavailable' || !onInternetAccessChange) return
    const next = internetAccess === 'enabled' ? 'disabled' : 'enabled'
    onInternetAccessChange(next)
    setAnnouncement(`Internet access ${next}.`)
  }

  return (
    <div className={cn('min-w-0', className)}>
      <div
        className={cn(
          'relative overflow-hidden border border-neutral-200 bg-white/80 shadow-sm backdrop-blur-md transition-[border-color,box-shadow] focus-within:border-neutral-300 focus-within:ring-2 focus-within:ring-neutral-900/10 motion-reduce:transition-none dark:border-white/10 dark:bg-white/[0.06] dark:focus-within:border-white/20 dark:focus-within:ring-white/10',
          variant === 'page' ? 'rounded-3xl p-2.5' : 'rounded-2xl p-2',
          disabled && 'opacity-60',
          validationErrors.length && 'border-red-300 focus-within:border-red-400 focus-within:ring-red-500/10 dark:border-red-500/30',
        )}
      >
        {attachments.length ? (
          <div aria-label="Attachments" className="mb-2 flex min-w-0 flex-wrap gap-1.5">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className={cn(
                  'relative flex min-w-0 max-w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-xs',
                  attachment.state === 'failed' || attachment.state === 'rejected'
                    ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200'
                    : 'border-neutral-200 bg-neutral-50 text-neutral-700 dark:border-white/10 dark:bg-black/15 dark:text-neutral-300',
                )}
              >
                {attachment.state === 'uploading' ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <AttachmentIcon attachment={attachment} />}
                <span className="min-w-0">
                  <span className="block max-w-48 truncate font-medium">{attachment.name}</span>
                  <span className="block text-[10px] opacity-70">
                    {attachment.error || (attachment.state === 'uploading' && attachment.progress != null ? `${attachment.progress}%` : formatBytes(attachment.sizeBytes)) || attachment.state}
                  </span>
                </span>
                {attachment.state === 'failed' && onRetryAttachment ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Retry ${attachment.name}`} onClick={() => onRetryAttachment(attachment)} className="h-5 w-5 rounded-full outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-current/20 dark:hover:bg-white/10">
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                ) : null}
                {onRemoveAttachment ? (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${attachment.name}`} onClick={() => onRemoveAttachment(attachment)} className="h-5 w-5 rounded-full outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-current/20 dark:hover:bg-white/10">
                    <X className="h-3 w-3" />
                  </Button>
                ) : null}
                {attachment.state === 'uploading' && attachment.progress != null ? (
                  <span className="absolute inset-x-2 bottom-0.5 h-0.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-white/10">
                    <span className="block h-full bg-violet-500 transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(0, Math.min(100, attachment.progress))}%` }} />
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex min-w-0 items-end gap-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            aria-label="Chat message"
            aria-describedby={errorId}
            aria-invalid={validationErrors.length ? true : undefined}
            className="sidebar-scrollbar block min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm leading-6 text-neutral-900 outline-none placeholder:text-neutral-400 disabled:cursor-not-allowed dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />

          {internetAccess ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Internet access ${internetAccess}`}
              aria-pressed={internetAccess === 'unavailable' ? undefined : internetAccess === 'enabled'}
              onClick={toggleInternet}
              disabled={disabled || submitting || internetAccess === 'unavailable' || !onInternetAccessChange}
              title={internetAccess === 'enabled' ? 'Internet access is enabled; prompts may use an external search provider' : internetAccess === 'disabled' ? 'Internet access is disabled' : 'Internet access is unavailable'}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/10 disabled:opacity-40 dark:focus-visible:ring-white/20',
                internetAccess === 'enabled'
                  ? 'bg-violet-500/10 text-violet-700 hover:bg-violet-500/15 dark:bg-violet-400/15 dark:text-violet-200'
                  : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white',
              )}
            >
              <Globe2 className="h-3.5 w-3.5" />
              {variant === 'page' ? <span>Web</span> : null}
            </Button>
          ) : null}

          <div className="flex shrink-0 items-center gap-1">
            {limits?.maxPromptLength && value.length >= limits.maxPromptLength * 0.8 ? (
              <span className={cn('text-[10px] tabular-nums', value.length > limits.maxPromptLength ? 'text-red-600 dark:text-red-300' : 'text-neutral-400')}>
                {value.length}/{limits.maxPromptLength}
              </span>
            ) : null}
            {onAttach ? (
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Add attachment" onClick={onAttach} disabled={disabled || submitting} className="h-8 w-8 rounded-full text-neutral-500 outline-none hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-neutral-900/10 disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:ring-white/20">
                <Paperclip className="h-3.5 w-3.5" />
              </Button>
            ) : null}
            {submitting && onStop ? (
              <Button type="button" variant="brand" size="icon-sm" aria-label="Stop response" onClick={onStop} className="h-8 w-8 rounded-full bg-neutral-900 text-white outline-none hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-900/20 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 dark:focus-visible:ring-white/30">
                <Square className="h-3 w-3 fill-current" />
              </Button>
            ) : (
              <Button type="button" variant="brand" size="icon-sm" aria-label="Send message" onClick={handleSubmit} disabled={!canSubmit} className="h-8 w-8 rounded-full bg-neutral-900 text-white outline-none hover:bg-neutral-700 focus-visible:ring-2 focus-visible:ring-neutral-900/20 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 dark:focus-visible:ring-white/30">
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {validationErrors.length ? (
        <div id={errorId} role="alert" className="mt-1.5 space-y-0.5 px-2 text-[11px] leading-4 text-red-600 dark:text-red-300">
          {validationErrors.map((error) => <div key={error}>{error}</div>)}
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </div>
  )
}
