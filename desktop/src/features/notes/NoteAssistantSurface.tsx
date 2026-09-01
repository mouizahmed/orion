import type { ReactNode } from 'react'
import { motion } from 'motion/react'

import { cn } from '@/lib/utils'

export const ASSISTANT_FOOTER_HEIGHT = 60
export const TRANSCRIPT_FOOTER_HEIGHT = 64
export const ASSISTANT_DOCK_FADE_TRANSITION = { duration: 0.08 }

const assistantSurfaceTransition = {
  type: 'tween' as const,
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1] as const,
}

type NoteAssistantSurfaceProps = {
  ariaLabel: string
  active?: boolean
  collapsedHeight: number
  expandedHeight: number
  expanded: boolean
  onAnimationComplete: () => void
  className?: string
  children: ReactNode
}

export default function NoteAssistantSurface({
  ariaLabel,
  active = true,
  collapsedHeight,
  expandedHeight,
  expanded,
  onAnimationComplete,
  className,
  children,
}: NoteAssistantSurfaceProps) {
  return (
    <motion.section
      role="dialog"
      aria-modal="false"
      aria-label={ariaLabel}
      aria-hidden={!active}
      initial={{ height: collapsedHeight, opacity: 0 }}
      animate={{
        height: expanded ? expandedHeight : collapsedHeight,
        opacity: expanded ? 1 : 0,
      }}
      transition={{
        height: assistantSurfaceTransition,
        opacity: { duration: 0.1, ease: 'easeOut' },
      }}
      onAnimationComplete={onAnimationComplete}
      className={cn(
        'absolute bottom-0 left-0 z-20 overflow-hidden rounded-[28px] border border-neutral-300/80 bg-white text-neutral-900 dark:border-white/12 dark:bg-[#272427] dark:text-neutral-100',
        active ? 'pointer-events-auto' : 'invisible pointer-events-none',
        className,
      )}
    >
      {children}
    </motion.section>
  )
}
