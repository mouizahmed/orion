import { forwardRef, type ReactNode } from 'react'

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
      className="auth-root relative w-full overflow-hidden bg-[#eef1ee] text-neutral-900 dark:bg-[#0f0d10] dark:text-neutral-100"
      style={{ minHeight: 540 }}
    >
      <div
        className="absolute inset-x-0 top-0 z-20 h-12 [-webkit-app-region:drag]"
        aria-hidden
      />

      <div className="relative h-12" />

      {children}
    </div>
  )
})
