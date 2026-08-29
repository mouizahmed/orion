import { desktopApi } from '@/lib/desktop-api'

export const SESSION_EXPIRED_MESSAGE_KEY = 'orion:session-expired-message'
const LOGOUT_STORAGE_KEYS = [
  'dashboard:selectedNoteId',
  'dashboard:selectedFolderId',
  'orion:cached-user',
  'orion.billing.pending-checkout',
]

export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please sign in again.'
export const SESSION_EXPIRED_EVENT = 'orion:session-expired'
export const AUTH_SERVICE_UNAVAILABLE_MESSAGE = 'Authentication service is unavailable.'

export class SessionExpiredError extends Error {
  constructor(message = SESSION_EXPIRED_MESSAGE) {
    super(message)
    this.name = 'SessionExpiredError'
  }
}

export class AuthServiceUnavailableError extends Error {
  constructor() {
    super(AUTH_SERVICE_UNAVAILABLE_MESSAGE)
    this.name = 'AuthServiceUnavailableError'
  }
}

export class AccountUnavailableError extends Error {
  constructor(message = 'Your Orion account is not available.') {
    super(message)
    this.name = 'AccountUnavailableError'
  }
}

function isServiceUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(AUTH_SERVICE_UNAVAILABLE_MESSAGE)
}

let invalidationPromise: Promise<void> | null = null

export function clearKnownSessionStorage() {
  try {
    for (const key of LOGOUT_STORAGE_KEYS) localStorage.removeItem(key)
    // User-created local meeting drafts are deliberately retained on sign-out.
  } catch {
    // Main-process session invalidation must continue if renderer storage fails.
  }
}

export function consumeSessionExpiredMessage(): string | null {
  try {
    const message = localStorage.getItem(SESSION_EXPIRED_MESSAGE_KEY)
    localStorage.removeItem(SESSION_EXPIRED_MESSAGE_KEY)
    return message
  } catch {
    return null
  }
}

export function invalidateSession(): Promise<void> {
  if (invalidationPromise) return invalidationPromise
  invalidationPromise = (async () => {
    clearKnownSessionStorage()
    try { localStorage.setItem(SESSION_EXPIRED_MESSAGE_KEY, SESSION_EXPIRED_MESSAGE) } catch { /* event still notifies this window */ }
    await desktopApi.auth.logout().catch(() => undefined)
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
  })().finally(() => { invalidationPromise = null })
  return invalidationPromise
}

export async function getAuthenticatedAccessToken(forceRefresh = false): Promise<string> {
  try {
    return await desktopApi.auth.getAccessToken(forceRefresh)
  } catch (error) {
    if (isServiceUnavailableError(error)) throw new AuthServiceUnavailableError()

    const snapshot = await desktopApi.auth.revalidate().catch(() => null)
    if (snapshot?.status === 'service-unavailable') throw new AuthServiceUnavailableError()
    if (snapshot?.status === 'blocked') {
      throw new AccountUnavailableError(snapshot.error || undefined)
    }
    await invalidateSession()
    throw new SessionExpiredError()
  }
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const template = input instanceof Request ? input.clone() : input
  const send = async (forceRefresh: boolean) => {
    const token = await getAuthenticatedAccessToken(forceRefresh)
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
    headers.set('Authorization', `Bearer ${token}`)
    return fetch(template instanceof Request ? template.clone() : template, { ...init, headers })
  }

  const response = await send(false)
  if (response.status !== 401) {
    if (response.status === 403) await desktopApi.auth.revalidate().catch(() => undefined)
    return response
  }
  const retried = await send(true)
  if (retried.status !== 401) return retried
  await invalidateSession()
  throw new SessionExpiredError()
}
