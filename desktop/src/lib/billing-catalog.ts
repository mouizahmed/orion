import catalogJson from '../../../backend/internal/entitlements/catalog.json'

export type BillingPlanKey = 'free' | 'professional' | 'business'
export type BillingOfferKey = 'professional_monthly' | 'professional_annual'

export type BillingPlan = {
  key: BillingPlanKey
  name: string
  includedTranscriptionMinutes: number
  features: string[]
  marketed?: boolean
}

export type BillingOffer = {
  key: BillingOfferKey
  planKey: BillingPlanKey
  currency: 'usd'
  unitAmountCents: number
  interval: 'month' | 'year'
  trialDays: number
}

const catalog = catalogJson as { plans: BillingPlan[]; offers: BillingOffer[] }

export function billingPlan(key: BillingPlanKey) {
  const plan = catalog.plans.find((candidate) => candidate.key === key)
  if (!plan) throw new Error(`Product catalog is missing plan ${key}`)
  return plan
}

export function billingOffer(key: BillingOfferKey) {
  const offer = catalog.offers.find((candidate) => candidate.key === key)
  if (!offer) throw new Error(`Product catalog is missing offer ${key}`)
  return offer
}

export function formatUSD(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}
