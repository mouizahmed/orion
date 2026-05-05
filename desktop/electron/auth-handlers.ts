import { ipcMain, shell } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { config } from './config'

type AuthPhase = 'initializing' | 'signed-out' | 'oauth-pending' | 'signed-in'

let authPhase: AuthPhase = 'initializing'
let authCallbacks: AuthStateCallbacks = {}
let authStateChangeSequence = 0

type ActiveOAuthTransaction = {
  state: string
  provider: LoginProvider
  codeVerifier: string
}

let activeOAuthTransaction: ActiveOAuthTransaction | null = null
let activeOAuthExpiryTimer: ReturnType<typeof setTimeout> | null = null

type AuthStateCallbacks = {
  onSignedIn?: () => void
  onSignedOut?: () => void
  onOAuthPending?: () => void
}

export function isRendererAuthenticated(): boolean {
  return authPhase === 'signed-in'
}

type LoginProvider = 'google' | 'microsoft'

type AuthStartResult = {
  expiresInSeconds: number
}

type RendererAuthStateChangedPayload = {
  isAuthenticated?: boolean
  idToken?: unknown
}

function setAuthPhase(nextPhase: AuthPhase) {
  if (authPhase === nextPhase) return

  console.log(`Main auth phase changed: ${authPhase} -> ${nextPhase}`)
  authPhase = nextPhase

  if (nextPhase === 'signed-in') {
    authCallbacks.onSignedIn?.()
    return
  }

  if (nextPhase === 'oauth-pending') {
    authCallbacks.onOAuthPending?.()
    return
  }

  authCallbacks.onSignedOut?.()
}

function normalizeIdToken(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function verifyRendererAuthState(idToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${config.backendUrl}/api/user/me`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    })
    return response.ok
  } catch (error) {
    console.warn('Main auth state verification failed:', error)
    return false
  }
}

function clearActiveOAuthTransaction(state?: string) {
  if (!activeOAuthTransaction) return
  if (state && activeOAuthTransaction.state !== state) return
  if (activeOAuthExpiryTimer) {
    clearTimeout(activeOAuthExpiryTimer)
    activeOAuthExpiryTimer = null
  }
  activeOAuthTransaction = null
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function generateCodeVerifier(): string {
  return base64Url(randomBytes(32))
}

function codeChallengeFromVerifier(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest())
}

function setActiveOAuthTransaction(provider: LoginProvider, state: string, codeVerifier: string, expiresInSeconds: number) {
  clearActiveOAuthTransaction()

  activeOAuthTransaction = {
    provider,
    state,
    codeVerifier,
  }

  activeOAuthExpiryTimer = setTimeout(() => {
    if (activeOAuthTransaction?.state !== state) return
    clearActiveOAuthTransaction(state)
    setAuthPhase('signed-out')
  }, expiresInSeconds * 1000)
}

export function isActiveOAuthState(state: string | null): state is string {
  return Boolean(state && activeOAuthTransaction?.state === state)
}

export function getActiveOAuthCodeVerifier(state: string): string | null {
  if (activeOAuthTransaction?.state !== state) return null
  return activeOAuthTransaction.codeVerifier
}

export function completeActiveOAuthTransaction(state: string) {
  clearActiveOAuthTransaction(state)
}

export function rejectActiveOAuthTransaction(state: string) {
  clearActiveOAuthTransaction(state)
  setAuthPhase('signed-out')
}

async function handleOAuth(provider: LoginProvider, setAuthPhase: (nextPhase: AuthPhase) => void): Promise<AuthStartResult> {
  authStateChangeSequence++
  setAuthPhase('oauth-pending')

  try {
    const codeVerifier = generateCodeVerifier()
    const params = new URLSearchParams({
      provider,
      platform: 'desktop',
      response: 'json',
      code_challenge: codeChallengeFromVerifier(codeVerifier),
      code_challenge_method: 'S256',
    })
    const response = await fetch(`${config.backendUrl}/auth/start?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`Failed to start authentication (${response.status})`)
    }

    const payload = (await response.json()) as {
      auth_url?: string
      state?: string
      expires_in_seconds?: number
    }

    if (!payload.auth_url || !payload.state) {
      throw new Error('Authentication start response was missing auth_url or state')
    }
    const expiresInSeconds = payload.expires_in_seconds
    if (!expiresInSeconds || expiresInSeconds <= 0) {
      throw new Error('Authentication start response was missing a valid expiry')
    }

    setActiveOAuthTransaction(provider, payload.state, codeVerifier, expiresInSeconds)
    await shell.openExternal(payload.auth_url)
    return { expiresInSeconds }
  } catch (error) {
    clearActiveOAuthTransaction()
    setAuthPhase('signed-out')
    console.error(`${provider} OAuth error:`, error)
    throw error
  }
}

export function setupAuthHandlers(callbacks: AuthStateCallbacks = {}) {
  authCallbacks = callbacks

  ipcMain.on('auth:state-changed', async (_event, payload?: RendererAuthStateChangedPayload) => {
    const sequence = ++authStateChangeSequence
    const nextAuthenticated = Boolean(payload?.isAuthenticated)
    if (!nextAuthenticated) {
      clearActiveOAuthTransaction()
      setAuthPhase('signed-out')
      return
    }

    const idToken = normalizeIdToken(payload?.idToken)
    if (!idToken) {
      setAuthPhase('signed-out')
      return
    }

    const verified = await verifyRendererAuthState(idToken)
    if (sequence !== authStateChangeSequence) return

    if (verified) {
      clearActiveOAuthTransaction()
      setAuthPhase('signed-in')
      return
    }

    setAuthPhase('signed-out')
  })

  ipcMain.handle('auth:google', async () => {
    try {
      const result = await handleOAuth('google', setAuthPhase)
      return { success: true, expiresInSeconds: result.expiresInSeconds }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle('auth:microsoft', async () => {
    try {
      const result = await handleOAuth('microsoft', setAuthPhase)
      return { success: true, expiresInSeconds: result.expiresInSeconds }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle('auth:cancel', async () => {
    const activeState = activeOAuthTransaction?.state
    clearActiveOAuthTransaction()

    if (activeState) {
      try {
        const response = await fetch(`${config.backendUrl}/auth/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: activeState }),
        })
        if (!response.ok) {
          console.warn(`OAuth cancel request failed: ${response.status}`)
        }
      } catch (error) {
        console.warn('OAuth cancel request failed:', error)
      }
    }

    if (authPhase === 'oauth-pending') {
      setAuthPhase('signed-out')
    }
    return { success: true }
  })

  ipcMain.handle('auth:logout', async () => {
    authStateChangeSequence++
    clearActiveOAuthTransaction()
    setAuthPhase('signed-out')
    return { success: true }
  })
}
