import { app, BrowserWindow, dialog, ipcMain, desktopCapturer, shell, type OpenDialogOptions } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import path from 'node:path'
import fs from 'node:fs'
import { closeDashboardWindow, createDashboardWindow, getDashboardWindow, getWindow, isKnownRendererSender, showAuthWindow } from './window'
import { getCurrentAuthTokenForRequest, isRendererAuthenticated } from './auth-handlers'
import { config } from './config'
import { beginIntegrationOAuthTransaction, cancelIntegrationOAuthTransaction } from './protocol-handler'
import {
  restoreKeyboardShortcuts,
  unregisterKeyboardShortcuts,
  getShortcutState,
  setVisibleOverlayBounds,
  updateShortcut,
} from './shortcuts'

let systemAudioProcess: ChildProcess | null = null

type RecordingSettings = {
  storageLocation: 'server' | 'local'
  localRecordingsPath: string
}

type IntegrationProvider = 'google' | 'microsoft'

type IntegrationResult = {
  success: boolean
  error?: string
  authInvalid?: boolean
}

function defaultLocalRecordingsPath() {
  return path.join(app.getPath('documents'), 'Orion Recordings')
}

function isIntegrationProvider(value: unknown): value is IntegrationProvider {
  return value === 'google' || value === 'microsoft'
}

