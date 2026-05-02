import { forwardRef, useMemo, useState } from 'react'
import { SiGoogle } from '@icons-pack/react-simple-icons'
import { Check, PanelsTopLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'
import { OnboardingFrame } from '@/components/onboarding/OnboardingFrame'
import { OnboardingShell } from '@/components/onboarding/OnboardingShell'
import { authOnboardingSteps } from '@/components/onboarding/steps'

const TERMS_URL = 'https://orionly.app/terms'
const PRIVACY_URL = 'https://orionly.app/privacy'

function TermsAgreement({
  checked,
  onCheckedChange,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="mt-3 flex max-w-[440px] cursor-pointer items-start gap-2 text-xs leading-5 text-neutral-500 dark:text-neutral-400 [-webkit-app-region:no-drag]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-md border border-neutral-300/70 bg-white/70 text-transparent ring-1 ring-neutral-900/5 transition-colors peer-checked:border-neutral-400 peer-checked:bg-neutral-950 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-900/10 dark:border-white/12 dark:bg-white/5 dark:ring-white/8 dark:peer-checked:border-white/20 dark:peer-checked:bg-white dark:peer-checked:text-neutral-950 dark:peer-focus-visible:ring-white/20"
        aria-hidden
      >
        <Check className="h-3 w-3" />
      </span>
      <span>
        I agree to the{' '}
        <a
          href={TERMS_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-neutral-700 underline underline-offset-2 hover:text-neutral-950 dark:text-neutral-200 dark:hover:text-white"
        >
          Terms of Service
        </a>{' '}
        and{' '}
        <a
          href={PRIVACY_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-neutral-700 underline underline-offset-2 hover:text-neutral-950 dark:text-neutral-200 dark:hover:text-white"
        >
          Privacy Policy
        </a>
        .
      </span>
    </label>
  )
}

const AuthWelcome = forwardRef<HTMLDivElement>(function AuthWelcome(_, ref) {
  const { authError, loginLoading, loginWithGoogle, cancelAuth } = useAuth()
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const onboardingSteps = useMemo(() => authOnboardingSteps, [])
  const [stepIndex, setStepIndex] = useState(0)
  const step = onboardingSteps[stepIndex]
  const layout = step.layout ?? 'compact'
  const isSignInStep = step.id === 'sign-in'
  const canGoBack = stepIndex > 0

  const goNext = () => {
    if (isSignInStep) {
      return
    }

    if (stepIndex < onboardingSteps.length - 1) {
      setStepIndex((current) => current + 1)
      return
    }
    void loginWithGoogle()
  }

  return (
    <OnboardingFrame ref={ref} layout={layout}>
      <OnboardingShell
        step={step}
        layout={layout}
        stepIndex={stepIndex}
        stepCount={onboardingSteps.length}
        bodyOverride={
          isSignInStep ? (
            <>
              <TermsAgreement
                checked={acceptedTerms}
                onCheckedChange={setAcceptedTerms}
              />
              {authError ? (
                <div className="mt-3 max-w-[440px] rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium leading-5 text-red-700 dark:text-red-200">
                  {authError}
                </div>
              ) : null}
            </>
          ) : undefined
        }
        nextDisabled={loginLoading}
        showProgress={false}
        showBack={canGoBack}
        footer={
          isSignInStep ? (
            <div className="flex w-full items-center justify-between gap-2">
              {canGoBack ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-full px-5 text-sm [-webkit-app-region:no-drag]"
                  onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
                >
                  Back
                </Button>
              ) : (
                <div />
              )}
              {loginLoading ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-full px-5 text-sm [-webkit-app-region:no-drag]"
                  onClick={cancelAuth}
                >
                  Cancel
                </Button>
              ) : (
                <div className="grid w-full max-w-[360px] grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-10 justify-center rounded-full text-sm [-webkit-app-region:no-drag]"
                    onClick={() => void loginWithGoogle()}
                    disabled={!acceptedTerms}
                  >
                    <SiGoogle className="h-4 w-4" />
                    Google
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 justify-center rounded-full text-sm [-webkit-app-region:no-drag]"
                    disabled
                    title="Microsoft sign in is coming soon"
                  >
                    <PanelsTopLeft className="h-4 w-4" />
                    Microsoft
                  </Button>
                </div>
              )}
            </div>
          ) : undefined
        }
        onBack={() => setStepIndex((current) => Math.max(0, current - 1))}
        onNext={goNext}
      />
    </OnboardingFrame>
  )
})

export default AuthWelcome
