import type { ReactNode } from 'react'

export type OnboardingLayout = 'compact' | 'large'

export type OnboardingStep = {
  id?: string
  eyebrow?: string
  title: string
  description?: string
  layout?: OnboardingLayout
  nextLabel?: string
  visualAlign?: 'center' | 'top'
  visual?: ReactNode
  body?: ReactNode
}

export const ONBOARDING_LAYOUT_HEIGHT: Record<OnboardingLayout, number> = {
  compact: 562,
  large: 842,
}
