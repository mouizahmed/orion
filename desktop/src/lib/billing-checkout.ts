export type PendingCheckoutOperation = {
  offer: 'professional_monthly' | 'professional_annual'
  requestID: string
  createdAt: number
}

const PENDING_CHECKOUT_STORAGE_KEY = 'orion.billing.pending-checkout'
export const CHECKOUT_OPERATION_LIFETIME_MS = 32 * 60 * 1000

export function readPendingCheckoutOperation(): PendingCheckoutOperation | null {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_CHECKOUT_STORAGE_KEY) ?? 'null') as Partial<PendingCheckoutOperation> | null
    if (
      !value
      || (value.offer !== 'professional_monthly' && value.offer !== 'professional_annual')
      || typeof value.requestID !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestID)
      || typeof value.createdAt !== 'number'
      || Date.now() - value.createdAt >= CHECKOUT_OPERATION_LIFETIME_MS
    ) {
      localStorage.removeItem(PENDING_CHECKOUT_STORAGE_KEY)
      return null
    }
    return value as PendingCheckoutOperation
  } catch {
    localStorage.removeItem(PENDING_CHECKOUT_STORAGE_KEY)
    return null
  }
}

export function writePendingCheckoutOperation(operation: PendingCheckoutOperation | null) {
  if (operation) localStorage.setItem(PENDING_CHECKOUT_STORAGE_KEY, JSON.stringify(operation))
  else localStorage.removeItem(PENDING_CHECKOUT_STORAGE_KEY)
}

