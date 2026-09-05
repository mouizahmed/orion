import { app, BrowserWindow, ipcMain, safeStorage, shell, type WebContents } from 'electron'
import Store from 'electron-store'
import { createClient, isAuthRetryableFetchError, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { config } from './config'

export type AuthStatus =
  | 'initializing'
  | 'validating'
  | 'anonymous'
  | 'oauth-pending'
  | 'authenticated'
  | 'service-unavailable'
  | 'blocked'

export type AuthUser = {
  id: string
  email: string
  name: string
  plan: 'free' | 'professional' | 'business'
  picture?: string
}

export type AuthSnapshot = {
  status: AuthStatus
  user: AuthUser | null
  error: string | null
  loginProvider: LoginProvider | null
}

type LoginProvider = 'google' | 'microsoft'
type StoredAuth = { values: Record<string, string> }
type ActiveLogin = {
  provider: LoginProvider
  expiresAt: number
  cancelled: boolean
  callbackStarted: boolean
}

const PENDING_LOGIN_STORAGE_KEY = 'orion:pending-auth-login'
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000
const MICROSOFT_GRAPH_PHOTO_URL = 'https://graph.microsoft.com/v1.0/me/photos/240x240/$value'
const MAX_IMPORTED_AVATAR_BYTES = 4 * 1024 * 1024
const IMPORTED_AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const AUTH_SERVICE_UNAVAILABLE_MESSAGE = 'Authentication service is unavailable.'

type AuthStateCallbacks = {
  onSignedIn?: () => void
  onSignedOut?: () => void
  onOAuthPending?: () => void
  isKnownRendererSender?: (sender: WebContents) => boolean
  isAuthRendererSender?: (sender: WebContents) => boolean
}

function withoutProviderTokens(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return value
    const stored = parsed as Record<string, unknown>
    if (
      !Object.prototype.hasOwnProperty.call(stored, 'provider_token')
      && !Object.prototype.hasOwnProperty.call(stored, 'provider_refresh_token')
    ) return value
    delete stored.provider_token
    delete stored.provider_refresh_token
    return JSON.stringify(stored)
  } catch {
    return value
  }
}

class EncryptedAuthStorage {
  private readonly store = new Store<StoredAuth>({ name: 'orion-auth', defaults: { values: {} } })
  private readonly memory = new Map<string, string>()
  private operation: Promise<unknown> = Promise.resolve()

  private serialized<T>(work: () => T | Promise<T>): Promise<T> {
    const next = this.operation.then(work, work)
    this.operation = next.then(() => undefined, () => undefined)
    return next
  }

  private securePersistenceAvailable(): boolean {
    const selectedBackend = safeStorage.getSelectedStorageBackend?.()
    return safeStorage.isEncryptionAvailable() && selectedBackend !== 'basic_text'
  }

  async getItem(key: string): Promise<string | null> {
    return this.serialized(() => {
      if (!this.securePersistenceAvailable()) {
        if (app.isPackaged) throw new Error('Secure session storage is unavailable')
        const value = this.memory.get(key)
        return value ? withoutProviderTokens(value) : null
      }
      const encrypted = this.store.get('values')[key]
      if (!encrypted) return null
      try {
        const decrypted = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
        const safeValue = withoutProviderTokens(decrypted)
        if (safeValue !== decrypted) {
          const values = { ...this.store.get('values') }
          values[key] = safeStorage.encryptString(safeValue).toString('base64')
          this.store.set('values', values)
        }
        return safeValue
      } catch {
        const values = { ...this.store.get('values') }
        delete values[key]
        this.store.set('values', values)
        throw new Error('Encrypted session data could not be read')
      }
    })
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.serialized(() => {
      const safeValue = withoutProviderTokens(value)
      if (!this.securePersistenceAvailable()) {
        if (app.isPackaged) throw new Error('Secure session storage is unavailable')
        this.memory.set(key, safeValue)
        return
      }
      const values = { ...this.store.get('values') }
      values[key] = safeStorage.encryptString(safeValue).toString('base64')
      this.store.set('values', values)
    })
  }

  async removeItem(key: string): Promise<void> {
    await this.serialized(() => {
      this.memory.delete(key)
      const values = { ...this.store.get('values') }
      if (key in values) {
        delete values[key]
        this.store.set('values', values)
      }
    })
  }

