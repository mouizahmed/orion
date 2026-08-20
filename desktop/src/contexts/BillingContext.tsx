import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { useAuth } from '@/contexts/AuthContext'
import { authenticatedFetch } from '@/lib/auth-session'
import { API_BASE_URL } from '@/lib/api-config'
import { writePendingCheckoutOperation } from '@/lib/billing-checkout'
import { desktopApi } from '@/lib/desktop-api'
import { queryKeys } from '@/lib/query-keys'

export type BillingPlanKey = 'free' | 'professional' | 'business'
export type BillingOfferKey = 'professional_monthly' | 'professional_annual'

export type BillingStatus = {
  enabled: boolean
  effective_plan: BillingPlanKey
  offer?: BillingOfferKey
  subscription_status?: string
  renews_or_ends_at?: string
  cancel_at_period_end: boolean
  scheduled_to_end: boolean
  trial_ends_at?: string
}

type BillingStatusView = Omit<BillingStatus, 'enabled'> & { enabled?: boolean }

type BillingContextValue = {
  status: BillingStatusView | null
  hasAuthoritativeStatus: boolean
  isRefreshing: boolean
  processingReturn: boolean
  error: string | null
  refresh: () => Promise<BillingStatus | null>
}

const BillingContext = createContext<BillingContextValue | undefined>(undefined)
const BILLING_STATUS_STALE_TIME_MS = 30_000

function isPlanKey(value: unknown): value is BillingPlanKey {
  return value === 'free' || value === 'professional' || value === 'business'
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value ? value : undefined
}

function parseBillingStatus(payload: unknown): BillingStatus {
  const data = payload as Record<string, unknown>
  if (typeof data?.enabled !== 'boolean' || !isPlanKey(data.effective_plan)) {
    throw new Error('Billing status response was invalid')
  }
  const offer = data.offer === 'professional_monthly' || data.offer === 'professional_annual'
    ? data.offer
    : undefined
  return {
    enabled: data.enabled,
    effective_plan: data.effective_plan,
    offer,
    subscription_status: optionalString(data.subscription_status),
    renews_or_ends_at: optionalString(data.renews_or_ends_at),
    cancel_at_period_end: data.cancel_at_period_end === true,
    scheduled_to_end: data.scheduled_to_end === true,
    trial_ends_at: optionalString(data.trial_ends_at),
  }
}

async function requestBillingStatus(signal?: AbortSignal): Promise<BillingStatus> {
  const response = await authenticatedFetch(`${API_BASE_URL}/billing/status`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error('Billing status is unavailable')
  return parseBillingStatus(await response.json())
}

function billingStatusQueryOptions(accountID: string) {
  return {
    queryKey: queryKeys.billingStatus(accountID),
    queryFn: ({ signal }: { signal: AbortSignal }) => requestBillingStatus(signal),
    staleTime: BILLING_STATUS_STALE_TIME_MS,
  }
}

export function BillingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const accountID = user?.id
  const statusQuery = useQuery({
    ...billingStatusQueryOptions(accountID ?? 'anonymous'),
    enabled: Boolean(accountID),
  })
  const [processingReturn, setProcessingReturn] = useState(false)
  const authoritativeStatusRef = useRef<BillingStatus | null>(null)

  const refresh = useCallback(async () => {
    if (!accountID) return null
    return queryClient.fetchQuery({
      ...billingStatusQueryOptions(accountID),
      staleTime: 0,
    })
  }, [accountID, queryClient])

  useEffect(() => {
    if (!user) setProcessingReturn(false)
  }, [user])

  useEffect(() => {
    let disposed = false
    let pollGeneration = 0
    const unsubscribe = desktopApi.appEvents.onMainProcessMessage((message) => {
      if (!message || typeof message !== 'object') return
      const event = message as { type?: string; result?: string }
      if (event.type !== 'billing_state_changed') return

      const generation = ++pollGeneration
      if (event.result === 'cancelled') {
        setProcessingReturn(false)
        void refresh().catch(() => undefined)
        return
      }

      const previousStatus = authoritativeStatusRef.current
      // Checkout represents a known pending subscription operation, so keep its
      // confirmation state visible. A Customer Portal return is only navigation:
      // refresh and retry silently while its webhook catches up.
      setProcessingReturn(event.result === 'success')
      void (async () => {
        try {
          const attempts = event.result === 'success' ? 10 : 5
          for (let attempt = 0; attempt < attempts && !disposed && generation === pollGeneration; attempt += 1) {
            try {
              const next = await refresh()
              const checkoutConfirmed = event.result === 'success' && next?.effective_plan === 'professional'
              const portalChangeConfirmed = event.result === 'portal'
                && previousStatus !== null
                && JSON.stringify(next) !== JSON.stringify(previousStatus)
              if (checkoutConfirmed) {
                writePendingCheckoutOperation(null)
                break
              }
              if (portalChangeConfirmed) break
            } catch {
              // Preserve the last cached status while Stripe webhook processing catches up.
            }
            if (attempt < attempts - 1) await new Promise((resolve) => window.setTimeout(resolve, 2_000))
          }
        } finally {
          if (!disposed && generation === pollGeneration) setProcessingReturn(false)
        }
      })()
    })

    return () => {
      disposed = true
      pollGeneration += 1
      unsubscribe()
    }
  }, [refresh])

  const authoritativeStatus = user ? statusQuery.data ?? null : null
  authoritativeStatusRef.current = authoritativeStatus

  const status = useMemo<BillingStatusView | null>(() => {
    if (!user) return null
    if (authoritativeStatus) return authoritativeStatus
    return {
      effective_plan: user.plan,
      cancel_at_period_end: false,
      scheduled_to_end: false,
    }
  }, [authoritativeStatus, user])

  const value = useMemo<BillingContextValue>(() => ({
    status,
    hasAuthoritativeStatus: authoritativeStatus !== null,
    isRefreshing: statusQuery.isFetching,
    processingReturn,
    error: statusQuery.error instanceof Error ? statusQuery.error.message : null,
    refresh,
  }), [authoritativeStatus, processingReturn, refresh, status, statusQuery.error, statusQuery.isFetching])

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>
}

export function useBilling() {
  const context = useContext(BillingContext)
  if (!context) throw new Error('useBilling must be used within a BillingProvider')
  return context
}
