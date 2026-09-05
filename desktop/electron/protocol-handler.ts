import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { handleAuthProtocolCallback, isRendererAuthenticated } from './auth-handlers'

let authCallbackWindow: BrowserWindow | null = null
let authCallbackInProgress = false
let revealIntegrationWindow: (() => void) | null = null
let revealBillingWindow: (() => void) | null = null
type IntegrationProvider = 'google' | 'microsoft'
type ActiveIntegrationOAuth = {
  state: string
  provider: IntegrationProvider
  feature: 'calendar'
  expiresAt: number
}

const INTEGRATION_OAUTH_TIMEOUT_MS = 10 * 60 * 1000
const INTEGRATION_CALLBACK_PARAMETERS = new Set([
  'success',
  'provider',
  'feature',
  'error',
  'error_description',
  'state',
])
let activeIntegrationOAuth: ActiveIntegrationOAuth | null = null

export function beginIntegrationOAuthTransaction(
  state: string,
  provider: IntegrationProvider,
  feature: 'calendar',
) {
  if (activeIntegrationOAuth && activeIntegrationOAuth.expiresAt > Date.now()) {
    throw new Error('Another calendar connection is already in progress')
  }
  activeIntegrationOAuth = {
    state,
    provider,
    feature,
    expiresAt: Date.now() + INTEGRATION_OAUTH_TIMEOUT_MS,
  }
}

export function cancelIntegrationOAuthTransaction(state: string) {
  if (activeIntegrationOAuth?.state === state) activeIntegrationOAuth = null
}

export function setAuthCallbackWindow(win: BrowserWindow | null) {
  authCallbackWindow = win
}

export function isAuthCallbackInProgress() {
  return authCallbackInProgress
}

export function setIntegrationWindowRevealHandler(handler: (() => void) | null) {
  revealIntegrationWindow = handler
}

export function setBillingWindowRevealHandler(handler: (() => void) | null) {
  revealBillingWindow = handler
}

function revealAuthWindow() {
  if (!authCallbackWindow || authCallbackWindow.isDestroyed()) return
  if (authCallbackWindow.isMinimized()) authCallbackWindow.restore()
  authCallbackWindow.show()
  authCallbackWindow.focus()
}

function sendIntegrationUpdate(payload: { success: boolean; provider?: string; feature?: string; error?: string }) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('integration:connection-completed', { type: 'integration_connection_completed', ...payload })
  }
}

export function setupProtocolHandler() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('orion', process.execPath, [path.resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient('orion')
  }
}

export function setupProtocolEvents() {
  app.on('second-instance', (_event, commandLine) => {
    const protocolUrl = commandLine.find((arg) => arg.startsWith('orion://'))
    if (protocolUrl) void handleProtocolUrl(protocolUrl)
    else revealAuthWindow()
  })

  app.on('open-url', (event, rawUrl) => {
    event.preventDefault()
    void handleProtocolUrl(rawUrl)
  })

  app.on('ready', () => {
    const initialUrl = process.argv.find((arg) => arg.startsWith('orion://'))
    if (initialUrl) void handleProtocolUrl(initialUrl)
  })
}

async function handleProtocolUrl(rawUrl: string) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 8192 || !rawUrl.startsWith('orion://')) return
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { return }

  if (parsed.protocol === 'orion:' && parsed.hostname === 'auth' && parsed.pathname === '/callback') {
    authCallbackInProgress = true
    try {
      // The callback handler publishes `validating` before its first network
      // await. Reveal the window after that state has been queued so the
      // callback transition is the first UI state the user sees.
      const callback = handleAuthProtocolCallback(rawUrl)
      revealAuthWindow()
      await callback

      // A cancelled or expired PKCE transaction must reject the callback, but
      // activating the protocol should still bring the sign-in window forward.
      // Successful authentication already creates and focuses the dashboard.
      if (!isRendererAuthenticated()) revealAuthWindow()
    } finally {
      authCallbackInProgress = false
    }
    return
  }
  if (parsed.protocol === 'orion:' && parsed.hostname === 'integrations' && parsed.pathname === '/callback') {
    handleIntegrationCallback(parsed)
    return
  }
  if (parsed.protocol === 'orion:' && parsed.hostname === 'billing' && parsed.pathname === '/complete') {
    handleBillingCallback(parsed)
  }
}

function handleBillingCallback(parsed: URL) {
  if (!isRendererAuthenticated()) return
  if ([...parsed.searchParams.keys()].some((name) => name !== 'result')) return
  if (parsed.searchParams.getAll('result').length !== 1) return
  const result = parsed.searchParams.get('result')
  if (result !== 'success' && result !== 'cancelled' && result !== 'portal') return

  revealBillingWindow?.()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('main-process-message', { type: 'billing_state_changed', result })
    }
  }
}

function handleIntegrationCallback(parsed: URL) {
  const active = activeIntegrationOAuth
  if (!active) return
  if (active.expiresAt <= Date.now()) {
    activeIntegrationOAuth = null
    return
  }
  for (const name of parsed.searchParams.keys()) {
    if (!INTEGRATION_CALLBACK_PARAMETERS.has(name)) return
  }
  for (const name of INTEGRATION_CALLBACK_PARAMETERS) {
    if (parsed.searchParams.getAll(name).length > 1) return
  }

  const state = parsed.searchParams.get('state')
  const success = parsed.searchParams.get('success')
  const provider = parsed.searchParams.get('provider')
  const feature = parsed.searchParams.get('feature')
  const error = parsed.searchParams.get('error')
  const errorDescription = parsed.searchParams.get('error_description')
  if (
    state !== active.state
    || !/^[A-Za-z0-9_-]{43}$/.test(state)
    || (success !== 'true' && success !== 'false')
    || (provider !== null && provider !== active.provider)
    || (feature !== null && feature !== active.feature)
    || (error?.length ?? 0) > 128
    || (errorDescription?.length ?? 0) > 512
    || (success === 'true' && (provider !== active.provider || feature !== active.feature || error || errorDescription))
    || (success === 'false' && !error)
  ) return

  activeIntegrationOAuth = null
  revealIntegrationWindow?.()
  sendIntegrationUpdate({
    success: success === 'true',
    provider: active.provider,
    feature: active.feature,
    error: errorDescription || error || undefined,
  })
}
