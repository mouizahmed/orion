import { forwardRef, useState } from 'react'
import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/AuthContext'
import { OnboardingFrame } from '@/features/onboarding/OnboardingFrame'
import { OrionLogo } from '@/features/onboarding/OrionLogo'
import { publicAssetUrl } from '@/lib/public-asset'

const TERMS_URL = 'https://orion.app/terms'
const PRIVACY_URL = 'https://orion.app/privacy'
const AUTH_TITLE = 'Sign in to get started'
const AUTH_SUBTEXT = 'Welcome to Orion. Your private AI notepad for calls, clear notes, follow-ups, and answers.'
const SIGNING_IN_TITLE = 'Signing in...'
const SIGNING_IN_SUBTEXT = 'Finishing your secure sign-in and getting Orion ready.'

function TermsAgreement({
  checked,
  disabled,
  attention,
  onCheckedChange,
  onAttentionEnd,
}: {
  checked: boolean
  disabled: boolean
  attention: boolean
  onCheckedChange: (checked: boolean) => void
  onAttentionEnd: () => void
}) {
  return (
    <label
      className={[
        'mt-3 flex max-w-[440px] items-start gap-2 rounded-lg text-xs leading-5 text-neutral-500 transition-colors dark:text-neutral-400 [-webkit-app-region:no-drag]',
        disabled ? 'cursor-default' : 'cursor-pointer',
        attention ? 'animate-[terms-attention_420ms_ease-in-out] text-neutral-800 dark:text-neutral-100' : '',
      ].join(' ')}
      onAnimationEnd={onAttentionEnd}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-md border border-neutral-300/70 bg-white/70 text-transparent ring-1 ring-neutral-900/5 transition-colors peer-enabled:cursor-pointer peer-checked:border-neutral-400 peer-checked:bg-neutral-950 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-900/10 dark:border-white/12 dark:bg-white/5 dark:ring-white/8 dark:peer-checked:border-white/20 dark:peer-checked:bg-white dark:peer-checked:text-neutral-950 dark:peer-focus-visible:ring-white/20"
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
          className="font-medium !text-white underline underline-offset-2"
        >
          Terms of Service
        </a>{' '}
        and{' '}
        <a
          href={PRIVACY_URL}
          target="_blank"
          rel="noreferrer"
          className="font-medium !text-white underline underline-offset-2"
        >
          Privacy Policy
        </a>
        .
      </span>
    </label>
  )
}

const AuthWelcome = forwardRef<HTMLDivElement>(function AuthWelcome(_, ref) {
  const { status, authError, loginLoading, loginWithGoogle, loginWithMicrosoft, retryAuthentication, cancelAuth } = useAuth()
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [termsAttention, setTermsAttention] = useState(false)
  const serviceUnavailable = status === 'service-unavailable'
  const showSigningInState = status === 'validating' || status === 'authenticated'

  const promptTermsAgreement = () => {
    setTermsAttention(false)
    window.setTimeout(() => setTermsAttention(true), 0)
  }

  const handleProviderLogin = (provider: 'google' | 'microsoft') => {
    if (!acceptedTerms) {
      promptTermsAgreement()
      return
    }

    if (provider === 'google') {
      void loginWithGoogle()
      return
    }
    void loginWithMicrosoft()
  }

  return (
    <OnboardingFrame ref={ref}>
      <div
        className="flex min-h-[492px] flex-col"
        style={{
          paddingInline: 'var(--app-content-inset)',
          paddingBottom: 'var(--app-content-inset)',
        }}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center pb-3 pt-3 [-webkit-app-region:drag]">
          <OrionLogo className="h-44 w-44" />
        </div>

        <div className="shrink-0 pb-3">
          <div className="text-[22px] font-semibold leading-tight text-neutral-950 dark:text-neutral-100">
            {showSigningInState ? SIGNING_IN_TITLE : AUTH_TITLE}
          </div>
          <p className="mt-2 max-w-[440px] text-sm font-medium leading-6 text-neutral-600 dark:text-neutral-400">
            {showSigningInState ? SIGNING_IN_SUBTEXT : AUTH_SUBTEXT}
          </p>
          {!serviceUnavailable && !showSigningInState ? (
            <TermsAgreement
              checked={acceptedTerms}
              disabled={loginLoading}
              attention={termsAttention}
              onCheckedChange={setAcceptedTerms}
              onAttentionEnd={() => setTermsAttention(false)}
            />
          ) : null}
          {authError ? (
            <div className="mt-3 w-full rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium leading-5 text-red-700 dark:text-red-200">
              {authError}
            </div>
          ) : null}
        </div>

        <div className="mt-auto w-full">
          {showSigningInState ? null : serviceUnavailable ? (
            <Button
              type="button"
              className="h-10 w-full rounded-full px-6 text-sm [-webkit-app-region:no-drag]"
              onClick={() => { void retryAuthentication() }}
            >
              Retry
            </Button>
          ) : loginLoading ? (
            <Button
              type="button"
              variant="destructive"
              className="h-10 w-full rounded-full px-5 text-sm [-webkit-app-region:no-drag]"
              onClick={cancelAuth}
            >
              Cancel
            </Button>
          ) : (
            <div className="grid w-full grid-cols-2 gap-2">
              <Button
                type="button"
                variant="secondary"
                className={[
                  'h-10 justify-center rounded-full text-sm [-webkit-app-region:no-drag]',
                  !acceptedTerms ? 'opacity-50' : '',
                ].join(' ')}
                onClick={() => handleProviderLogin('google')}
                aria-disabled={!acceptedTerms}
              >
                <img src={publicAssetUrl('google-signin.svg')} alt="" aria-hidden="true" className="h-4 w-4" />
                Google
              </Button>
              <Button
                type="button"
                variant="secondary"
                className={[
                  'h-10 justify-center rounded-full text-sm [-webkit-app-region:no-drag]',
                  !acceptedTerms ? 'opacity-50' : '',
                ].join(' ')}
                onClick={() => handleProviderLogin('microsoft')}
                aria-disabled={!acceptedTerms}
              >
                <img src={publicAssetUrl('microsoft-signin.svg')} alt="" aria-hidden="true" className="h-4 w-4" />
                Microsoft
              </Button>
            </div>
          )}
        </div>
      </div>
    </OnboardingFrame>
  )
})

export default AuthWelcome
