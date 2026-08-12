import { auth } from '@/config/firebase'
import { desktopApi } from '@/lib/desktop-api'

const CACHED_USER_KEY = 'orion:cached-user'
export const SESSION_EXPIRED_MESSAGE_KEY = 'orion:session-expired-message'
const LOGOUT_STORAGE_KEYS = [
  'dashboard:selectedNoteId',
  'dashboard:selectedFolderId',
  'chat:activeConversationId',
  CACHED_USER_KEY,
]
const LOGOUT_STORAGE_PREFIXES = ['orion:local-meeting-']

export const SESSION_EXPIRED_MESSAGE = 'Your session expired. Please sign in again.'
export const SESSION_EXPIRED_EVENT = 'orion:session-expired'

export class SessionExpiredError extends Error {
  constructor(message = SESSION_EXPIRED_MESSAGE) {
    super(message)
    this.name = 'SessionExpiredError'
  }
}

let invalidationPromise: Promise<void> | null = null

export function clearKnownSessionStorage() {
  try {
    for (const key of LOGOUT_STORAGE_KEYS) {
      localStorage.removeItem(key)
    }

    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (!key) continue
      if (LOGOUT_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    // Session invalidation must continue even when local storage is unavailable.
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
    try {
      localStorage.setItem(SESSION_EXPIRED_MESSAGE_KEY, SESSION_EXPIRED_MESSAGE)
    } catch {
      // The in-window event still communicates the reason where possible.
    }

    // Clear Electron's authenticated state immediately, even if Firebase
    // sign-out takes a moment to finish.
    desktopApi.auth.notifyStateChanged({ isAuthenticated: false })

    try {
      await auth.signOut()
    } finally {
      await desktopApi.auth.logout().catch((error) => {
        console.warn('Failed to clear the Electron auth session:', error)
      })
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
    }
  })().finally(() => {
    invalidationPromise = null
  })

  return invalidationPromise
}

export async function getAuthenticatedIdToken(forceRefresh = false): Promise<string> {
  const currentUser = auth.currentUser
  if (!currentUser) {
    throw new SessionExpiredError()
  }

  try {
    return await currentUser.getIdToken(forceRefresh)
  } catch {
    await invalidateSession()
    throw new SessionExpiredError()
  }
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const requestTemplate = input instanceof Request ? input.clone() : input

  const send = async (forceRefresh: boolean) => {
    const token = await getAuthenticatedIdToken(forceRefresh)
    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init.headers).forEach((value, key) => headers.set(key, value))
    headers.set('Authorization', `Bearer ${token}`)

    const requestInput = requestTemplate instanceof Request
      ? requestTemplate.clone()
      : requestTemplate

    return fetch(requestInput, { ...init, headers })
  }

  const response = await send(false)
  if (response.status !== 401) return response

  try {
    const retriedResponse = await send(true)
    if (retriedResponse.status !== 401) return retriedResponse
  } catch (error) {
    if (error instanceof SessionExpiredError) throw error
  }

  await invalidateSession()
  throw new SessionExpiredError()
}
