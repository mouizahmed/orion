import { ipcMain, shell } from 'electron'
import { config } from './config'

type AuthPhase = 'initializing' | 'signed-out' | 'oauth-pending' | 'signed-in'

let authPhase: AuthPhase = 'initializing'

type AuthStateCallbacks = {
  onSignedIn?: () => void
  onSignedOut?: () => void
  onOAuthPending?: () => void
}

export function isRendererAuthenticated(): boolean {
  return authPhase === 'signed-in'
}

async function handleOAuth(provider: 'google', setAuthPhase: (nextPhase: AuthPhase) => void): Promise<void> {
  setAuthPhase('oauth-pending')

  try {
    const authUrl = `${config.backendUrl}/auth/start?platform=desktop`
    await shell.openExternal(authUrl)
  } catch (error) {
    setAuthPhase('signed-out')
    console.error(`${provider} OAuth error:`, error)
    throw error
  }
}

export function setupAuthHandlers(callbacks: AuthStateCallbacks = {}) {
  const setAuthPhase = (nextPhase: AuthPhase) => {
    if (authPhase === nextPhase) return

    console.log(`Main auth phase changed: ${authPhase} -> ${nextPhase}`)
    authPhase = nextPhase

    if (nextPhase === 'signed-in') {
      callbacks.onSignedIn?.()
      return
    }

    if (nextPhase === 'oauth-pending') {
      callbacks.onOAuthPending?.()
      return
    }

    callbacks.onSignedOut?.()
  }

  ipcMain.on('auth:state-changed', (_event, payload?: { isAuthenticated?: boolean }) => {
    const nextAuthenticated = Boolean(payload?.isAuthenticated)
    setAuthPhase(nextAuthenticated ? 'signed-in' : 'signed-out')
  })

  ipcMain.handle('auth:google', async () => {
    try {
      await handleOAuth('google', setAuthPhase)
      return { success: true }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle('auth:cancel', async () => {
    if (authPhase === 'oauth-pending') {
      setAuthPhase('signed-out')
    }
    return { success: true }
  })

  ipcMain.handle('auth:logout', async () => {
    setAuthPhase('signed-out')
    return { success: true }
  })
}
