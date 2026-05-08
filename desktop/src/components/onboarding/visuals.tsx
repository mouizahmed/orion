import { OrionLogo } from '@/components/onboarding/OrionLogo'

const DEMO_BACKGROUND_IMAGE = '/onboarding-demo-background.png'

function DemoBackground({
  className = 'h-full min-h-[260px] w-full rounded-xl',
}: {
  className?: string
}) {
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-neutral-50 dark:bg-white/[0.03] ${className}`}
    >
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${DEMO_BACKGROUND_IMAGE})` }}
        aria-hidden
      />
    </div>
  )
}

export function LargeLogoVisual() {
  return (
    <div className="flex h-full items-center justify-center [-webkit-app-region:drag]">
      <OrionLogo className="h-44 w-44" />
    </div>
  )
}

export function MeetingVisual() {
  return <DemoBackground />
}

export function OverlayNotepadVisual() {
  return <DemoBackground />
}

export function LiveInsightsVisual() {
  return <DemoBackground />
}

export function IntegrationsVisual() {
  return <DemoBackground />
}