  async clearPKCEMaterial(): Promise<void> {
    await this.serialized(() => {
      for (const key of [...this.memory.keys()]) {
        if (key.includes('code-verifier')) this.memory.delete(key)
      }
      const values = { ...this.store.get('values') }
      let changed = false
      for (const key of Object.keys(values)) {
        if (key.includes('code-verifier')) {
          delete values[key]
          changed = true
        }
      }
      if (changed) this.store.set('values', values)
    })
  }

  async clearAll(): Promise<void> {
    await this.serialized(() => {
      this.memory.clear()
      this.store.set('values', {})
    })
  }
}

const storage = new EncryptedAuthStorage()
let client: SupabaseClient | null = null
let callbacks: AuthStateCallbacks = {}
let snapshot: AuthSnapshot = { status: 'initializing', user: null, error: null, loginProvider: null }
let currentAccessToken: string | null = null
let activeLogin: ActiveLogin | null = null
let activeLoginTimer: ReturnType<typeof setTimeout> | null = null
let callbackExchangeInProgress = false
let queuedAuthCallback: string | null = null
let validationOperation: Promise<void> | null = null

export function isRendererAuthenticated(): boolean {
  return snapshot.status === 'authenticated' && Boolean(snapshot.user)
}

export function getCurrentAuthToken(): string | null {
  return isRendererAuthenticated() ? currentAccessToken : null
}

export function getCurrentAuthUserId(): string | null {
  return isRendererAuthenticated() ? snapshot.user?.id ?? null : null
}

export function getCurrentAuthTokenForRequest(forceRefresh = false): Promise<string> {
  return currentToken(forceRefresh)
}

function publicSnapshot(): AuthSnapshot {
  return { ...snapshot, user: snapshot.user ? { ...snapshot.user } : null }
}

function publish(next: AuthSnapshot) {
  const previousStatus = snapshot.status
  snapshot = next
  if (next.status !== 'authenticated') currentAccessToken = null
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('auth:changed', publicSnapshot())
  }
  if (next.status === 'authenticated' && previousStatus !== 'authenticated') callbacks.onSignedIn?.()
  else if (next.status === 'oauth-pending') callbacks.onOAuthPending?.()
  else if (next.status === 'anonymous' || next.status === 'blocked' || next.status === 'service-unavailable') callbacks.onSignedOut?.()
}

function asUser(payload: unknown): AuthUser {
  const data = payload as Record<string, unknown>
  const id = typeof data.id === 'string' ? data.id : ''
  const email = typeof data.email === 'string' ? data.email : ''
  const name = typeof data.name === 'string' ? data.name : ''
  const plan = data.plan === 'free' || data.plan === 'professional' || data.plan === 'business' ? data.plan : ''
  const picture = typeof data.avatar_url === 'string' && data.avatar_url ? data.avatar_url : undefined
  if (!id || !email || !name || !plan) throw new Error('Backend session response did not contain a valid user')
  return { id, email, name, plan, picture }
}

