import type { ComponentPropsWithoutRef } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ChatResponseProps = {
  content: string
  className?: string
  onCitationClick?: (citationIndex: number) => void
}

const CITATION_PROTOCOL = 'orion-citation:'

function withCitationLinks(content: string) {
  return content.replace(/\[\[(\d+)\]\]/g, (_match, index: string) => `[${index}](${CITATION_PROTOCOL}${index})`)
}

export default function ChatResponse({ content, className, onCitationClick }: ChatResponseProps) {
  return (
    <div className={cn('min-w-0 text-sm leading-6 text-neutral-800 dark:text-neutral-200', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => url.startsWith(CITATION_PROTOCOL) ? url : defaultUrlTransform(url)}
        components={{
          h1: ({ children }) => <h1 className="mb-3 mt-5 text-xl font-semibold first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-5 text-lg font-semibold first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
          p: ({ children }) => <p className="my-2 break-words first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-neutral-400">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-neutral-400">{children}</ol>,
          li: ({ children }) => <li className="break-words pl-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-neutral-300 pl-3 text-neutral-600 dark:border-white/20 dark:text-neutral-400">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => (
            <pre className="my-3 max-w-full overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-950 p-3 text-xs leading-5 text-neutral-100 dark:border-white/10">
              {children}
            </pre>
          ),
          code: ({ className: codeClassName, children, ...props }) => (
            <code
              className={cn(
                'break-words rounded bg-neutral-200/80 px-1 py-0.5 font-mono text-[0.9em] text-neutral-900 dark:bg-white/10 dark:text-neutral-100',
                codeClassName && 'block min-w-max break-normal bg-transparent p-0 text-inherit',
                codeClassName,
              )}
              {...props}
            >
              {children}
            </code>
          ),
          table: ({ children }) => (
            <div className="my-3 max-w-full overflow-x-auto rounded-lg border border-neutral-200 dark:border-white/10">
              <table className="min-w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-neutral-100 dark:bg-white/5">{children}</thead>,
          tr: ({ children }) => <tr className="border-b border-neutral-200 last:border-0 dark:border-white/10">{children}</tr>,
          th: ({ children }) => <th className="whitespace-nowrap px-3 py-2 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 align-top">{children}</td>,
          a: ({ href, children, ...props }: ComponentPropsWithoutRef<'a'>) => {
            if (href?.startsWith(CITATION_PROTOCOL)) {
              const citationIndex = Number(href.slice(CITATION_PROTOCOL.length))
              const label = `Open citation ${citationIndex}`
              return onCitationClick ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={label}
                  onClick={() => onCitationClick(citationIndex)}
                  className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-500/10 px-1.5 text-[10px] font-semibold leading-5 text-violet-700 outline-none hover:bg-violet-500/15 focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:bg-violet-400/15 dark:text-violet-200"
                >
                  {citationIndex}
                </Button>
              ) : (
                <span aria-label={`Citation ${citationIndex}`} className="mx-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-violet-500/10 px-1.5 text-[10px] font-semibold leading-5 text-violet-700 dark:bg-violet-400/15 dark:text-violet-200">
                  {citationIndex}
                </span>
              )
            }

            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-violet-700 underline decoration-violet-500/30 underline-offset-2 hover:decoration-violet-500 dark:text-violet-300"
                {...props}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {withCitationLinks(content)}
      </ReactMarkdown>
    </div>
  )
}
