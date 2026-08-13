import { forwardRef, type ReactNode } from 'react'
import { Minus, X } from 'lucide-react'

import { desktopApi } from '@/lib/desktop-api'

type OnboardingFrameProps = {
  children: ReactNode
}

export const OnboardingFrame = forwardRef<HTMLDivElement, OnboardingFrameProps>(function OnboardingFrame(
  { children },
  ref,
) {
  return (
    <div
      ref={ref}
      data-overlay-visible
      className="relative w-full overflow-hidden bg-[#eef1ee] text-neutral-900 dark:bg-[#0f0d10] dark:text-neutral-100"
      style={{ minHeight: 562 }}
    >
      <div
        className="absolute left-0 right-24 top-0 z-20 h-12 [-webkit-app-region:drag]"
        aria-hidden
      />

      <div className="absolute right-3 top-3 z-30 flex items-center gap-1 [-webkit-app-region:no-drag]">
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-white"
          aria-label="Minimize"
          onClick={() => desktopApi.window.minimize()}
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-red-500 hover:text-white dark:text-neutral-300"
          aria-label="Close"
          onClick={() => desktopApi.window.close()}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative h-12" />

      {children}
    </div>
  )
})
