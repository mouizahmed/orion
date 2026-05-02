import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { config } from './config'

let authCallbackWindow: BrowserWindow | null = null
let revealAuthWindow: (() => void) | null = null

export function setAuthCallbackWindow(win: BrowserWindow | null) {
  authCallbackWindow = win
}

export function setAuthWindowRevealHandler(handler: (() => void) | null) {
  revealAuthWindow = handler
}

// Helper to send auth session updates to renderer
function sendAuthUpdate(
  success: boolean,
  data: { firebaseToken?: string; error?: string; isNewUser?: boolean },
) {
  const payload = {
    success,
    ...(success
      ? { firebaseToken: data.firebaseToken, isNewUser: data.isNewUser }
      : { error: data.error }),
    timestamp: new Date().toISOString(),
  }

  if (authCallbackWindow && !authCallbackWindow.isDestroyed()) {
    authCallbackWindow.webContents.send('auth-session-updated', payload)
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
    const url = commandLine.find((arg) => arg.startsWith('orionly://'))
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
  const error = parsed.searchParams.get('error')
  const errorDescription = parsed.searchParams.get('error_description')
  const code = parsed.searchParams.get('code')

  if (error) {
    sendAuthUpdate(false, {
      error:
        errorDescription ||
        `Authentication failed: ${error.replace(/_/g, ' ')}`,
    })
    revealAuthWindow?.()
    return
  }

  if (!code) {
    sendAuthUpdate(false, {
      error: 'Authentication failed: No authorization code received',
    })
    revealAuthWindow?.()
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
    revealAuthWindow?.()
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
      revealAuthWindow?.()
      return
    }

    const authResult = await response.json()

    if (authResult.status === 'success' && authResult.user) {
      if (authResult.firebaseToken) {
        sendAuthUpdate(true, {
          firebaseToken: authResult.firebaseToken,
          isNewUser: Boolean(authResult.is_new_user),
        })
      } else {
        sendAuthUpdate(false, {
          error: 'Authentication completed but no token received',
        })
        revealAuthWindow?.()
      }
    } else {
      sendAuthUpdate(false, {
        error:
          authResult.error || 'Authentication was not completed successfully',
      })
      revealAuthWindow?.()
    }
  } catch (error) {
    sendAuthUpdate(false, {
      error: error instanceof Error ? error.message : String(error),
    })
    revealAuthWindow?.()
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