async function bootstrap(session: Session, shouldContinue: () => boolean = () => true): Promise<void> {
  if (!shouldContinue()) return
  // Startup and OAuth completion need an explicit loading state. Background
  // revalidation should keep an already-authenticated renderer stable until
  // the backend returns the authoritative next state.
  if (snapshot.status !== 'authenticated' && snapshot.status !== 'validating') {
    publish({ status: 'validating', user: null, error: null, loginProvider: null })
  }
  try {
    const response = await fetch(`${config.backendUrl}/api/auth/session`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${session.access_token}` },
    })
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!shouldContinue()) return
    if (response.ok) {
      const user = asUser(payload.user)
      currentAccessToken = session.access_token
      publish({ status: 'authenticated', user, error: null, loginProvider: null })
      return
    }
    const message = typeof payload.message === 'string' ? payload.message : 'Authentication failed.'
    if (response.status === 503) {
      publish({ status: 'service-unavailable', user: null, error: message, loginProvider: null })
      return
    }
    if (response.status === 403) {
      publish({ status: 'blocked', user: null, error: message, loginProvider: null })
      return
    }
    await client?.auth.signOut({ scope: 'local' })
    if (!shouldContinue()) return
    publish({ status: 'anonymous', user: null, error: message, loginProvider: null })
  } catch {
    if (!shouldContinue()) return
    publish({ status: 'service-unavailable', user: null, error: 'Authentication service is unavailable.', loginProvider: null })
  }
}

function validateSession(session: Session, shouldContinue?: () => boolean): Promise<void> {
  if (shouldContinue) return bootstrap(session, shouldContinue)
  if (validationOperation) return validationOperation
  validationOperation = bootstrap(session).finally(() => { validationOperation = null })
  return validationOperation
}

async function importMicrosoftAvatar(providerToken: string, session: Session): Promise<void> {
  if (snapshot.status !== 'authenticated' || snapshot.user?.picture) return

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const graphResponse = await fetch(MICROSOFT_GRAPH_PHOTO_URL, {
      headers: { Accept: 'image/jpeg, image/png, image/gif, image/webp', Authorization: `Bearer ${providerToken}` },
      redirect: 'error',
      signal: controller.signal,
    })
    if (graphResponse.status === 404) return
    if (!graphResponse.ok) throw new Error(`Microsoft Graph photo request failed (${graphResponse.status})`)

    const declaredSize = Number(graphResponse.headers.get('content-length'))
    if (Number.isFinite(declaredSize) && declaredSize > MAX_IMPORTED_AVATAR_BYTES) {
      throw new Error('Microsoft profile photo is too large')
    }
    const mimeType = (graphResponse.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
    if (!IMPORTED_AVATAR_MIME_TYPES.has(mimeType)) throw new Error('Microsoft returned an unsupported profile photo')

    const bytes = await graphResponse.arrayBuffer()
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMPORTED_AVATAR_BYTES) {
      throw new Error('Microsoft returned an invalid profile photo')
    }

    const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/gif' ? 'gif' : mimeType === 'image/webp' ? 'webp' : 'jpg'
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: mimeType }), `microsoft-avatar.${extension}`)
    const uploadResponse = await fetch(`${config.backendUrl}/api/user/me/avatar/provider`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: form,
    })
    const payload = await uploadResponse.json().catch(() => ({}))
    if (!uploadResponse.ok) throw new Error(`Orion profile photo import failed (${uploadResponse.status})`)

    const user = asUser(payload)
    currentAccessToken = session.access_token
    publish({ status: 'authenticated', user, error: null, loginProvider: null })
  } finally {
    clearTimeout(timeout)
  }
}

async function clearActiveLogin() {
  activeLogin = null
  if (activeLoginTimer) clearTimeout(activeLoginTimer)
  activeLoginTimer = null
  await storage.removeItem(PENDING_LOGIN_STORAGE_KEY)
}

function isActiveLogin(login: ActiveLogin): boolean {
  return activeLogin === login && !login.cancelled
}

async function discardCancelledSession(session: Session | null) {
  try {
    if (session) {
      const { error } = await client!.auth.signOut({ scope: 'local' })
      if (error) console.warn('Cancelled authentication session could not be revoked immediately:', error)
    }
  } catch (error) {
    console.warn('Cancelled authentication session could not be revoked immediately:', error)
  } finally {
    await storage.clearAll()
  }
}

function armActiveLoginTimer(login: ActiveLogin) {
  if (activeLoginTimer) clearTimeout(activeLoginTimer)
  activeLoginTimer = setTimeout(() => {
    if (!activeLogin || activeLogin.expiresAt !== login.expiresAt) return
    void cancelLogin().then(() => publish({ status: 'anonymous', user: null, error: 'Authentication timed out. Please try again.', loginProvider: null }))
  }, Math.max(0, login.expiresAt - Date.now()))
}

async function restoreActiveLogin(): Promise<boolean> {
  const raw = await storage.getItem(PENDING_LOGIN_STORAGE_KEY)
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveLogin>
    if (
      (parsed.provider !== 'google' && parsed.provider !== 'microsoft')
      || typeof parsed.expiresAt !== 'number'
      || !Number.isFinite(parsed.expiresAt)
      || parsed.expiresAt <= Date.now()
      || parsed.expiresAt > Date.now() + LOGIN_TIMEOUT_MS
    ) {
      throw new Error('Invalid pending login')
    }
    activeLogin = {
      provider: parsed.provider,
      expiresAt: parsed.expiresAt,
      cancelled: false,
      callbackStarted: false,
    }
    armActiveLoginTimer(activeLogin)
    return true
  } catch {
    await clearActiveLogin()
    await storage.clearPKCEMaterial()
    return false
  }
}

async function cancelLogin() {
  if (activeLogin) activeLogin.cancelled = true
  await clearActiveLogin()
  await storage.clearPKCEMaterial()
  try {
    const { data } = await client!.auth.getSession()
    if (data.session) {
      const { error } = await client!.auth.signOut({ scope: 'local' })
      if (error) console.warn('Authentication cancellation could not revoke a completed session immediately:', error)
    }
  } catch (error) {
    console.warn('Authentication cancellation could not revoke a completed session immediately:', error)
  } finally {
    await storage.clearAll()
  }
  publish({ status: 'anonymous', user: null, error: null, loginProvider: null })
}

function validateAuthorizationUrl(provider: LoginProvider, raw: string): string {
  const parsed = new URL(raw)
  const project = new URL(config.supabaseUrl)
  if (parsed.protocol !== 'https:' || parsed.origin !== project.origin || parsed.pathname !== '/auth/v1/authorize' || parsed.username || parsed.password) {
    throw new Error('Supabase returned an unexpected authorization URL')
  }
  const expectedProvider = provider === 'microsoft' ? 'azure' : 'google'
  const requestedScopes = (parsed.searchParams.get('scopes') || '').split(/\s+/).filter(Boolean)
  const allowedScopes = provider === 'microsoft'
    ? new Set(['openid', 'email', 'profile', 'User.Read'])
    : new Set([
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ])
  const singletonParameters = ['provider', 'redirect_to', 'code_challenge', 'code_challenge_method', 'scopes']
  if (
    singletonParameters.some((name) => parsed.searchParams.getAll(name).length > 1)
    || parsed.searchParams.get('provider') !== expectedProvider
    || parsed.searchParams.get('redirect_to') !== config.authCallbackUrl
    || !parsed.searchParams.get('code_challenge')
    || parsed.searchParams.get('code_challenge_method')?.toLowerCase() !== 's256'
    || requestedScopes.some((scope) => !allowedScopes.has(scope))
    || (provider === 'microsoft' && (!requestedScopes.includes('email') || !requestedScopes.includes('profile') || !requestedScopes.includes('User.Read')))
  ) {
    throw new Error('Supabase returned an invalid authorization transaction')
  }
  return parsed.toString()
}

async function beginLogin(provider: LoginProvider) {
  if (activeLogin || callbackExchangeInProgress) throw new Error('Another login is already in progress')
  const expiresAt = Date.now() + LOGIN_TIMEOUT_MS
  activeLogin = { provider, expiresAt, cancelled: false, callbackStarted: false }
  await storage.setItem(PENDING_LOGIN_STORAGE_KEY, JSON.stringify(activeLogin))
  publish({ status: 'oauth-pending', user: null, error: null, loginProvider: provider })
  try {
    const { data, error } = await client!.auth.signInWithOAuth({
      provider: provider === 'microsoft' ? 'azure' : 'google',
      options: {
        redirectTo: config.authCallbackUrl,
        skipBrowserRedirect: true,
        scopes: provider === 'microsoft' ? 'email profile User.Read' : undefined,
      },
    })
    if (error || !data.url) throw error ?? new Error('Supabase did not return an authorization URL')
    await shell.openExternal(validateAuthorizationUrl(provider, data.url))
    armActiveLoginTimer(activeLogin)
    return { success: true as const, expiresInSeconds: 600 }
  } catch (error) {
    await clearActiveLogin()
    await storage.clearPKCEMaterial()
    publish({ status: 'anonymous', user: null, error: error instanceof Error ? error.message : 'Authentication failed.', loginProvider: null })
    throw error
  }
}

export async function handleAuthProtocolCallback(rawUrl: string): Promise<void> {
  if (!client) {
    if (rawUrl.length <= 8192) queuedAuthCallback = rawUrl
    return
  }
  if (!activeLogin) return
  const login = activeLogin
  if (login.callbackStarted) return
  const parsed = new URL(rawUrl)
  if (parsed.protocol !== 'orion:' || parsed.hostname !== 'auth' || parsed.pathname !== '/callback' || rawUrl.length > 8192) return
  const allowedParameters = new Set(['code', 'error', 'error_code', 'error_description', 'sb_flow_id'])
  for (const name of parsed.searchParams.keys()) {
    if (!allowedParameters.has(name)) {
      await cancelLogin()
      publish({ status: 'anonymous', user: null, error: 'Authentication callback was invalid.', loginProvider: null })
      return
    }
  }
  for (const name of allowedParameters) {
    if (parsed.searchParams.getAll(name).length > 1) {
      await cancelLogin()
      publish({ status: 'anonymous', user: null, error: 'Authentication callback was invalid.', loginProvider: null })
      return
    }
  }
  if (Date.now() >= login.expiresAt) {
    await cancelLogin()
    publish({ status: 'anonymous', user: null, error: 'Authentication timed out. Please try again.', loginProvider: null })
    return
  }
  const errorCode = parsed.searchParams.get('error')
  const providerErrorCode = parsed.searchParams.get('error_code')
  const errorDescription = parsed.searchParams.get('error_description')
  const code = parsed.searchParams.get('code')
  const flowId = parsed.searchParams.get('sb_flow_id') || undefined
  if (
    Boolean(code) === Boolean(errorCode)
    || (errorCode?.length ?? 0) > 128
    || (providerErrorCode?.length ?? 0) > 128
    || (errorDescription?.length ?? 0) > 512
    || (providerErrorCode && !errorCode)
    || (errorDescription && !errorCode)
    || (code?.length ?? 0) > 2048
    || (flowId?.length ?? 0) > 512
    || (flowId && !code)
  ) {
    await cancelLogin()
    publish({ status: 'anonymous', user: null, error: 'Authentication callback was invalid.', loginProvider: null })
    return
  }
  if (errorCode) {
    const message = errorDescription || 'Authentication was cancelled.'
    await clearActiveLogin()
    await storage.clearPKCEMaterial()
    publish({ status: 'anonymous', user: null, error: message, loginProvider: null })
    return
  }
  if (!code) {
    await cancelLogin()
    publish({ status: 'anonymous', user: null, error: 'Authentication callback was invalid.', loginProvider: null })
    return
  }
  login.callbackStarted = true
  callbackExchangeInProgress = true
  publish({ status: 'validating', user: null, error: null, loginProvider: null })
  try {
    const { data, error } = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined)
    if (!isActiveLogin(login)) {
      await discardCancelledSession(data.session)
      return
    }
    if (error || !data.session) {
      await clearActiveLogin()
      await storage.clearPKCEMaterial()
      publish({ status: 'anonymous', user: null, error: 'Authentication could not be completed.', loginProvider: null })
      return
    }

    let microsoftProviderToken = login.provider === 'microsoft' ? data.session.provider_token || null : null
    delete data.session.provider_token
    delete data.session.provider_refresh_token
    await validateSession(data.session, () => isActiveLogin(login))
    if (!isActiveLogin(login)) {
      microsoftProviderToken = null
      await discardCancelledSession(data.session)
      return
    }

    await clearActiveLogin()
    if (microsoftProviderToken && snapshot.status === 'authenticated' && !snapshot.user?.picture) {
      try {
        await importMicrosoftAvatar(microsoftProviderToken, data.session)
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown import error'
        console.warn(`Microsoft profile photo could not be imported; sign-in will continue without it: ${reason}`)
      } finally {
        microsoftProviderToken = null
      }
    }
  } catch (error) {
    if (isActiveLogin(login)) {
      await clearActiveLogin()
      await storage.clearPKCEMaterial()
      const message = isAuthRetryableFetchError(error)
        ? AUTH_SERVICE_UNAVAILABLE_MESSAGE
        : 'Authentication could not be completed.'
      publish({
        status: isAuthRetryableFetchError(error) ? 'service-unavailable' : 'anonymous',
        user: null,
        error: message,
        loginProvider: null,
      })
    } else {
      await discardCancelledSession(null)
    }
  } finally {
    callbackExchangeInProgress = false
  }
}

async function currentToken(forceRefresh: boolean): Promise<string> {
  if (!client) throw new Error(AUTH_SERVICE_UNAVAILABLE_MESSAGE)
  if (snapshot.status === 'service-unavailable') throw new Error(AUTH_SERVICE_UNAVAILABLE_MESSAGE)
  if (snapshot.status !== 'authenticated') throw new Error('Authentication is required')
  const result = forceRefresh ? await client.auth.refreshSession() : await client.auth.getSession()
  if (result.error && isAuthRetryableFetchError(result.error)) {
    publish({ status: 'service-unavailable', user: null, error: AUTH_SERVICE_UNAVAILABLE_MESSAGE, loginProvider: null })
    throw new Error(AUTH_SERVICE_UNAVAILABLE_MESSAGE)
  }
  if (result.error || !result.data.session) {
    await client.auth.signOut({ scope: 'local' })
    publish({ status: 'anonymous', user: null, error: 'Your session expired. Please sign in again.', loginProvider: null })
    throw new Error('Your session expired. Please sign in again.')
  }
  if (forceRefresh) await validateSession(result.data.session)
  if (snapshot.status !== 'authenticated') throw new Error(snapshot.error || 'Authentication is unavailable')
  currentAccessToken = result.data.session.access_token
  return currentAccessToken
}

async function localLogout() {
  await clearActiveLogin()
  const { error } = await client!.auth.signOut({ scope: 'local' })
  publish({ status: 'anonymous', user: null, error: null, loginProvider: null })
  if (error) console.warn('The local session was cleared but server-side session revocation was unavailable')
}

async function globalLogout() {
  const token = await currentToken(false)
  const response = await fetch(`${config.backendUrl}/api/auth/logout-all`, {
    method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    if (response.status === 401) await localLogout()
    throw new Error(response.status === 503 ? 'Authentication service is unavailable.' : `Sign out failed (${response.status})`)
  }
  await localLogout()
}

function validSupabaseProjectUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    return (
      (parsed.protocol === 'https:' || (config.isDevelopment && parsed.protocol === 'http:'))
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
      && !parsed.username
      && !parsed.password
    )
  } catch {
    return false
  }
}

export async function setupAuthHandlers(nextCallbacks: AuthStateCallbacks = {}) {
  callbacks = nextCallbacks
  if (!validSupabaseProjectUrl(config.supabaseUrl) || !config.supabasePublishableKey.startsWith('sb_publishable_')) {
    throw new Error('A valid Supabase project URL and modern publishable key are required for desktop Auth')
  }
  client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage },
  })

  const hasPendingLogin = await restoreActiveLogin()

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      publish({ status: 'anonymous', user: null, error: null, loginProvider: null })
    } else if ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && session) {
      setTimeout(() => { void validateSession(session) }, 0)
    }
  })

  const known = (sender: WebContents) => Boolean(callbacks.isKnownRendererSender?.(sender))
  const authWindow = (sender: WebContents) => Boolean(callbacks.isAuthRendererSender?.(sender))
  ipcMain.handle('auth:google', async (event) => authWindow(event.sender) ? beginLogin('google').catch(errorResult) : rejected())
  ipcMain.handle('auth:microsoft', async (event) => authWindow(event.sender) ? beginLogin('microsoft').catch(errorResult) : rejected())
  ipcMain.handle('auth:cancel', async (event) => authWindow(event.sender) ? cancelLogin().then(okResult, errorResult) : rejected())
  ipcMain.handle('auth:get-snapshot', (event) => known(event.sender) ? publicSnapshot() : rejected())
  ipcMain.handle('auth:get-access-token', async (event, forceRefresh?: unknown) => known(event.sender) ? currentToken(forceRefresh === true) : Promise.reject(new Error('Authentication request rejected')))
  ipcMain.handle('auth:logout', async (event) => known(event.sender) ? localLogout().then(okResult, errorResult) : rejected())
  ipcMain.handle('auth:logout-all', async (event) => known(event.sender) ? globalLogout().then(okResult, errorResult) : rejected())
  ipcMain.handle('auth:revalidate', async (event) => {
    if (!known(event.sender)) return rejected()
    const { data, error } = await client!.auth.getSession()
    if (error && isAuthRetryableFetchError(error)) {
      publish({ status: 'service-unavailable', user: null, error: AUTH_SERVICE_UNAVAILABLE_MESSAGE, loginProvider: null })
      return publicSnapshot()
    }
    if (error || !data.session) {
      await client!.auth.signOut({ scope: 'local' })
      publish({ status: 'anonymous', user: null, error: 'Your session expired. Please sign in again.', loginProvider: null })
      return publicSnapshot()
    }
    await validateSession(data.session)
    return publicSnapshot()
  })

  publish({ status: 'validating', user: null, error: null, loginProvider: null })
  const { data, error } = await client.auth.getSession()
  if (error && isAuthRetryableFetchError(error)) publish({ status: 'service-unavailable', user: null, error: AUTH_SERVICE_UNAVAILABLE_MESSAGE, loginProvider: null })
  else if (error) {
    await client.auth.signOut({ scope: 'local' })
    publish({ status: 'anonymous', user: null, error: 'Stored session could not be restored.', loginProvider: null })
  }
  else if (data.session) await validateSession(data.session)
  else if (hasPendingLogin && activeLogin) publish({ status: 'oauth-pending', user: null, error: null, loginProvider: activeLogin.provider })
  else publish({ status: 'anonymous', user: null, error: null, loginProvider: null })

  if (queuedAuthCallback) {
    const callbackUrl = queuedAuthCallback
    queuedAuthCallback = null
    await handleAuthProtocolCallback(callbackUrl)
  }
}

function okResult() { return { success: true as const } }
function rejected(error = 'Authentication request rejected') { return { success: false as const, error } }
function errorResult(error: unknown) { return rejected(error instanceof Error ? error.message : 'Authentication failed') }
