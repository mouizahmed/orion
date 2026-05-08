import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { config } from './config'
import {
  completeActiveOAuthTransaction,
  getActiveOAuthCodeVerifier,
  isActiveOAuthState,
  rejectActiveOAuthTransaction,
} from './auth-handlers'

let authCallbackWindow: BrowserWindow | null = null
let revealAuthWindow: (() => void) | null = null
let revealIntegrationWindow: (() => void) | null = null

export function setAuthCallbackWindow(win: BrowserWindow | null) {
  authCallbackWindow = win
}

export function setAuthWindowRevealHandler(handler: (() => void) | null) {
  revealAuthWindow = handler
}

export function setIntegrationWindowRevealHandler(handler: (() => void) | null) {
  revealIntegrationWindow = handler
}

// Helper to send auth session updates to renderer
function sendAuthUpdate(
  success: boolean,
  data: { firebaseToken?: string; error?: string },
) {
  const payload = {
    success,
    ...(success
      ? { firebaseToken: data.firebaseToken }
      : { error: data.error }),
    timestamp: new Date().toISOString(),
  }

  if (authCallbackWindow && !authCallbackWindow.isDestroyed()) {
    authCallbackWindow.webContents.send('auth-session-updated', payload)
  }
}

function sendIntegrationUpdate(payload: {
  success: boolean
  provider?: string
  feature?: string
  error?: string
}) {
  const eventPayload = {
    type: 'integration_connection_completed',
    ...payload,
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('integration:connection-completed', eventPayload)
    }
  }
}

export function setupProtocolHandler() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      const success = app.setAsDefaultProtocolClient(
        'orion',
        process.execPath,
        [path.resolve(process.argv[1])],
      )
      if (!success) {
        console.log('Protocol registration failed in development mode')
      }
    }
  } else {
    const success = app.setAsDefaultProtocolClient('orion')
    if (!success) {
      console.log('Protocol registration failed in production mode')
    }
  }
}

export function setupProtocolEvents() {
  app.on('second-instance', (_event, commandLine) => {
    const url = commandLine.find((arg) => arg.startsWith('orion://'))
    if (url) {
      handleProtocolUrl(url)
      return
    }

    if (authCallbackWindow) {
      if (authCallbackWindow.isMinimized()) authCallbackWindow.restore()
      authCallbackWindow.focus()
      authCallbackWindow.show()
    }
  })

  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleProtocolUrl(url)
  })

  app.on('ready', () => {
    const protocolUrl = process.argv.find((arg) =>
      arg.startsWith('orion://'),
    )
    if (protocolUrl) {
      handleProtocolUrl(protocolUrl)
    }
  })
}

async function handleProtocolUrl(url: string) {
  if (!url || typeof url !== 'string' || !url.startsWith('orion://')) {
    return
  }

  try {
    const parsed = new URL(url)

    // Handle auth callback
    if (
      parsed.hostname === 'auth-complete' ||
      parsed.pathname.replace(/^\/|\/$/g, '') === 'auth-complete'
    ) {
      await handleAuthComplete(parsed)
      return
    }

    if (
      parsed.hostname === 'integrations' &&
      parsed.pathname.replace(/^\/|\/$/g, '') === 'callback'
    ) {
      handleIntegrationCallback(parsed)
    }
  } catch (error) {
    console.error('Error parsing protocol URL:', error)
  }
}

function handleIntegrationCallback(parsed: URL) {
  const success = parsed.searchParams.get('success') === 'true'
  const provider = parsed.searchParams.get('provider') || undefined
  const feature = parsed.searchParams.get('feature') || undefined
  const error = parsed.searchParams.get('error_description') || parsed.searchParams.get('error') || undefined

  revealIntegrationWindow?.()

  setTimeout(() => {
    sendIntegrationUpdate({
      success,
      provider,
      feature,
      error,
    })
  }, 150)
}

async function handleAuthComplete(parsed: URL) {
  const error = parsed.searchParams.get('error')
  const errorDescription = parsed.searchParams.get('error_description')
  const code = parsed.searchParams.get('code')
  const state = parsed.searchParams.get('state')

  if (!isActiveOAuthState(state)) {
    console.warn('Ignoring OAuth callback for inactive state')
    return
  }

  if (error) {
    rejectActiveOAuthTransaction(state)
    sendAuthUpdate(false, {
      error:
        errorDescription ||
        `Authentication failed: ${error.replace(/_/g, ' ')}`,
    })
    revealAuthWindow?.()
    return
  }

  if (!code) {
    rejectActiveOAuthTransaction(state)
    sendAuthUpdate(false, {
      error: 'Authentication failed: No authorization code received',
    })
    revealAuthWindow?.()
    return
  }
  const codeVerifier = getActiveOAuthCodeVerifier(state)
  if (!codeVerifier) {
    rejectActiveOAuthTransaction(state)
    sendAuthUpdate(false, {
      error: 'Authentication failed: Missing authorization verifier',
    })
    revealAuthWindow?.()
    return
  }

  await completeAuthenticationWithCode(code, state, codeVerifier)
}

function validateOAuthCode(code: string): boolean {
  // OAuth codes should be alphanumeric with possible hyphens/underscores
  // Typically 20-128 characters long
  if (typeof code !== 'string') return false
  if (code.length < 10 || code.length > 256) return false
  if (!/^[a-zA-Z0-9\-_]+$/.test(code)) return false
  return true
}

async function completeAuthenticationWithCode(code: string, state: string, codeVerifier: string): Promise<void> {
  if (!code || !validateOAuthCode(code)) {
    console.warn('Invalid OAuth code format detected')
    rejectActiveOAuthTransaction(state)
    sendAuthUpdate(false, {
      error: 'Authentication failed: Invalid authorization code format',
    })
    revealAuthWindow?.()
    return
  }

  try {
    const response = await fetch(`${config.backendUrl}/auth/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state, code_verifier: codeVerifier }),
    })

    if (!response.ok) {
      const responseText = await response.text()
      rejectActiveOAuthTransaction(state)
      sendAuthUpdate(false, {
        error: `Authentication failed (${response.status}): ${responseText}`,
      })
      revealAuthWindow?.()
      return
    }

    const authResult = await response.json()

    if (authResult.status === 'success' && authResult.user) {
      if (authResult.firebaseToken) {
        completeActiveOAuthTransaction(state)
        sendAuthUpdate(true, {
          firebaseToken: authResult.firebaseToken,
        })
      } else {
        rejectActiveOAuthTransaction(state)
        sendAuthUpdate(false, {
          error: 'Authentication completed but no token received',
        })
        revealAuthWindow?.()
      }
    } else {
      rejectActiveOAuthTransaction(state)
      sendAuthUpdate(false, {
        error:
          authResult.error || 'Authentication was not completed successfully',
      })
      revealAuthWindow?.()
    }
  } catch (error) {
    rejectActiveOAuthTransaction(state)
    sendAuthUpdate(false, {
      error: error instanceof Error ? error.message : String(error),
    })
    revealAuthWindow?.()
  }
}

export function checkInitialProtocolUrl() {
  const initialProtocolUrl = process.argv.find((arg) =>
    arg.startsWith('orion://'),
  )
  if (initialProtocolUrl) {
    setTimeout(() => handleProtocolUrl(initialProtocolUrl), 1000)
  }
}
