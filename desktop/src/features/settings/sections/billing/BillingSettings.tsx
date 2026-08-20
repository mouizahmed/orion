import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { useBilling } from '@/features/settings/sections/billing/BillingContext'
import { authenticatedFetch } from '@/features/auth/auth-session'
import { API_BASE_URL } from '@/lib/api-config'
import { billingOffer, billingPlan, formatUSD } from '@/features/settings/sections/billing/billing-catalog'
import {
  CHECKOUT_OPERATION_LIFETIME_MS,
  readPendingCheckoutOperation,
  writePendingCheckoutOperation,
  type PendingCheckoutOperation,
} from '@/features/settings/sections/billing/billing-checkout'
import { ToggleSwitch } from '@/features/settings/components/SettingsPrimitives'

const freePlan = billingPlan('free')
const professionalPlan = billingPlan('professional')
const monthlyOffer = billingOffer('professional_monthly')
const annualOffer = billingOffer('professional_annual')
const annualMonthlyCents = Math.round(annualOffer.unitAmountCents / 12)
const annualDiscount = Math.round((1 - annualOffer.unitAmountCents / (monthlyOffer.unitAmountCents * 12)) * 100)

function formatBillingDate(value?: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function UsageMeter({ label, used = 0, allowance = 0, unit, unlimited = false }: { label: string; used?: number; allowance?: number; unit: string; unlimited?: boolean }) {
  const percentage = unlimited || allowance <= 0 ? null : Math.min(100, Math.round((used / allowance) * 100))
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">{label}</div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">{unlimited ? 'Unlimited' : `${used.toLocaleString()} of ${allowance.toLocaleString()} ${unit}`}</div>
      </div>
      {percentage !== null ? (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-white/10" role="progressbar" aria-label={`${label} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}>
          <div className="h-full rounded-full bg-[#7c3aed] transition-[width] dark:bg-[#9f73f2]" style={{ width: `${percentage}%` }} />
        </div>
      ) : <div className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500">Included with your plan</div>}
    </div>
  )
}

export function BillingSettings() {
  const { status, hasAuthoritativeStatus, processingReturn, error: billingError, refresh } = useBilling()
  const [annual, setAnnual] = useState(() => status?.offer !== 'professional_monthly')
  const [action, setAction] = useState<'checkout' | 'portal' | null>(null)
  const checkoutOperationRef = useRef<PendingCheckoutOperation | null>(readPendingCheckoutOperation())

  useEffect(() => {
    if (status?.offer === 'professional_monthly') setAnnual(false)
    if (status?.offer === 'professional_annual') setAnnual(true)
  }, [status?.offer])
  useEffect(() => { void refresh().catch(() => undefined) }, [refresh])

  const openHostedBilling = useCallback(async (kind: 'checkout' | 'portal') => {
    setAction(kind)
    try {
      const offer = annual ? 'professional_annual' : 'professional_monthly'
      if (kind === 'checkout') checkoutOperationRef.current = readPendingCheckoutOperation()
      if (kind === 'checkout' && (checkoutOperationRef.current?.offer !== offer || Date.now() - checkoutOperationRef.current.createdAt >= CHECKOUT_OPERATION_LIFETIME_MS)) {
        checkoutOperationRef.current = { offer, requestID: crypto.randomUUID(), createdAt: Date.now() }
        writePendingCheckoutOperation(checkoutOperationRef.current)
      }
      const response = await authenticatedFetch(`${API_BASE_URL}/billing/${kind === 'checkout' ? 'checkout-sessions' : 'portal-sessions'}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: kind === 'checkout' ? JSON.stringify({ offer, request_id: checkoutOperationRef.current?.requestID }) : undefined,
      })
      const payload = await response.json().catch(() => ({})) as { url?: string; error?: string }
      if (!response.ok || !payload.url) {
        if (response.status === 400 || response.status === 409) {
          checkoutOperationRef.current = null
          writePendingCheckoutOperation(null)
        }
        throw new Error(payload.error || 'Billing is unavailable')
      }
      window.open(payload.url, '_blank')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Billing is unavailable')
    } finally {
      setAction(null)
    }
  }, [annual])

  const professional = status?.effective_plan === 'professional'
  const managedPlan = status?.effective_plan === 'business'
  const hasBillingAccount = Boolean(status?.subscription_status)
  const hasBlockingSubscription = Boolean(status?.subscription_status && status.subscription_status !== 'canceled' && status.subscription_status !== 'incomplete_expired')
  const canStartTrial = !professional && !managedPlan && !hasBlockingSubscription
  const dateLabel = formatBillingDate(status?.renews_or_ends_at)
  const lifecycle = dateLabel ? `${status?.scheduled_to_end ? 'Ends' : status?.subscription_status === 'trialing' ? 'Trial ends' : 'Renews'} ${dateLabel}` : null
  const usage = professional || managedPlan
    ? { transcriptionUsed: 480, transcriptionAllowance: professionalPlan.includedTranscriptionMinutes, aiChatUsed: 0, aiChatAllowance: 0, aiChatUnlimited: true }
    : { transcriptionUsed: 168, transcriptionAllowance: freePlan.includedTranscriptionMinutes, aiChatUsed: 18, aiChatAllowance: 25, aiChatUnlimited: false }
  const resetDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)))
  const approachingLimit = !professional && !managedPlan && (usage.transcriptionUsed / usage.transcriptionAllowance >= 0.8 || (!usage.aiChatUnlimited && usage.aiChatUsed / usage.aiChatAllowance >= 0.8))

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-neutral-200 bg-white/60 px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">Current plan</div>
            <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
              {status?.enabled === false ? 'Billing is disabled in this environment.' : `${professional ? 'Professional' : managedPlan ? 'Business' : 'Free'}${status?.subscription_status && status.subscription_status !== 'trialing' ? ` · ${status.subscription_status.split('_').join(' ')}` : ''}${lifecycle ? ` · ${lifecycle}` : ''}`}
            </div>
            {billingError && !hasAuthoritativeStatus ? <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Billing details are temporarily unavailable.</div> : null}
            {processingReturn ? <div className="mt-1 text-xs text-[#7c3aed] dark:text-[#9f73f2]">Stripe is confirming your subscription...</div> : null}
          </div>
          {hasAuthoritativeStatus && status?.enabled && hasBillingAccount ? (
            <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={action !== null} onClick={() => void openHostedBilling('portal')}>
              <ExternalLink className="h-3.5 w-3.5" />{action === 'portal' ? 'Opening...' : 'Manage billing'}
            </Button>
          ) : null}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between gap-3 px-2 pb-2"><div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Usage</div><div className="text-xs text-neutral-500 dark:text-neutral-400">Resets {resetDate}</div></div>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="grid grid-cols-1 divide-y divide-neutral-200 dark:divide-white/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <UsageMeter label="Transcription minutes" used={usage.transcriptionUsed} allowance={usage.transcriptionAllowance} unit="minutes" />
            <UsageMeter label="AI chat" used={usage.aiChatUsed} allowance={usage.aiChatAllowance} unit="messages" unlimited={usage.aiChatUnlimited} />
          </div>
          {approachingLimit ? (
            <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3 dark:border-white/10">
              <div><div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Approaching your monthly limit</div><div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Upgrade for more transcription minutes and unlimited AI chat.</div></div>
              <Button type="button" variant="brand" size="sm" className="shrink-0" disabled={!hasAuthoritativeStatus || status?.enabled !== true || action !== null || hasBlockingSubscription} onClick={() => void openHostedBilling('checkout')}>{action === 'checkout' ? 'Opening...' : 'Upgrade'}</Button>
            </div>
          ) : null}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between gap-3 px-2 pb-2">
          <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Compare plans</div>
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            <span>Monthly</span><ToggleSwitch enabled={annual} onClick={() => setAnnual((value) => !value)} disabled={!hasAuthoritativeStatus || hasBlockingSubscription || managedPlan} /><span className="text-neutral-900 dark:text-neutral-100">Yearly</span><span className="text-[#7c3aed] dark:text-[#9f73f2]">-{annualDiscount}%</span>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="grid min-w-[620px] grid-cols-[minmax(170px,1.2fr)_minmax(180px,1fr)_minmax(210px,1.1fr)]">
            <div className="px-4 py-4" />
            <div className="px-4 py-4 text-center">
              <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Free</div>
              <div className="mt-1 flex items-baseline justify-center gap-1"><span className="text-xl font-semibold text-neutral-950 dark:text-white">$0</span><span className="text-xs text-neutral-500 dark:text-neutral-400">/month</span></div>
              {status?.effective_plan === 'free' ? <span className="mt-3 inline-flex h-8 items-center rounded-full border border-neutral-200 bg-neutral-100 px-3 text-xs font-medium text-neutral-600 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300">Current plan</span> : <div className="mt-3 h-8" />}
            </div>
            <div className="border-l border-neutral-200 bg-[#7c3aed]/[0.04] px-4 py-4 text-center dark:border-white/10 dark:bg-[#9f73f2]/[0.07]">
              <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{professionalPlan.name}</div>
              <div className="mt-1 flex items-baseline justify-center gap-1"><span className="text-xl font-semibold text-neutral-950 dark:text-white">{annual ? formatUSD(annualMonthlyCents) : formatUSD(monthlyOffer.unitAmountCents)}</span><span className="text-xs text-neutral-500 dark:text-neutral-400">/month</span></div>
              <Button type="button" variant={canStartTrial ? 'brand' : 'outline'} size="sm" className="mt-3" disabled={!hasAuthoritativeStatus || status?.enabled !== true || action !== null || professional || hasBlockingSubscription || managedPlan} onClick={() => void openHostedBilling('checkout')}>
                {professional ? 'Current plan' : managedPlan ? 'Managed plan' : hasBlockingSubscription ? 'Manage existing subscription' : action === 'checkout' ? 'Opening Checkout...' : `Start ${annualOffer.trialDays}-day trial`}
              </Button>
            </div>
            {[
              { label: 'Transcription minutes', free: `${freePlan.includedTranscriptionMinutes.toLocaleString()} / month`, professional: `${professionalPlan.includedTranscriptionMinutes.toLocaleString()} / month` },
              { label: 'AI chat', free: '25 / month', professional: 'Unlimited' },
              { label: 'Notes and transcripts', free: true, professional: true },
              { label: 'Integrations', free: false, professional: true },
              { label: 'MCP access', free: false, professional: true },
            ].map((feature) => (
              <Fragment key={feature.label}>
                <div className="flex min-h-12 items-center border-t border-neutral-200 px-4 py-3 text-xs font-medium text-neutral-700 dark:border-white/10 dark:text-neutral-300">{feature.label}</div>
                <div className="flex min-h-12 items-center justify-center border-t border-neutral-200 px-4 py-3 text-center text-xs text-neutral-600 dark:border-white/10 dark:text-neutral-300">{feature.free === true ? <Check className="h-4 w-4 text-[#7c3aed] dark:text-[#9f73f2]" /> : feature.free === false ? <X className="h-4 w-4 text-neutral-400 dark:text-neutral-500" /> : feature.free}</div>
                <div className="flex min-h-12 items-center justify-center border-l border-t border-neutral-200 bg-[#7c3aed]/[0.04] px-4 py-3 text-center text-xs text-neutral-700 dark:border-white/10 dark:bg-[#9f73f2]/[0.07] dark:text-neutral-200">{feature.professional === true ? <Check className="h-4 w-4 text-[#7c3aed] dark:text-[#9f73f2]" /> : feature.professional === false ? <X className="h-4 w-4 text-neutral-400 dark:text-neutral-500" /> : feature.professional}</div>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
