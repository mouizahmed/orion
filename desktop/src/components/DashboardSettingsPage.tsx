import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, CalendarDays, Check, ClipboardList, CreditCard, ExternalLink, Keyboard, LayoutGrid, Mail, MonitorCog, Pencil, Plus, ScanText, SpellCheck, Trash2, User, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SidebarRowButton } from '@/components/ui/sidebar-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DashboardPanel,
  DashboardPanelBody,
  DashboardPanelHeader,
  DashboardPanelTitle,
} from '@/components/ui/dashboard-panel'
import { authenticatedFetch } from '@/lib/auth-session'
import { useAuth } from '@/contexts/AuthContext'
import { useBilling } from '@/contexts/BillingContext'
import { desktopApi, type IntegrationProvider, type RecordingSettings, type ShortcutAction, type ShortcutState } from '@/lib/desktop-api'
import { publicAssetUrl } from '@/lib/public-asset'
import { API_BASE_URL } from '@/lib/api-config'
import { billingOffer, billingPlan, formatUSD } from '@/lib/billing-catalog'
import { useUpdateVocabularyMutation, useVocabularyQuery } from '@/hooks/useVocabularyQuery'
import { useCalendarConnectionMutations, useCalendarSettingsQuery, useCalendarVisibilityMutation } from '@/hooks/useCalendarSettingsQuery'
import type { ConnectedCalendar, IntegrationConnection } from '@/types/calendar-settings'
import {
  CHECKOUT_OPERATION_LIFETIME_MS,
  readPendingCheckoutOperation,
  writePendingCheckoutOperation,
  type PendingCheckoutOperation,
} from '@/lib/billing-checkout'
import { toast } from 'sonner'
import { DeleteExtractFieldDialog, ExtractFieldDialog } from '@/components/dialog/ExtractFieldDialog'
import { useDashboardNotes } from '@/contexts/DashboardNotesContext'
import {
  useCreateExtractFieldMutation,
  useDeleteExtractFieldMutation,
  useExtractFieldsQuery,
  useUpdateExtractFieldMutation,
} from '@/hooks/useExtractFieldsQuery'
import type { ExtractField, ExtractFieldInput } from '@/types/extract-field'


export type DashboardSettingsSection = 'account' | 'billing' | 'calendar' | 'connectors' | 'vocabulary' | 'extracts' | 'emailDraft' | 'summaryTemplates' | 'preferences' | 'shortcuts'

type CalendarIntegrationProvider = Extract<IntegrationProvider, 'google' | 'microsoft'>

type ShortcutGroup = {
  title: string
  actions: Array<{
    key: ShortcutAction
    label: string
  }>
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: 'General',
    actions: [
      { key: 'toggleVisibility', label: 'Toggle Notepad' },
      { key: 'focusNotepad', label: 'Focus Notepad' },
      { key: 'toggleNotepad', label: 'Toggle Notepad Panel' },
      { key: 'toggleTranscript', label: 'Toggle Transcript' },
      { key: 'toggleAsk', label: 'Toggle Ask' },
      { key: 'toggleInsights', label: 'Toggle Insights' },
    ],
  },
  {
    title: 'Window Position',
    actions: [
      { key: 'moveUp', label: 'Move Up' },
      { key: 'moveDown', label: 'Move Down' },
      { key: 'moveLeft', label: 'Move Left' },
      { key: 'moveRight', label: 'Move Right' },
    ],
  },
]

const calendarProviderOptions: Array<{
  provider: CalendarIntegrationProvider
  label: string
  icon: string
}> = [
  { provider: 'google', label: 'Google Calendar', icon: publicAssetUrl('google-calendar-icon.svg') },
  { provider: 'microsoft', label: 'Outlook', icon: publicAssetUrl('microsoft-outlook-icon.svg') },
]

function accountLabel(connection: IntegrationConnection) {
  return connection.provider_email || connection.display_name || `${connection.provider} account`
}

function providerLabel(provider: IntegrationConnection['provider'] | ConnectedCalendar['provider']) {
  switch (provider) {
    case 'google':
      return 'Google Calendar'
    case 'microsoft':
      return 'Microsoft Outlook'
    default:
      return provider
  }
}

function calendarProviderIcon(provider: IntegrationConnection['provider'] | ConnectedCalendar['provider']) {
  switch (provider) {
    case 'google':
      return publicAssetUrl('google-calendar-icon.svg')
    case 'microsoft':
      return publicAssetUrl('microsoft-outlook-icon.svg')
    default:
      return null
  }
}

function groupCalendarsByConnection(calendars: ConnectedCalendar[]) {
  return calendars.reduce<Record<string, ConnectedCalendar[]>>((groups, calendar) => {
    const key = calendar.connection_id
    groups[key] = groups[key] || []
    groups[key].push(calendar)
    return groups
  }, {})
}

function extractFieldScopeLabel(field: ExtractField) {
  if (field.scope.type === 'allMeetings') return 'All meetings'
  return field.scope.folders
    .map((folder) => folder.available ? (folder.name ?? 'Folder') : 'Folder unavailable')
    .join(', ')
}

const sectionMeta: Record<DashboardSettingsSection, { title: string; icon: typeof User }> = {
  account: { title: 'Account', icon: User },
  billing: { title: 'Billing', icon: CreditCard },
  calendar: { title: 'Calendar', icon: CalendarDays },
  connectors: { title: 'Connectors', icon: LayoutGrid },
  vocabulary: { title: 'Vocabulary', icon: SpellCheck },
  extracts: { title: 'Extracts', icon: ScanText },
  emailDraft: { title: 'Email Draft Templates', icon: Mail },
  summaryTemplates: { title: 'Summary Templates', icon: ClipboardList },
  preferences: { title: 'Preferences', icon: MonitorCog },
  shortcuts: { title: 'Shortcuts', icon: Keyboard },
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])
const MAX_VOCABULARY_TERMS = 100
const MAX_VOCABULARY_TERM_LENGTH = 50
const EMPTY_VOCABULARY_TERMS: string[] = []

function vocabularyTermsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((term, index) => term === right[index])
}

