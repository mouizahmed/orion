import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { config } from './config'
import { validateState } from './auth-handlers'

// Reference to the main window (will be set from main.ts)
let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null) {
  mainWindow = win
}

// Helper to send auth session updates to renderer
function sendAuthUpdate(
  success: boolean,
  data: { firebaseToken?: string; error?: string },
) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth-session-updated', {
      success,
      ...(success
        ? { firebaseToken: data.firebaseToken }
        : { error: data.error }),
      timestamp: new Date().toISOString(),
    })
  }
}

export function setupProtocolHandler() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      const success = app.setAsDefaultProtocolClient(
        'orionly',
        process.execPath,
        [path.resolve(process.argv[1])],
      )
      if (!success) {
        console.log('Protocol registration failed in development mode')
      }
    }
  } else {
    const success = app.setAsDefaultProtocolClient('orionly')
    if (!success) {
      console.log('Protocol registration failed in production mode')
    }
  }
}

export function setupProtocolEvents() {
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      mainWindow.show()
    }

    const url = commandLine.find((arg) => arg.startsWith('orionly://'))
    if (url) {
      handleProtocolUrl(url)
    }
  })

  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleProtocolUrl(url)
  })

  app.on('ready', () => {
    const protocolUrl = process.argv.find((arg) =>
      arg.startsWith('orionly://'),
    )
    if (protocolUrl) {
      handleProtocolUrl(protocolUrl)
    }
  })
}

async function handleProtocolUrl(url: string) {
  if (!url || typeof url !== 'string' || !url.startsWith('orionly://')) {
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
    }
    // Future: Add more protocol handlers here
  } catch (error) {
    console.error('Error parsing protocol URL:', error)
  }
}

async function handleAuthComplete(parsed: URL) {
  const code = parsed.searchParams.get('code')
  const state = parsed.searchParams.get('state')

  // Show window
  if (mainWindow) {
    mainWindow.show()
  }

  // Validate state for CSRF protection (OAuth 2.0 standard)
  // The state parameter ensures the callback is for a request we initiated
  if (!state || !validateState(state)) {
    console.error('Invalid or missing OAuth state parameter')
    sendAuthUpdate(false, {
      error: 'Authentication failed: Invalid session state',
    })
    return
  }

  if (!code) {
    sendAuthUpdate(false, {
      error: 'Authentication failed: No authorization code received',
    })
    return
  }

  await completeAuthenticationWithCode(code)
}

function validateOAuthCode(code: string): boolean {
  // OAuth codes should be alphanumeric with possible hyphens/underscores
  // Typically 20-128 characters long
  if (typeof code !== 'string') return false
  if (code.length < 10 || code.length > 256) return false
  if (!/^[a-zA-Z0-9\-_]+$/.test(code)) return false
  return true
}

async function completeAuthenticationWithCode(code: string): Promise<void> {
  if (!code || !validateOAuthCode(code)) {
    console.warn('Invalid OAuth code format detected')
    sendAuthUpdate(false, {
      error: 'Authentication failed: Invalid authorization code format',
    })
    return
  }

  try {
    const response = await fetch(`${config.backendUrl}/auth/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })

    if (!response.ok) {
      const responseText = await response.text()
      sendAuthUpdate(false, {
        error: `Authentication failed (${response.status}): ${responseText}`,
      })
      return
    }

    const authResult = await response.json()

    if (authResult.status === 'success' && authResult.user) {
      if (authResult.firebaseToken) {
        sendAuthUpdate(true, { firebaseToken: authResult.firebaseToken })
      } else {
        sendAuthUpdate(false, {
          error: 'Authentication completed but no token received',
        })
      }
    } else {
      sendAuthUpdate(false, {
        error:
          authResult.error || 'Authentication was not completed successfully',
      })
    }
  } catch (error) {
    sendAuthUpdate(false, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export function checkInitialProtocolUrl() {
  const initialProtocolUrl = process.argv.find((arg) =>
    arg.startsWith('orionly://'),
  )
  if (initialProtocolUrl) {
    setTimeout(() => handleProtocolUrl(initialProtocolUrl), 1000)
  }
}