async function integrationBackendFetch(pathname: string, init: RequestInit): Promise<Response> {
  const send = async (forceRefresh: boolean) => {
    const accessToken = await getCurrentAuthTokenForRequest(forceRefresh)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${accessToken}`)
    return fetch(`${config.backendUrl}${pathname}`, { ...init, headers })
  }

  const response = await send(false)
  if (response.status !== 401) return response
  return send(true)
}

function validatedIntegrationAuthorizationUrl(provider: IntegrationProvider, rawUrl: string): string {
  const parsed = new URL(rawUrl)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Integration provider returned an unsafe authorization URL')
  }

  const allowed = provider === 'google'
    ? parsed.origin === 'https://accounts.google.com' && parsed.pathname === '/o/oauth2/v2/auth'
    : provider === 'microsoft'
      ? parsed.origin === 'https://login.microsoftonline.com' && parsed.pathname === '/common/oauth2/v2.0/authorize'
      : false

  const expectedRedirect = `${config.backendUrl}/integrations/oauth/callback`
  const state = parsed.searchParams.get('state') || ''
  const scopes = (parsed.searchParams.get('scope') || '').split(/\s+/).filter(Boolean)
  const allowedScopes = provider === 'google'
    ? new Set(['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.readonly'])
    : new Set(['openid', 'email', 'profile', 'offline_access', 'User.Read', 'Calendars.Read'])
  const singletonParameters = ['response_type', 'redirect_uri', 'client_id', 'state', 'scope']

  if (
    !allowed
    || singletonParameters.some((name) => parsed.searchParams.getAll(name).length !== 1)
    || parsed.searchParams.get('response_type') !== 'code'
    || parsed.searchParams.get('redirect_uri') !== expectedRedirect
    || !parsed.searchParams.get('client_id')
    || (parsed.searchParams.get('client_id')?.length ?? 0) > 512
    || !/^[A-Za-z0-9_-]{43}$/.test(state)
    || scopes.length !== allowedScopes.size
    || scopes.some((scope) => !allowedScopes.has(scope))
    || [...allowedScopes].some((scope) => !scopes.includes(scope))
  ) {
    throw new Error('Integration provider returned an unexpected authorization URL')
  }
  return parsed.toString()
}

export function stopSystemAudioCapture() {
  if (systemAudioProcess) {
    systemAudioProcess.kill('SIGTERM')
    systemAudioProcess = null
  }
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown }
    if (typeof body.error === 'string' && body.error.trim().length > 0) {
      return body.error
    }
    if (typeof body.message === 'string' && body.message.trim().length > 0) {
      return body.message
    }
  } catch {
    // Use the fallback below.
  }
  return fallback
}

function defaultRecordingSettings(): RecordingSettings {
  return {
    storageLocation: 'server',
    localRecordingsPath: defaultLocalRecordingsPath(),
  }
}

function recordingSettingsPath() {
  return path.join(app.getPath('userData'), 'recording-settings.json')
}

function readRecordingSettings(): RecordingSettings {
  try {
    const raw = fs.readFileSync(recordingSettingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<RecordingSettings>
    return {
      storageLocation: parsed.storageLocation === 'local' ? 'local' : 'server',
      localRecordingsPath:
        typeof parsed.localRecordingsPath === 'string' && parsed.localRecordingsPath.trim().length > 0
          ? parsed.localRecordingsPath
          : defaultLocalRecordingsPath(),
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return defaultRecordingSettings()
    }
    console.error('Failed to read recording settings:', error)
    return defaultRecordingSettings()
  }
}

function writeRecordingSettings(settings: RecordingSettings) {
  fs.mkdirSync(path.dirname(recordingSettingsPath()), { recursive: true })
  fs.writeFileSync(recordingSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

function ensureWritableDirectory(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true })
  fs.accessSync(dirPath, fs.constants.W_OK)
}

export function setupIpcHandlers() {
  ipcMain.on('editor:run-command', (event, command: unknown) => {
    if (!isKnownRendererSender(event.sender)) return
    if (command === 'cut') event.sender.cut()
    else if (command === 'copy') event.sender.copy()
    else if (command === 'paste') event.sender.paste()
    else if (command === 'selectAll') event.sender.selectAll()
  })

  // Window control IPC handlers
  ipcMain.on('window-drag-start', (event, { mouseX, mouseY }) => {
    if (!isKnownRendererSender(event.sender)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [winX, winY] = win.getPosition()
    win.webContents.send('drag-offset', {
      x: mouseX - winX,
      y: mouseY - winY,
    })
  })

  ipcMain.on('window-drag-move', (event, { mouseX, mouseY, offsetX, offsetY }) => {
    if (!isKnownRendererSender(event.sender)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setPosition(mouseX - offsetX, mouseY - offsetY)
  })

  ipcMain.on('set-ignore-mouse-events', (event, ignore: boolean) => {
    if (!isKnownRendererSender(event.sender)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.on('set-window-height', (event, rawHeight: number) => {
    if (!isKnownRendererSender(event.sender)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const newHeight = Math.max(60, Math.round(rawHeight))
    const [currentWidth, currentHeight] = win.getSize()

    // Only resize if height actually changed
    if (currentHeight !== newHeight) {
      const [x, y] = win.getPosition()

      // Adjust position to grow/shrink downward (keep top edge fixed)
      win.setBounds(
        {
          x,
          y,
          width: currentWidth,
          height: newHeight,
        },
        false,
      )
    }
  })

  ipcMain.on('set-window-size', (event, payload: { width: number; height: number }) => {
    if (!isKnownRendererSender(event.sender)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const width = Math.max(240, Math.round(payload?.width ?? 0))
    const height = Math.max(60, Math.round(payload?.height ?? 0))
    const [currentWidth, currentHeight] = win.getSize()
    if (currentWidth === width && currentHeight === height) return

    const [x, y] = win.getPosition()
    // Keep top-left fixed; grow/shrink down/right.
    win.setBounds({ x, y, width, height }, false)
  })

  ipcMain.on(
    'set-visible-overlay-bounds',
    (event, bounds: { offsetX: number; offsetY: number; width: number; height: number } | null) => {
      if (!isKnownRendererSender(event.sender)) return
      setVisibleOverlayBounds(bounds)
    },
  )

  ipcMain.on('toggle-visibility', (event) => {
    if (!isKnownRendererSender(event.sender)) return
    const win = getWindow()
    if (!win) return
    if (win.isVisible()) {
      win.hide()
      unregisterKeyboardShortcuts()
    } else {
      // If the dashboard is open, treat "show overlay" as "return to overlay".
      const dashboard = getDashboardWindow()
      if (dashboard && !dashboard.isDestroyed()) {
        closeDashboardWindow()
      }
      win.show()
      restoreKeyboardShortcuts()
    }
  })

  ipcMain.on('blur-overlay', (event) => {
    if (!isKnownRendererSender(event.sender)) return
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    win.blur()
  })

  ipcMain.on('window-minimize', (event) => {
    if (!isKnownRendererSender(event.sender)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    win.minimize()
  })

  ipcMain.on('window-close', (event) => {
    if (!isKnownRendererSender(event.sender)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    win.hide()
    if (win === getWindow()) unregisterKeyboardShortcuts()
  })

  ipcMain.on('dashboard:open', (event, payload?: { noteId?: string }) => {
    if (!isKnownRendererSender(event.sender) || !isRendererAuthenticated()) {
      showAuthWindow()
      return
    }

    unregisterKeyboardShortcuts()

    const overlay = getWindow()
    if (overlay && !overlay.isDestroyed()) {
      overlay.setIgnoreMouseEvents(true, { forward: true })
      overlay.setOpacity(0)
      overlay.hide()
    }

    const noteId = typeof payload?.noteId === 'string' ? payload.noteId : undefined
    const dashboard = getDashboardWindow()
    if (dashboard && !dashboard.isDestroyed()) {
      if (noteId) {
        dashboard.webContents.send('dashboard:select-note', { noteId })
      }
      dashboard.show()
      dashboard.focus()
      return
    }

    const created = createDashboardWindow(noteId)
    created.show()
    created.focus()
  })

  ipcMain.on('dashboard:close', (event) => {
    if (!isKnownRendererSender(event.sender)) return
    if (!isRendererAuthenticated()) {
      const overlay = getWindow()
      if (overlay && !overlay.isDestroyed()) {
        overlay.hide()
        overlay.setIgnoreMouseEvents(false)
        overlay.setOpacity(1)
      }

      closeDashboardWindow()

      unregisterKeyboardShortcuts()
      showAuthWindow()
      return
    }

    const overlay = getWindow()
    if (overlay && !overlay.isDestroyed()) {
      if (!overlay.isVisible()) {
        overlay.setOpacity(0)
        overlay.showInactive()
      }
      overlay.setIgnoreMouseEvents(false)
      overlay.setOpacity(1)
      overlay.moveTop()
    }

    const dashboard = getDashboardWindow()
    if (dashboard && !dashboard.isDestroyed()) {
      dashboard.hide()
    }

    restoreKeyboardShortcuts()
  })

  // Shortcuts IPC handlers
  ipcMain.handle('shortcuts:get', (event) => {
    if (!isKnownRendererSender(event.sender) || !isRendererAuthenticated()) throw new Error('Unauthorized IPC sender')
    return getShortcutState()
  })

  ipcMain.handle('shortcuts:update', (event, payload) => {
    if (!isKnownRendererSender(event.sender) || !isRendererAuthenticated()) throw new Error('Unauthorized IPC sender')
    const win = getWindow()
    const windowVisible = Boolean(win?.isVisible())

    const result = updateShortcut(payload)

    const dashboard = getDashboardWindow()
    const dashboardVisible = Boolean(dashboard && !dashboard.isDestroyed() && dashboard.isVisible())
    if (dashboardVisible || !windowVisible) {
      unregisterKeyboardShortcuts()
    } else {
      restoreKeyboardShortcuts()
    }

    return result
  })

  ipcMain.handle('recording-settings:get', (event) => {
    if (!isKnownRendererSender(event.sender) || !isRendererAuthenticated()) throw new Error('Unauthorized IPC sender')
    return readRecordingSettings()
  })

  ipcMain.handle('recording-settings:update', (event, payload: Partial<RecordingSettings>) => {
    if (!isKnownRendererSender(event.sender) || !isRendererAuthenticated()) throw new Error('Unauthorized IPC sender')
    const current = readRecordingSettings()
    const storageLocation = payload.storageLocation === 'local' ? 'local' : 'server'
    const localRecordingsPath =
      typeof payload.localRecordingsPath === 'string'
        ? payload.localRecordingsPath
        : current.localRecordingsPath || defaultLocalRecordingsPath()

    if (storageLocation === 'local') {
      ensureWritableDirectory(localRecordingsPath)
    }

    const next: RecordingSettings = {
      storageLocation,
      localRecordingsPath,
    }

    writeRecordingSettings(next)
    return next
  })

  ipcMain.handle('recording-settings:pick-local-path', async (event) => {
    if (!isKnownRendererSender(event.sender) || !isRendererAuthenticated()) throw new Error('Unauthorized IPC sender')
    const win = getDashboardWindow() ?? getWindow()
    const dialogOptions: OpenDialogOptions = {
      title: 'Choose recordings folder',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return readRecordingSettings()
    }

    const selectedPath = result.filePaths[0]
    try {
      ensureWritableDirectory(selectedPath)
    } catch {
      dialog.showErrorBox('Folder not writable', 'Choose a folder where Orion can save recordings.')
      return readRecordingSettings()
    }

    const next: RecordingSettings = {
      ...readRecordingSettings(),
      storageLocation: 'local',
      localRecordingsPath: selectedPath,
    }
    writeRecordingSettings(next)
    return next
  })

  ipcMain.handle(
    'integration:connect',
    async (
      event,
      payload?: { provider?: unknown; feature?: unknown },
    ): Promise<IntegrationResult> => {
      const provider = payload?.provider
      const feature = typeof payload?.feature === 'string' ? payload.feature.trim() : ''

      if (!isKnownRendererSender(event.sender)) {
        return { success: false, error: 'Not authenticated', authInvalid: true }
      }
      if (!isRendererAuthenticated()) return { success: false, error: 'Authentication is unavailable' }
      if (!isIntegrationProvider(provider)) {
        return { success: false, error: 'Unsupported integration provider' }
      }
      if (feature !== 'calendar') {
        return { success: false, error: 'Unsupported integration feature' }
      }

      try {
        const response = await integrationBackendFetch('/api/integrations/connections/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ provider, feature, platform: 'desktop' }),
        })

        if (!response.ok) {
          return {
            success: false,
            error: await readApiError(response, 'Failed to start integration connection'),
            authInvalid: response.status === 401,
          }
        }

        const result = (await response.json()) as { auth_url?: unknown }
        if (typeof result.auth_url !== 'string' || result.auth_url.length === 0) {
          return { success: false, error: 'Integration connection did not return an auth URL' }
        }

		const authorizationURL = validatedIntegrationAuthorizationUrl(provider, result.auth_url)
		const state = new URL(authorizationURL).searchParams.get('state')
		if (!state) {
			return { success: false, error: 'Integration connection did not return a correlation state' }
		}
        beginIntegrationOAuthTransaction(state, provider, 'calendar')
        try {
          await shell.openExternal(authorizationURL)
        } catch (error) {
          cancelIntegrationOAuthTransaction(state)
          throw error
        }
        return { success: true }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    },
  )

  ipcMain.handle(
    'integration:disconnect',
    async (event, payload?: { connectionID?: unknown }): Promise<IntegrationResult> => {
      const connectionID =
        typeof payload?.connectionID === 'string' && payload.connectionID.trim().length > 0
          ? payload.connectionID.trim()
          : null

      if (!isKnownRendererSender(event.sender)) {
        return { success: false, error: 'Not authenticated', authInvalid: true }
      }
      if (!isRendererAuthenticated()) return { success: false, error: 'Authentication is unavailable' }
      if (!connectionID) {
        return { success: false, error: 'Missing connection ID' }
      }

      try {
        const response = await integrationBackendFetch(
          `/api/integrations/connections/${encodeURIComponent(connectionID)}`,
          {
            method: 'DELETE',
          },
        )

        if (!response.ok) {
          return {
            success: false,
            error: await readApiError(response, 'Failed to disconnect integration'),
            authInvalid: response.status === 401,
          }
        }

        return { success: true }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    },
  )

  // Audio capture IPC handlers

  // Windows: get a desktop source ID for system audio capture via desktopCapturer
  ipcMain.handle('audio:get-desktop-source-id', async (event) => {
    if (!isKnownRendererSender(event.sender) || !isRendererAuthenticated()) {
      return null
    }

    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      return sources.length > 0 ? sources[0].id : null
    } catch (err) {
      console.error('Failed to get desktop source:', err)
      return null
    }
  })

  // macOS: start Swift helper for system audio capture
  ipcMain.handle('audio:start-system-capture', async (event) => {
    if (!isKnownRendererSender(event.sender) || !isRendererAuthenticated()) {
      throw new Error('Not authenticated')
    }

    const win = getWindow()
    if (!win) return

    if (systemAudioProcess) {
      // Already running
      return
    }

    // Resolve path to the Swift helper binary
    const helperPath = path.join(
      process.env.APP_ROOT || '',
      'native',
      'macos',
      'OrionAudioCapture',
      '.build',
      'release',
      'OrionAudioCapture',
    )

    try {
      systemAudioProcess = spawn(helperPath, ['--sample-rate', '48000', '--format', 'pcm16'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      systemAudioProcess.stdout?.on('data', (chunk: Buffer) => {
        if (!isRendererAuthenticated()) {
          stopSystemAudioCapture()
          return
        }

        const win = getWindow()
        if (win && !win.isDestroyed()) {
          // Send raw PCM buffer to renderer
          win.webContents.send('audio:system-chunk', chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength))
        }
      })

      systemAudioProcess.stderr?.on('data', (data: Buffer) => {
        console.error('System audio helper stderr:', data.toString())
      })

      systemAudioProcess.on('exit', (code) => {
        console.log('System audio helper exited with code:', code)
        systemAudioProcess = null
      })

      systemAudioProcess.on('error', (err) => {
        console.error('System audio helper error:', err)
        systemAudioProcess = null
      })
    } catch (err) {
      console.error('Failed to start system audio helper:', err)
      systemAudioProcess = null
    }
  })

  // macOS: stop Swift helper
  ipcMain.on('audio:stop-system-capture', (event) => {
    if (!isKnownRendererSender(event.sender) || !isRendererAuthenticated()) return
    stopSystemAudioCapture()
  })

}
