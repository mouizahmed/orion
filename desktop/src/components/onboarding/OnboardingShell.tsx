import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { OnboardingLayout, OnboardingStep } from '@/components/onboarding/types'
import type { ReactNode } from 'react'

type OnboardingShellProps = {
  step: OnboardingStep
  layout: OnboardingLayout
  stepIndex: number
  stepCount: number
  nextDisabled?: boolean
  showProgress?: boolean
  showBack?: boolean
  bodyOverride?: ReactNode
  footer?: ReactNode
  onBack: () => void
  onNext: () => void
}

export function OnboardingShell({
  step,
  layout,
  stepIndex,
  stepCount,
  nextDisabled = false,
  showProgress = layout === 'large',
  showBack = layout === 'large',
  bodyOverride,
  footer,
  onBack,
  onNext,
}: OnboardingShellProps) {
  const isLarge = layout === 'large'

  return (
    <div
      className={cn(
        'flex flex-col',
        isLarge ? 'min-h-[794px] px-14 pb-14' : 'min-h-[514px] px-6 pb-7',
      )}
    >
      {step.visual ? (
        <div
          className={cn(
            'flex min-h-0 flex-1 justify-center pb-3',
            step.visualAlign === 'center' ? 'items-center pt-3' : 'items-start pt-7',
          )}
        >
          {step.visual}
        </div>
      ) : null}

      <div
        className={cn(
          'shrink-0',
          step.visual ? 'pb-6' : isLarge ? 'mx-auto w-full max-w-[650px] pb-7 pt-24' : 'pt-16 pb-5',
        )}
      >
        {step.eyebrow ? (
          <div className="mb-3 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
            {step.eyebrow}
          </div>
        ) : null}
        <div className="text-[22px] font-semibold leading-tight text-neutral-950 dark:text-neutral-100">
          {step.title}
        </div>
        {step.description ? (
          <p className="mt-2 max-w-[440px] text-sm font-medium leading-6 text-neutral-600 dark:text-neutral-400">
            {step.description}
          </p>
        ) : null}
        {bodyOverride ?? step.body}
      </div>

      {footer ? (
        <div className="mt-auto">{footer}</div>
      ) : (
        <div className="mt-auto flex items-center justify-between gap-2">
          {showProgress ? (
            <div className="text-xs text-neutral-400 dark:text-neutral-500">
              {stepIndex + 1}/{stepCount}
            </div>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            {showBack && stepIndex > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-full px-5 text-sm [-webkit-app-region:no-drag]"
                onClick={onBack}
              >
                Back
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              className="h-9 rounded-full px-5 text-sm [-webkit-app-region:no-drag]"
              onClick={onNext}
              disabled={nextDisabled}
            >
              {step.nextLabel ?? 'Next'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
