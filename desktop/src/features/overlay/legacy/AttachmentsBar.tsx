import { Button } from '@/components/ui/button'
import { FileText, X } from 'lucide-react'
import clsx from 'clsx'

export type Attachment = {
  id: string
  kind: 'image' | 'file'
  dataUrl?: string
  mimeType?: string
  name?: string
  size?: number
  filePath?: string
  source?: 'picker'
}

type AttachmentsBarProps = {
  attachments: Attachment[]
  onRemoveAttachment: (id: string) => void
}

export default function AttachmentsBar({ attachments, onRemoveAttachment }: AttachmentsBarProps) {
  if (attachments.length === 0) {
    return null
  }

  return (
    <div
      className="attachments-scrollbar flex max-w-full items-end justify-start gap-2 overflow-x-auto pl-1 pr-3 pt-2 pb-1"
      onWheel={(event) => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.preventDefault()
          event.currentTarget.scrollBy({
            left: event.deltaY,
            behavior: 'auto',
          })
        }
      }}
    >
      {attachments.map((attachment) => {
        const displayName = attachment.name
        const extension =
          attachment.name && attachment.name.includes('.')
            ? attachment.name.split('.').pop()?.slice(0, 6)?.toUpperCase()
            : attachment.kind === 'image'
              ? attachment.mimeType?.split('/').pop()?.toUpperCase()
              : undefined
        const previewContainerClassName = 'relative h-16 w-16'
        const previewContentClassName = clsx(
          'h-full w-full rounded-md bg-black/70 text-white/70',
          attachment.kind === 'file' ? 'flex items-center justify-center' : 'overflow-hidden',
        )

        return (
          <div
            key={attachment.id}
            className="relative flex w-20 shrink-0 flex-col items-center gap-1 rounded-lg border border-white/15 bg-black/70 p-1.5 shadow-lg backdrop-blur-md"
            onMouseDown={(event) => {
              event.stopPropagation()
            }}
          >
            <div className={previewContainerClassName}>
              <div className={previewContentClassName}>
                {attachment.kind === 'image' && attachment.dataUrl ? (
                  <img
                    src={attachment.dataUrl}
                    alt={displayName ?? 'Image attachment'}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center">
                    <FileText className="h-5 w-5 text-white/70" />
                    {extension && (
                      <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-white/60">
                        {extension}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <Button
                type="button"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/90 p-0 text-white/80 hover:bg-black hover:text-white"
                onClick={(event) => {
                  event.stopPropagation()
                  onRemoveAttachment(attachment.id)
                }}
              >
                <X className="h-3 w-3 text-red-400" />
              </Button>
            </div>

            {displayName && (
              <span
                className="w-full truncate text-center text-[10px] text-white/70"
                title={displayName}
              >
                {displayName}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

