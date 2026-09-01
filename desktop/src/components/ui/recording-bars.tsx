import type { ComponentPropsWithoutRef } from 'react'
import { motion, useReducedMotion } from 'motion/react'

import { cn } from '@/lib/utils'

type RecordingBarsProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  isRecording?: boolean
}

const bars = [12, 20, 8]
const waveforms = [
  [0.65, 1, 0.55, 0.85, 0.65],
  [1, 0.6, 0.78, 0.5, 1],
  [0.75, 0.5, 1, 0.65, 0.75],
]

export function RecordingBars({
  isRecording = false,
  className,
  ...props
}: RecordingBarsProps) {
  const reduceMotion = useReducedMotion()
  const animate = isRecording && !reduceMotion

  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex h-5 w-5 shrink-0 items-center justify-center gap-[3px]', className)}
      {...props}
    >
      {bars.map((height, index) => (
        <motion.span
          key={index}
          animate={{ scaleY: animate ? waveforms[index] : 1 }}
          transition={animate
            ? {
                duration: 0.78 + index * 0.045,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: index * -0.11,
              }
            : { duration: 0.15 }}
          className="block w-[2px] rounded-full bg-current"
          style={{ height, transformOrigin: 'center' }}
        />
      ))}
    </span>
  )
}
