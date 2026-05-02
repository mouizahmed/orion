import { forwardRef, useMemo, useState } from 'react'

import { OnboardingFrame } from '@/components/onboarding/OnboardingFrame'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { buildAuthenticatedOnboardingSteps } from '@/components/onboarding/steps'

type AuthenticatedOnboardingProps = {
  isNewUser: boolean
  onComplete?: () => void
}

export const AuthenticatedOnboarding = forwardRef<HTMLDivElement, AuthenticatedOnboardingProps>(
  function AuthenticatedOnboarding({ isNewUser, onComplete }, ref) {
    const [stepIndex, setStepIndex] = useState(0)
    const onboardingSteps = useMemo(() => buildAuthenticatedOnboardingSteps(isNewUser), [isNewUser])
    const step = onboardingSteps[stepIndex]
    const layout = step.layout ?? 'large'

    const goNext = () => {
      if (stepIndex < onboardingSteps.length - 1) {
        setStepIndex((current) => current + 1)
        return
      }
      onComplete?.()
    }

    return (
      <OnboardingFrame ref={ref} layout={layout}>
        <OnboardingShell
          step={step}
          layout={layout}
          stepIndex={stepIndex}
          stepCount={onboardingSteps.length}
          showProgress
          showBack
          onBack={() => setStepIndex((current) => Math.max(0, current - 1))}
          onNext={goNext}
        />
      </OnboardingFrame>
    )
  },
)