function mergeVocabularyTerms(current: string[], candidates: string[]) {
  const terms = [...current]
  const seen = new Set(current.map((term) => term.toLowerCase()))
  for (const candidate of candidates) {
    const term = candidate.trim()
    if (!term) continue
    if ([...term].length > MAX_VOCABULARY_TERM_LENGTH) {
      return { terms: current, error: 'Each vocabulary term must be 50 characters or fewer.' }
    }
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    if (terms.length >= MAX_VOCABULARY_TERMS) {
      return { terms: current, error: 'Vocabulary can contain at most 100 terms.' }
    }
    seen.add(key)
    terms.push(term)
  }
  return { terms, error: null }
}

function getKeyLabel(key: string) {
  switch (key) {
    case ' ':
    case 'Space':
    case 'Spacebar':
      return 'Space'
    case 'ArrowUp':
      return 'Up'
    case 'ArrowDown':
      return 'Down'
    case 'ArrowLeft':
      return 'Left'
    case 'ArrowRight':
      return 'Right'
    default:
      return key.length === 1 ? key.toUpperCase() : key
  }
}

function formatShortcut(event: KeyboardEvent) {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.metaKey) parts.push('Cmd')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (MODIFIER_KEYS.has(event.key)) return null
  parts.push(getKeyLabel(event.key))
  return parts.join('+')
}

