import { forwardRef, type CSSProperties, type ReactNode } from 'react'

import { desktopApi } from '@/lib/desktop-api'

type OnboardingFrameProps = {
  children: ReactNode
}

export const OnboardingFrame = forwardRef<HTMLDivElement, OnboardingFrameProps>(function OnboardingFrame(
  { children },
  ref,
) {
  const isMacOS = desktopApi.platform.current() === 'darwin'

  return (
    <div
      ref={ref}
      data-overlay-visible
      className="relative flex h-full min-h-[562px] w-full flex-col overflow-y-auto overflow-x-hidden bg-[#eef1ee] text-neutral-900 dark:bg-[#0f0d10] dark:text-neutral-100"
      style={{ minHeight: 562 }}
    >
      <div className="relative h-12 shrink-0">
        <div
          className="absolute inset-y-0 left-0"
          style={
            {
              right: isMacOS ? '0px' : '140px',
              WebkitAppRegion: 'drag',
            } as CSSProperties
          }
          aria-hidden
        />
      </div>

      {children}
    </div>
  )
})