function SettingRow({
  label,
  value,
  action,
}: {
  label: string
  value?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 last:border-b-0 dark:border-white/10">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">{label}</div>
        {value ? <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{value}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

function ToggleSwitch({
  enabled,
  onClick,
  disabled = false,
  ariaLabel,
}: {
  enabled: boolean
  onClick?: () => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={[
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        enabled ? 'bg-[#7c3aed] dark:bg-[#9f73f2]' : 'bg-neutral-300 dark:bg-white/25',
        disabled ? 'cursor-not-allowed opacity-60' : '',
      ].join(' ')}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <span
        className={[
          'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
          enabled ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}

const freePlanDefinition = billingPlan('free')
const professionalPlanDefinition = billingPlan('professional')
const professionalMonthlyOffer = billingOffer('professional_monthly')
const professionalAnnualOffer = billingOffer('professional_annual')
const professionalAnnualMonthlyCents = Math.round(professionalAnnualOffer.unitAmountCents / 12)
const professionalAnnualDiscount = Math.round(
  (1 - professionalAnnualOffer.unitAmountCents / (professionalMonthlyOffer.unitAmountCents * 12)) * 100,
)
function formatBillingDate(value?: string) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

type BillingUsageMeterProps = {
  label: string
  used?: number
  allowance?: number
  unit: string
  unlimited?: boolean
}

function BillingUsageMeter({ label, used = 0, allowance = 0, unit, unlimited = false }: BillingUsageMeterProps) {
  const percentage = unlimited || allowance <= 0
    ? null
    : Math.min(100, Math.round((used / allowance) * 100))

  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">{label}</div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          {unlimited ? 'Unlimited' : `${used.toLocaleString()} of ${allowance.toLocaleString()} ${unit}`}
        </div>
      </div>
      {percentage !== null ? (
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-white/10"
          role="progressbar"
          aria-label={`${label} usage`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
        >
          <div
            className="h-full rounded-full bg-[#7c3aed] transition-[width] dark:bg-[#9f73f2]"
            style={{ width: `${percentage}%` }}
          />
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500">Included with your plan</div>
      )}
    </div>
  )
}

function BillingSettingsContent() {
  const { status, hasAuthoritativeStatus, processingReturn, error: billingError, refresh } = useBilling()
  const [annual, setAnnual] = useState(() => status?.offer !== 'professional_monthly')
  const [action, setAction] = useState<'checkout' | 'portal' | null>(null)
  const checkoutOperationRef = useRef<PendingCheckoutOperation | null>(readPendingCheckoutOperation())

  useEffect(() => {
    if (status?.offer === 'professional_monthly') setAnnual(false)
    if (status?.offer === 'professional_annual') setAnnual(true)
  }, [status?.offer])

  useEffect(() => {
    void refresh().catch(() => undefined)
  }, [refresh])

  const openHostedBilling = useCallback(async (kind: 'checkout' | 'portal') => {
    setAction(kind)
    try {
      const offer = annual ? 'professional_annual' : 'professional_monthly'
      if (kind === 'checkout') checkoutOperationRef.current = readPendingCheckoutOperation()
      if (
        kind === 'checkout'
        && (
          checkoutOperationRef.current?.offer !== offer
          || Date.now() - checkoutOperationRef.current.createdAt >= CHECKOUT_OPERATION_LIFETIME_MS
        )
      ) {
        checkoutOperationRef.current = { offer, requestID: crypto.randomUUID(), createdAt: Date.now() }
        writePendingCheckoutOperation(checkoutOperationRef.current)
      }
      const response = await authenticatedFetch(
        `${API_BASE_URL}/billing/${kind === 'checkout' ? 'checkout-sessions' : 'portal-sessions'}`,
        {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: kind === 'checkout'
            ? JSON.stringify({
                offer,
                request_id: checkoutOperationRef.current?.requestID,
              })
            : undefined,
        },
      )
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
  const hasBlockingSubscription = Boolean(
    status?.subscription_status
    && status.subscription_status !== 'canceled'
    && status.subscription_status !== 'incomplete_expired',
  )
  const canStartTrial = !professional && !managedPlan && !hasBlockingSubscription
  const dateLabel = formatBillingDate(status?.renews_or_ends_at)
  const planLifecycleLabel = dateLabel
    ? `${status?.scheduled_to_end ? 'Ends' : status?.subscription_status === 'trialing' ? 'Trial ends' : 'Renews'} ${dateLabel}`
    : null
  // Placeholder usage values until the backend usage endpoint is connected.
  const usagePreview = professional || managedPlan
    ? {
        transcriptionUsed: 480,
        transcriptionAllowance: professionalPlanDefinition.includedTranscriptionMinutes,
        aiChatUsed: 0,
        aiChatAllowance: 0,
        aiChatUnlimited: true,
      }
    : {
        transcriptionUsed: 168,
        transcriptionAllowance: freePlanDefinition.includedTranscriptionMinutes,
        aiChatUsed: 18,
        aiChatAllowance: 25,
        aiChatUnlimited: false,
      }
  const usageResetDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1)),
  )
  const usageApproachingLimit = !professional && !managedPlan && (
    usagePreview.transcriptionUsed / usagePreview.transcriptionAllowance >= 0.8
    || (!usagePreview.aiChatUnlimited && usagePreview.aiChatUsed / usagePreview.aiChatAllowance >= 0.8)
  )

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-neutral-200 bg-white/60 px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
              Current plan
            </div>
            <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
              {status?.enabled === false
                ? 'Billing is disabled in this environment.'
                : `${professional ? 'Professional' : managedPlan ? 'Business' : 'Free'}${status?.subscription_status && status.subscription_status !== 'trialing' ? ` · ${status.subscription_status.split('_').join(' ')}` : ''}${planLifecycleLabel ? ` · ${planLifecycleLabel}` : ''}`}
            </div>
            {billingError && !hasAuthoritativeStatus ? (
              <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Billing details are temporarily unavailable.
              </div>
            ) : null}
            {processingReturn ? (
              <div className="mt-1 text-xs text-[#7c3aed] dark:text-[#9f73f2]">
                Stripe is confirming your subscription...
              </div>
            ) : null}
          </div>
          {hasAuthoritativeStatus && status?.enabled && hasBillingAccount ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={action !== null}
              onClick={() => void openHostedBilling('portal')}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {action === 'portal' ? 'Opening...' : 'Manage billing'}
            </Button>
          ) : null}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 px-2 pb-2">
          <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Usage</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">Resets {usageResetDate}</div>
        </div>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="grid grid-cols-1 divide-y divide-neutral-200 dark:divide-white/10 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <BillingUsageMeter
              label="Transcription minutes"
              used={usagePreview.transcriptionUsed}
              allowance={usagePreview.transcriptionAllowance}
              unit="minutes"
            />
            <BillingUsageMeter
              label="AI chat"
              used={usagePreview.aiChatUsed}
              allowance={usagePreview.aiChatAllowance}
              unit="messages"
              unlimited={usagePreview.aiChatUnlimited}
            />
          </div>
          {usageApproachingLimit ? (
            <div className="flex items-center justify-between gap-3 border-t border-neutral-200 px-4 py-3 dark:border-white/10">
              <div>
                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Approaching your monthly limit</div>
                <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Upgrade for more transcription minutes and unlimited AI chat.</div>
              </div>
              <Button
                type="button"
                variant="brand"
                size="sm"
                className="shrink-0"
                disabled={!hasAuthoritativeStatus || status?.enabled !== true || action !== null || hasBlockingSubscription}
                onClick={() => void openHostedBilling('checkout')}
              >
                {action === 'checkout' ? 'Opening...' : 'Upgrade'}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 px-2 pb-2">
          <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Compare plans</div>
          <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
            <span>Monthly</span>
            <ToggleSwitch
              enabled={annual}
              onClick={() => setAnnual((value) => !value)}
              disabled={!hasAuthoritativeStatus || hasBlockingSubscription || managedPlan}
            />
            <span className="text-neutral-900 dark:text-neutral-100">Yearly</span>
            <span className="text-[#7c3aed] dark:text-[#9f73f2]">-{professionalAnnualDiscount}%</span>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="grid min-w-[620px] grid-cols-[minmax(170px,1.2fr)_minmax(180px,1fr)_minmax(210px,1.1fr)]">
            <div className="px-4 py-4" />

            <div className="px-4 py-4 text-center">
              <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Free</div>
              <div className="mt-1 flex items-baseline justify-center gap-1">
                <span className="text-xl font-semibold text-neutral-950 dark:text-white">$0</span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">/month</span>
              </div>
              {status?.effective_plan === 'free' ? (
                <span className="mt-3 inline-flex h-8 items-center rounded-full border border-neutral-200 bg-neutral-100 px-3 text-xs font-medium text-neutral-600 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300">
                  Current plan
                </span>
              ) : (
                <div className="mt-3 h-8" />
              )}
            </div>

            <div className="border-l border-neutral-200 bg-[#7c3aed]/[0.04] px-4 py-4 text-center dark:border-white/10 dark:bg-[#9f73f2]/[0.07]">
              <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {professionalPlanDefinition.name}
              </div>
              <div className="mt-1 flex items-baseline justify-center gap-1">
                <span className="text-xl font-semibold text-neutral-950 dark:text-white">
                  {annual ? formatUSD(professionalAnnualMonthlyCents) : formatUSD(professionalMonthlyOffer.unitAmountCents)}
                </span>
                <span className="text-xs text-neutral-500 dark:text-neutral-400">/month</span>
              </div>
              <Button
                type="button"
                variant={canStartTrial ? 'brand' : 'outline'}
                size="sm"
                className="mt-3"
                disabled={!hasAuthoritativeStatus || status?.enabled !== true || action !== null || professional || hasBlockingSubscription || managedPlan}
                onClick={() => void openHostedBilling('checkout')}
              >
                {professional
                  ? 'Current plan'
                  : managedPlan
                    ? 'Managed plan'
                    : hasBlockingSubscription
                      ? 'Manage existing subscription'
                      : action === 'checkout'
                        ? 'Opening Checkout...'
                        : `Start ${professionalAnnualOffer.trialDays}-day trial`}
              </Button>
            </div>

            {[
              {
                label: 'Transcription minutes',
                free: `${freePlanDefinition.includedTranscriptionMinutes.toLocaleString()} / month`,
                professional: `${professionalPlanDefinition.includedTranscriptionMinutes.toLocaleString()} / month`,
              },
              { label: 'AI chat', free: '25 / month', professional: 'Unlimited' },
              { label: 'Notes and transcripts', free: true, professional: true },
              { label: 'Integrations', free: false, professional: true },
              { label: 'MCP access', free: false, professional: true },
            ].map((feature) => (
              <Fragment key={feature.label}>
                <div className="flex min-h-12 items-center border-t border-neutral-200 px-4 py-3 text-xs font-medium text-neutral-700 dark:border-white/10 dark:text-neutral-300">
                  {feature.label}
                </div>
                <div className="flex min-h-12 items-center justify-center border-t border-neutral-200 px-4 py-3 text-center text-xs text-neutral-600 dark:border-white/10 dark:text-neutral-300">
                  {feature.free === true
                    ? <Check className="h-4 w-4 text-[#7c3aed] dark:text-[#9f73f2]" />
                    : feature.free === false
                      ? <X className="h-4 w-4 text-neutral-400 dark:text-neutral-500" />
                      : feature.free}
                </div>
                <div className="flex min-h-12 items-center justify-center border-l border-t border-neutral-200 bg-[#7c3aed]/[0.04] px-4 py-3 text-center text-xs text-neutral-700 dark:border-white/10 dark:bg-[#9f73f2]/[0.07] dark:text-neutral-200">
                  {feature.professional === true
                    ? <Check className="h-4 w-4 text-[#7c3aed] dark:text-[#9f73f2]" />
                    : feature.professional === false
                      ? <X className="h-4 w-4 text-neutral-400 dark:text-neutral-500" />
                      : feature.professional}
                </div>
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export function DashboardSettingsNav({
  selectedSection,
  onSelectSection,
  onBackToApp,
}: {
  selectedSection: DashboardSettingsSection
  onSelectSection: (section: DashboardSettingsSection) => void
  onBackToApp: () => void
}) {
  return (
    <div className="space-y-1">
      <SidebarRowButton
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={onBackToApp}
      >
        <ArrowLeft size={14} />
        <span>Back to app</span>
      </SidebarRowButton>
      <div className="-mx-1 border-t border-neutral-200 dark:border-white/10" />
      {(Object.keys(sectionMeta) as DashboardSettingsSection[]).map((section) => {
        const Icon = sectionMeta[section].icon
        return (
          <Fragment key={section}>
            {section === 'calendar' || section === 'vocabulary' || section === 'preferences' ? (
              <div className="my-1 border-t border-neutral-200 dark:border-white/10" />
            ) : null}
            <SidebarRowButton
              active={selectedSection === section}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={() => onSelectSection(section)}
            >
              <Icon size={14} />
              <span>{sectionMeta[section].title}</span>
            </SidebarRowButton>
          </Fragment>
        )
      })}
    </div>
  )
}

export default function DashboardSettingsPage({
  selectedSection,
}: {
  selectedSection: DashboardSettingsSection
}) {
  const { user, logout, logoutAllDevices, updateProfileName, uploadProfileAvatar } = useAuth()
  const shortcutApi = desktopApi.shortcuts
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const vocabularyInputRef = useRef<HTMLInputElement | null>(null)
  const wasSavingVocabularyRef = useRef(false)
  const canManageShortcuts = shortcutApi.isAvailable()
  const [shortcutState, setShortcutState] = useState<ShortcutState | null>(null)
  const [isLoadingShortcuts, setIsLoadingShortcuts] = useState(false)
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null)
  const [updatingAction, setUpdatingAction] = useState<ShortcutAction | null>(null)
  const [calendarAction, setCalendarAction] = useState<string | null>(null)
  const [profileName, setProfileName] = useState(user?.name || '')
  const [profileAction, setProfileAction] = useState<'name' | 'avatar' | null>(null)
  const [recordingSettings, setRecordingSettings] = useState<RecordingSettings>({
    storageLocation: 'server',
    localRecordingsPath: '',
  })
  const [vocabularyInput, setVocabularyInput] = useState('')
  const [vocabularyError, setVocabularyError] = useState<string | null>(null)
  const [isExtractFieldDialogOpen, setIsExtractFieldDialogOpen] = useState(false)
  const [editingExtractField, setEditingExtractField] = useState<ExtractField | null>(null)
  const [deletingExtractField, setDeletingExtractField] = useState<ExtractField | null>(null)
  const [deleteExtractFieldError, setDeleteExtractFieldError] = useState<string | null>(null)
  const { folders, isLoading: isLoadingFolders, loadError: foldersError } = useDashboardNotes()
  const vocabularyQuery = useVocabularyQuery(user?.id)
  const updateVocabularyMutation = useUpdateVocabularyMutation(user?.id)
  const vocabularyTerms = vocabularyQuery.data?.terms ?? EMPTY_VOCABULARY_TERMS
  const isLoadingVocabulary = vocabularyQuery.isPending
  const isSavingVocabulary = updateVocabularyMutation.isPending
  const refetchVocabulary = vocabularyQuery.refetch
  const displayedVocabularyError = vocabularyError
    ?? (vocabularyQuery.error instanceof Error ? vocabularyQuery.error.message : null)
  const extractFieldsQuery = useExtractFieldsQuery(user?.id)
  const createExtractFieldMutation = useCreateExtractFieldMutation(user?.id)
  const updateExtractFieldMutation = useUpdateExtractFieldMutation(user?.id)
  const deleteExtractFieldMutation = useDeleteExtractFieldMutation(user?.id)
  const extractFields = extractFieldsQuery.data ?? []
  const calendarSettingsQuery = useCalendarSettingsQuery(user?.id, selectedSection === 'calendar')
  const calendarVisibilityMutation = useCalendarVisibilityMutation(user?.id)
  const {
    connect: { mutateAsync: connectCalendar },
    disconnect: { mutateAsync: disconnectCalendar },
  } = useCalendarConnectionMutations(user?.id, (message) => toast.error(message))
  const calendarConnections = calendarSettingsQuery.data?.connections ?? []
  const connectedCalendars = calendarSettingsQuery.data?.calendars ?? []
  const isLoadingCalendars = calendarSettingsQuery.isPending
  const calendarSettingsError = calendarSettingsQuery.error instanceof Error
    ? calendarSettingsQuery.error.message
    : null
  const refetchCalendarSettings = calendarSettingsQuery.refetch
  const avatarSrc = user?.picture ?? null
  const displayName = user?.name || user?.email || 'Account'
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'S'

  useEffect(() => {
    setProfileName(user?.name || '')
  }, [user?.name])

  useEffect(() => {
    const saveFinished = wasSavingVocabularyRef.current && !isSavingVocabulary
    wasSavingVocabularyRef.current = isSavingVocabulary
    if (
      saveFinished
      && selectedSection === 'vocabulary'
      && !isLoadingVocabulary
      && vocabularyTerms.length < MAX_VOCABULARY_TERMS
    ) {
      vocabularyInputRef.current?.focus()
    }
  }, [isLoadingVocabulary, isSavingVocabulary, selectedSection, vocabularyTerms.length])

  const persistVocabularyTerms = useCallback(async (nextTerms: string[]) => {
    setVocabularyError(null)
    try {
      await updateVocabularyMutation.mutateAsync(nextTerms)
    } catch (error) {
      setVocabularyError(error instanceof Error ? error.message : 'Failed to update vocabulary')
    }
  }, [updateVocabularyMutation])

  const addVocabularyTerms = useCallback((candidates: string[]) => {
    const result = mergeVocabularyTerms(vocabularyTerms, candidates)
    if (result.error) {
      setVocabularyError(result.error)
      return false
    }
    setVocabularyError(null)
    if (!vocabularyTermsEqual(result.terms, vocabularyTerms)) {
      void persistVocabularyTerms(result.terms)
    }
    return true
  }, [persistVocabularyTerms, vocabularyTerms])

  const commitVocabularyInput = useCallback(() => {
    if (!vocabularyInput.trim()) return true
    const added = addVocabularyTerms([vocabularyInput])
    if (added) setVocabularyInput('')
    return added
  }, [addVocabularyTerms, vocabularyInput])

  const trimmedProfileName = profileName.trim()
  const canSaveProfileName = Boolean(user) && trimmedProfileName !== '' && trimmedProfileName !== (user?.name || '')

  const handleSaveProfileName = useCallback(async () => {
    if (!canSaveProfileName) return
    setProfileAction('name')
    try {
      await updateProfileName(trimmedProfileName)
    } catch (updateError) {
      toast.error(updateError instanceof Error ? updateError.message : 'Failed to update profile')
    } finally {
      setProfileAction(null)
    }
  }, [canSaveProfileName, trimmedProfileName, updateProfileName])

  const handleAvatarChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setProfileAction('avatar')
    try {
      await uploadProfileAvatar(file)
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : 'Failed to update avatar')
    } finally {
      setProfileAction(null)
    }
  }, [uploadProfileAvatar])

  useEffect(() => {
    if (selectedSection !== 'preferences' || !desktopApi.recordingSettings.isAvailable()) return
    let isSubscribed = true
    desktopApi.recordingSettings
      .get()
      .then((settings) => {
        if (isSubscribed) setRecordingSettings(settings)
      })
      .catch((loadError) => {
        console.error('Failed to load recording settings', loadError)
      })
    return () => {
      isSubscribed = false
    }
  }, [selectedSection])

  const updateRecordingSettings = useCallback(async (settings: Partial<RecordingSettings>) => {
    if (!desktopApi.recordingSettings.isAvailable()) {
      setRecordingSettings((current) => ({ ...current, ...settings }))
      return
    }
    try {
      const next = await desktopApi.recordingSettings.update(settings)
      setRecordingSettings(next)
    } catch (updateError) {
      console.error('Failed to update recording settings', updateError)
    }
  }, [])

  const chooseLocalRecordingsPath = useCallback(async () => {
    if (!desktopApi.recordingSettings.isAvailable()) return
    try {
      const next = await desktopApi.recordingSettings.pickLocalPath()
      setRecordingSettings(next)
    } catch (updateError) {
      console.error('Failed to choose recordings folder', updateError)
    }
  }, [])

  const handleConnectCalendar = useCallback(async (provider: CalendarIntegrationProvider) => {
    if (!user) {
      toast.error('Not authenticated')
      return
    }

    setCalendarAction(`connect:${provider}`)
    try {
      await connectCalendar(provider)
    } catch (connectError) {
      toast.error(connectError instanceof Error ? connectError.message : 'Failed to connect calendar')
    } finally {
      setCalendarAction(null)
    }
  }, [connectCalendar, user])

  const handleDisconnectCalendar = useCallback(
    async (connectionID: string) => {
      if (!user) {
        toast.error('Not authenticated')
        return
      }

      setCalendarAction(`disconnect:${connectionID}`)
      try {
        await disconnectCalendar(connectionID)
      } catch (disconnectError) {
        toast.error(disconnectError instanceof Error ? disconnectError.message : 'Failed to disconnect calendar')
      } finally {
        setCalendarAction(null)
      }
    },
    [disconnectCalendar, user],
  )

  const handleCalendarVisibility = useCallback(
    async (calendar: ConnectedCalendar, visible: boolean) => {
      if (!user) {
        toast.error('Not authenticated')
        return
      }

      const actionKey = `toggle:${calendar.connection_id}:${calendar.id}`
      setCalendarAction(actionKey)

      try {
        await calendarVisibilityMutation.mutateAsync({ calendar, visible })
      } catch (visibilityError) {
        toast.error(visibilityError instanceof Error ? visibilityError.message : 'Failed to update calendar')
      } finally {
        setCalendarAction(null)
      }
    },
    [calendarVisibilityMutation, user],
  )

  const handleShortcutUpdate = useCallback(
    async (action: ShortcutAction, value: string | null) => {
      if (!canManageShortcuts) return
      setUpdatingAction(action)
      try {
        const state = await shortcutApi.update(action, value)
        setShortcutState(state)
      } catch (updateError) {
        toast.error(updateError instanceof Error ? updateError.message : 'Failed to update shortcut')
      } finally {
        setUpdatingAction(null)
      }
    },
    [canManageShortcuts, shortcutApi],
  )

  useEffect(() => {
    if (!canManageShortcuts || selectedSection !== 'shortcuts') return
    let isSubscribed = true
    setIsLoadingShortcuts(true)
    shortcutApi
      .getAll()
      .then((state) => {
        if (!isSubscribed) return
        setShortcutState(state)
      })
      .catch((loadError) => {
        if (!isSubscribed) return
        console.error('Failed to load shortcuts', loadError)
      })
      .finally(() => {
        if (isSubscribed) setIsLoadingShortcuts(false)
      })
    return () => {
      isSubscribed = false
    }
  }, [canManageShortcuts, selectedSection, shortcutApi])

  useEffect(() => {
    if (!canManageShortcuts || !recordingAction) return
    const action = recordingAction

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      if (event.key === 'Escape') {
        setRecordingAction(null)
        return
      }
      const formatted = formatShortcut(event)
      if (!formatted) return
      setRecordingAction(null)
      if (shortcutState?.current[action] === formatted) return
      void handleShortcutUpdate(action, formatted)
    }

    const handleWindowBlur = () => setRecordingAction(null)

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [canManageShortcuts, handleShortcutUpdate, recordingAction, shortcutState])

  const calendarsByConnection = groupCalendarsByConnection(connectedCalendars)
  const title = sectionMeta[selectedSection].title

  const closeExtractFieldDialog = () => {
    setIsExtractFieldDialogOpen(false)
    setEditingExtractField(null)
  }

  const submitExtractField = async (input: ExtractFieldInput) => {
    if (editingExtractField) {
      await updateExtractFieldMutation.mutateAsync({ id: editingExtractField.id, input })
    } else {
      await createExtractFieldMutation.mutateAsync(input)
    }
    closeExtractFieldDialog()
  }

  const confirmDeleteExtractField = async () => {
    if (!deletingExtractField) return
    setDeleteExtractFieldError(null)
    try {
      await deleteExtractFieldMutation.mutateAsync(deletingExtractField.id)
      setDeletingExtractField(null)
    } catch (error) {
      setDeleteExtractFieldError(error instanceof Error ? error.message : 'Failed to delete extract field')
    }
  }

  return (
    <DashboardPanel className="flex h-full min-h-0 flex-col">
      <DashboardPanelHeader className="px-2.5 py-2">
        <div className="flex h-8 w-full items-center">
          <DashboardPanelTitle>{title}</DashboardPanelTitle>
        </div>
      </DashboardPanelHeader>
      <DashboardPanelBody className="min-h-0 flex-1 overflow-y-auto">
        {selectedSection === 'account' ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex items-center gap-3 border-b border-neutral-200 px-3 py-3 dark:border-white/10">
                <div className="shrink-0">
                  {avatarSrc ? (
                    <img
                      src={avatarSrc}
                      alt=""
                      className="h-12 w-12 rounded-full object-cover"
                      draggable={false}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-700 dark:bg-white/10 dark:text-white">
                      {initials}
                    </div>
                  )}
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="hidden"
                    onChange={handleAvatarChange}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{displayName}</div>
                  <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{user?.email || 'Not signed in'}</div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!user || profileAction === 'avatar'}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {profileAction === 'avatar' ? 'Saving' : 'Change photo'}
                </Button>
              </div>
              <SettingRow
                label="Name"
                action={
                  <div className="flex w-[320px] max-w-[45vw] items-center gap-2">
                    <Input
                      value={profileName}
                      disabled={!user || profileAction === 'name'}
                      maxLength={120}
                      onChange={(event) => setProfileName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void handleSaveProfileName()
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canSaveProfileName || profileAction === 'name'}
                      onClick={() => void handleSaveProfileName()}
                    >
                      {profileAction === 'name' ? 'Saving' : 'Save'}
                    </Button>
                  </div>
                }
              />
              <SettingRow label="Email" value={user?.email || 'Not signed in'} />
            </div>

            <div className="space-y-2">
              <div className="px-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">Session management</div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                <SettingRow
                  label="Session"
                  value="Manage sign-in on this device."
                  action={
                    <Button type="button" variant="outline" size="sm" onClick={logout}>
                      Log out
                    </Button>
                  }
                />
                <SettingRow
                  label="All sessions"
                  value="Revoke every device and close active live connections."
                  action={
                    <Button type="button" variant="outline" size="sm" onClick={() => void logoutAllDevices()}>
                      Log out everywhere
                    </Button>
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="px-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">Data management</div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                <SettingRow
                  label="Export data"
                  value="Generate a CSV export of your meeting notes, typically ready within a few hours."
                  action={
                    <Button type="button" variant="outline" size="sm" disabled>
                      Generate CSV
                    </Button>
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="px-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">Danger zone</div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                <SettingRow
                  label="Delete my account"
                  value="Permanently delete your account and all synced data."
                  action={
                    <Button type="button" variant="destructive" size="sm" disabled>
                      Delete my account
                    </Button>
                  }
                />
              </div>
            </div>
          </div>
        ) : null}

        {selectedSection === 'billing' ? <BillingSettingsContent /> : null}

        {selectedSection === 'shortcuts' ? (
          <div className="space-y-3">
            {!canManageShortcuts ? (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-400">
                Keybind controls are only available in the desktop app.
              </div>
            ) : null}

            {isLoadingShortcuts ? (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-400">
                Loading shortcuts...
              </div>
            ) : shortcutState ? (
              shortcutGroups.map((group) => (
                <div key={group.title}>
                  <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">{group.title}</div>
                  <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                    {group.actions.map((action) => {
                      const currentValue = shortcutState.current[action.key]
                      const defaultValue = shortcutState.defaults[action.key]
                      const isRecording = recordingAction === action.key
                      const isUpdating = updatingAction === action.key
                      return (
                        <SettingRow
                          key={action.key}
                          label={action.label}
                          value={isRecording ? 'Press a new key combination...' : currentValue || 'Not set'}
                          action={
                            <div className="flex gap-1.5">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={isUpdating || (recordingAction !== null && !isRecording)}
                                onClick={() => setRecordingAction((current) => (current === action.key ? null : action.key))}
                              >
                                {isRecording ? 'Cancel' : isUpdating ? 'Saving...' : 'Record'}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isUpdating || Boolean(recordingAction) || currentValue === defaultValue}
                                onClick={() => void handleShortcutUpdate(action.key, null)}
                              >
                                Reset
                              </Button>
                            </div>
                          }
                        />
                      )
                    })}
                  </div>
                </div>
              ))
            ) : null}
            {shortcutState ? (
              <p className="px-2 text-xs text-neutral-500 dark:text-neutral-400">
                Press Escape to cancel while recording. Shortcuts update immediately.
              </p>
            ) : null}
          </div>
        ) : null}

        {selectedSection === 'calendar' ? (
          <div className="space-y-3">
            {calendarSettingsError && calendarSettingsQuery.data ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                <span>Calendar settings could not be refreshed. Showing the last available data.</span>
                <button
                  type="button"
                  className="shrink-0 font-medium underline-offset-2 hover:underline"
                  onClick={() => void refetchCalendarSettings()}
                >
                  Retry
                </button>
              </div>
            ) : null}
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Calendar accounts</div>
                <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                  <Select
                    value=""
                    disabled={Boolean(calendarAction)}
                    onValueChange={(value) => void handleConnectCalendar(value as CalendarIntegrationProvider)}
                  >
                    <SelectTrigger size="sm">
                      <Plus className="h-3.5 w-3.5" />
                      <SelectValue placeholder="Add" />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {calendarProviderOptions.map((option) => (
                        <SelectItem key={option.provider} value={option.provider}>
                          <img src={option.icon} alt="" aria-hidden="true" className="h-4 w-4 shrink-0" />
                          {option.label}
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {calendarConnections.length > 0 ? (
                calendarConnections.map((connection) => {
                  const isDisconnecting = calendarAction === `disconnect:${connection.id}`
                  const providerIcon = calendarProviderIcon(connection.provider)
                  return (
                    <div
                      key={connection.id}
                      className="flex min-h-14 items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 last:border-b-0 dark:border-white/10"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {providerIcon ? (
                          <img
                            src={providerIcon}
                            alt=""
                            aria-hidden="true"
                            className="h-5 w-5 shrink-0"
                          />
                        ) : null}
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                            {providerLabel(connection.provider)}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                            {accountLabel(connection)}
                          </div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(calendarAction)}
                        className="border-red-500/25 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-400/20 dark:text-red-300 dark:hover:bg-red-500/10 dark:hover:text-red-200"
                        onClick={() => void handleDisconnectCalendar(connection.id)}
                      >
                        {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                      </Button>
                    </div>
                  )
                })
              ) : isLoadingCalendars ? (
                <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">Loading accounts...</div>
              ) : calendarSettingsError ? (
                <div className="flex items-center justify-between gap-3 px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">
                  <span>Calendar settings are unavailable.</span>
                  <button
                    type="button"
                    className="font-medium text-[#7c3aed] hover:text-[#6d28d9] dark:text-[#9f73f2] dark:hover:text-[#b79df7]"
                    onClick={() => void refetchCalendarSettings()}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">No calendar accounts connected.</div>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Visible calendars</div>
                <button
                  type="button"
                  className="text-xs font-medium text-[#7c3aed] hover:text-[#6d28d9] dark:text-[#9f73f2] dark:hover:text-[#b79df7]"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  onClick={() => void refetchCalendarSettings()}
                >
                  Refresh
                </button>
              </div>
              {connectedCalendars.length > 0 && calendarConnections.length > 0 ? (
                calendarConnections.map((connection) => {
                  const calendars = calendarsByConnection[connection.id] || []
                  if (calendars.length === 0) return null
                  return (
                    <div key={connection.id} className="border-b border-neutral-200 last:border-b-0 dark:border-white/10">
                      <div className="bg-neutral-50/80 px-3 py-2 text-xs font-medium text-neutral-500 dark:bg-white/[0.03] dark:text-neutral-400">
                        {accountLabel(connection)}
                      </div>
                      {calendars.map((calendar) => {
                        const actionKey = `toggle:${calendar.connection_id}:${calendar.id}`
                        return (
                          <div
                            key={`${calendar.connection_id}-${calendar.id}`}
                            className="flex min-h-12 items-center justify-between gap-3 px-3 py-2"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span
                                className="h-3 w-3 shrink-0 rounded-sm bg-neutral-300 dark:bg-white/25"
                                style={
                                  calendar.color || calendar.background_color
                                    ? { backgroundColor: calendar.color || calendar.background_color }
                                    : undefined
                                }
                              />
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                                  {calendar.name || calendar.id}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                                  {providerLabel(calendar.provider)}
                                </div>
                              </div>
                            </div>
                            <ToggleSwitch
                              enabled={calendar.visible}
                              disabled={calendarAction === actionKey}
                              ariaLabel={`${calendar.visible ? 'Hide' : 'Show'} ${calendar.name || calendar.id}`}
                              onClick={() => void handleCalendarVisibility(calendar, !calendar.visible)}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              ) : isLoadingCalendars ? (
                <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">Loading calendars...</div>
              ) : (
                <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">Connect a calendar account to choose visible calendars.</div>
              )}
            </div>
          </div>
        ) : null}

        {selectedSection === 'connectors' ? (
          <div className="space-y-3">
            <div className="px-2">
              <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Connectors</div>
              <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Connect external tools so Orion can pull context into your meetings.
              </div>
            </div>
          </div>
        ) : null}

        {selectedSection === 'vocabulary' ? (
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
              <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Recognition terms</div>
              <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{vocabularyTerms.length} / 100 terms</span>
            </div>
            {isLoadingVocabulary ? (
              <div className="px-3 py-5 text-xs text-neutral-500 dark:text-neutral-400">Loading vocabulary...</div>
            ) : (
              <div className="px-3 py-3">
                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                  Add names, brands, products, acronyms, or specialized terminology. Changes apply to new recordings.
                </div>
                <Input
                  ref={vocabularyInputRef}
                  value={vocabularyInput}
                  placeholder="Type a term, then press Enter"
                  className="mt-3 h-9 text-xs"
                  disabled={isSavingVocabulary || vocabularyTerms.length >= MAX_VOCABULARY_TERMS}
                  onChange={(event) => {
                    const value = event.target.value
                    if ([...value].length > MAX_VOCABULARY_TERM_LENGTH) {
                      setVocabularyError('Each vocabulary term must be 50 characters or fewer.')
                      return
                    }
                    setVocabularyInput(value)
                    setVocabularyError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    commitVocabularyInput()
                  }}
                  onPaste={(event) => {
                    const pasted = event.clipboardData.getData('text')
                    if (!pasted.includes('\n')) return
                    event.preventDefault()
                    if (addVocabularyTerms(pasted.split(/\r?\n/))) setVocabularyInput('')
                  }}
                />
                <div className="mt-3 flex min-h-7 flex-wrap gap-1.5">
                  {vocabularyTerms.map((term) => (
                    <span
                      key={term.toLowerCase()}
                      className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-neutral-200 bg-neutral-100 px-2.5 text-xs text-neutral-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-neutral-200"
                    >
                      <span className="truncate">{term}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${term}`}
                        className="rounded-full text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200"
                        disabled={isSavingVocabulary}
                        onClick={() => {
                          const nextTerms = vocabularyTerms.filter((candidate) => candidate !== term)
                          void persistVocabularyTerms(nextTerms)
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                  {vocabularyTerms.length === 0 ? (
                    <div className="flex h-7 items-center text-xs text-neutral-400 dark:text-neutral-500">No terms added yet.</div>
                  ) : null}
                </div>
                {displayedVocabularyError ? (
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-red-600 dark:text-red-400" aria-live="polite">
                    <span>{displayedVocabularyError}</span>
                    {vocabularyQuery.isError ? (
                      <button
                        type="button"
                        className="shrink-0 font-medium underline-offset-2 hover:underline"
                        onClick={() => void refetchVocabulary()}
                      >
                        Retry
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {selectedSection === 'extracts' ? (
          <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
              <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Fields</div>
              <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                {extractFields.length} {extractFields.length === 1 ? 'field' : 'fields'}
              </span>
            </div>
            <div className="px-3 py-3">
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                Define fields to automatically extract insights from your meetings.
              </div>
              <Button
                type="button"
                variant="secondary"
                className="mt-3 h-9 w-full justify-start px-3 text-xs font-medium"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                onClick={() => {
                  setEditingExtractField(null)
                  setIsExtractFieldDialogOpen(true)
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add new field
              </Button>
              {extractFieldsQuery.isPending ? (
                <div className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Loading fields...</div>
              ) : null}
              {extractFieldsQuery.isError ? (
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-red-600 dark:text-red-400">
                  <span>{extractFieldsQuery.error instanceof Error ? extractFieldsQuery.error.message : 'Failed to load fields'}</span>
                  <button type="button" className="font-medium hover:underline" onClick={() => void extractFieldsQuery.refetch()}>
                    Retry
                  </button>
                </div>
              ) : null}
              {!extractFieldsQuery.isPending && !extractFieldsQuery.isError && extractFields.length === 0 ? (
                <div className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">No fields added yet.</div>
              ) : null}
            </div>
            {extractFields.map((field) => (
              <div key={field.id} className="flex items-center gap-3 border-t border-neutral-200 px-3 py-2.5 dark:border-white/10">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">{field.name}</div>
                  <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{field.prompt}</div>
                  <div className="mt-1 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                    {field.insightCardinality === 'single' ? 'Single' : 'Multiple'} · {extractFieldScopeLabel(field)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${field.name}`}
                    onClick={() => {
                      setEditingExtractField(field)
                      setIsExtractFieldDialogOpen(true)
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${field.name}`}
                    onClick={() => {
                      setDeleteExtractFieldError(null)
                      setDeletingExtractField(field)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {selectedSection === 'emailDraft' ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
              <SettingRow
                label="Enable email draft"
                value="Automatically draft follow-up emails after meetings."
                action={<ToggleSwitch enabled />}
              />
              <SettingRow
                label="Include sharing link in the email body"
                value="e.g. You can review the full meeting notes here: https://orion.so/m/..."
                action={<ToggleSwitch enabled />}
              />
            </div>

            <div className="space-y-3">
              <div className="px-2">
                <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Templates</div>
                <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Define how follow-up emails should be generated with custom prompts.
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="h-12 w-full justify-start rounded-lg px-3 text-sm font-semibold"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <Plus className="h-4 w-4" />
                Add new template
              </Button>

            </div>
          </div>
        ) : null}

        {selectedSection === 'summaryTemplates' ? (
          <div className="space-y-3">
            <div className="px-2">
              <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Templates</div>
              <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Define how meeting summaries should be generated with custom prompts.
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="h-12 w-full justify-start rounded-lg px-3 text-sm font-semibold"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Plus className="h-4 w-4" />
              Add new template
            </Button>
          </div>
        ) : null}

        {selectedSection === 'preferences' ? (
          <div className="space-y-3">
            <div>
              <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">Meeting notifications</div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex min-h-14 items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      Remind me before meetings
                    </div>
                    <div className="mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
                      Send notifications before the calendar event starts.
                    </div>
                  </div>
                  <Select defaultValue="5m">
                    <SelectTrigger
                      className="w-40 shrink-0"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="none">Don&apos;t notify me</SelectItem>
                      <SelectItem value="1m">Before 1m</SelectItem>
                      <SelectItem value="5m">Before 5m</SelectItem>
                      <SelectItem value="10m">Before 10m</SelectItem>
                      <SelectItem value="15m">Before 15m</SelectItem>
                      <SelectItem value="30m">Before 30m</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-h-14 items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                      Auto-detected meetings
                    </div>
                    <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                      Show notifications when a call is detected. You can mute specific apps below.
                    </div>
                  </div>
                  <ToggleSwitch enabled />
                </div>
              </div>
            </div>
            <div>
              <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">Behavior</div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                <SettingRow
                  label="Launch on Startup"
                  value="This will launch Orion automatically when your system starts."
                  action={<ToggleSwitch enabled />}
                />
              </div>
            </div>
            <div>
              <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">Audio recording</div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                <SettingRow
                  label="Storage location"
                  value="Where to store recorded audio"
                  action={
                    <Select
                      value={recordingSettings.storageLocation}
                      onValueChange={(value) => {
                        void updateRecordingSettings({
                          storageLocation: value === 'local' ? 'local' : 'server',
                        })
                      }}
                    >
                      <SelectTrigger
                        className="w-40"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="server">Orion server</SelectItem>
                        <SelectItem value="local">Local only</SelectItem>
                      </SelectContent>
                    </Select>
                  }
                />
                {recordingSettings.storageLocation === 'local' ? (
                  <SettingRow
                    label="Save recordings to"
                    value={recordingSettings.localRecordingsPath || 'No folder selected'}
                    action={
                      <Button type="button" variant="outline" size="sm" onClick={() => void chooseLocalRecordingsPath()}>
                        Choose folder
                      </Button>
                    }
                  />
                ) : null}
              </div>
            </div>
            <div>
              <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">Data retention</div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                <SettingRow
                  label="Auto-delete meetings after"
                  value="Automatically archive old meetings"
                  action={
                    <Select defaultValue="never">
                      <SelectTrigger
                        className="w-40"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="never">Never</SelectItem>
                        <SelectItem value="30">30 days</SelectItem>
                        <SelectItem value="90">90 days</SelectItem>
                        <SelectItem value="365">1 year</SelectItem>
                      </SelectContent>
                    </Select>
                  }
                />
              </div>
            </div>
          </div>
        ) : null}

        <ExtractFieldDialog
          isOpen={isExtractFieldDialogOpen}
          folders={folders}
          foldersLoading={isLoadingFolders}
          foldersError={foldersError}
          initialField={editingExtractField}
          submitting={createExtractFieldMutation.isPending || updateExtractFieldMutation.isPending}
          onClose={closeExtractFieldDialog}
          onSubmit={submitExtractField}
        />
        <DeleteExtractFieldDialog
          field={deletingExtractField}
          deleting={deleteExtractFieldMutation.isPending}
          error={deleteExtractFieldError}
          onClose={() => {
            setDeletingExtractField(null)
            setDeleteExtractFieldError(null)
          }}
          onConfirm={() => void confirmDeleteExtractField()}
        />
      </DashboardPanelBody>
    </DashboardPanel>
  )
}
