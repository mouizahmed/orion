import { app, BrowserWindow, dialog, ipcMain, desktopCapturer, type OpenDialogOptions } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import path from 'node:path'
import fs from 'node:fs'
import { closeDashboardWindow, createDashboardWindow, getDashboardWindow, getWindow, showAuthWindow } from './window'
import { isRendererAuthenticated } from './auth-handlers'
import {
  restoreKeyboardShortcuts,
  unregisterKeyboardShortcuts,
  unregisterMovementShortcuts,
  getShortcutState,
  setVisibleOverlayBounds,
  updateShortcut,
} from './shortcuts'

let systemAudioProcess: ChildProcess | null = null

type RecordingSettings = {
  storageLocation: 'server' | 'local'
  localRecordingsPath: string
}

function defaultLocalRecordingsPath() {
  return path.join(app.getPath('documents'), 'Orionly Recordings')
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
  // Window control IPC handlers
  ipcMain.on('window-drag-start', (event, { mouseX, mouseY }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const [winX, winY] = win.getPosition()
    win.webContents.send('drag-offset', {
      x: mouseX - winX,
      y: mouseY - winY,
    })
  })

  ipcMain.on('window-drag-move', (event, { mouseX, mouseY, offsetX, offsetY }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setPosition(mouseX - offsetX, mouseY - offsetY)
  })

  ipcMain.on('set-ignore-mouse-events', (event, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setIgnoreMouseEvents(ignore, { forward: true })
  })

  ipcMain.on('set-window-height', (event, rawHeight: number) => {
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
    (_event, bounds: { offsetX: number; offsetY: number; width: number; height: number } | null) => {
      setVisibleOverlayBounds(bounds)
    },
  )

  ipcMain.on('toggle-visibility', () => {
    const win = getWindow()
    if (!win) return
    if (win.isVisible()) {
      win.hide()
    } else {
      // If the dashboard is open, treat "show overlay" as "return to overlay".
      const dashboard = getDashboardWindow()
      if (dashboard && !dashboard.isDestroyed()) {
        closeDashboardWindow()
      }
      win.show()
    }
  })

  ipcMain.on('blur-overlay', () => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    win.blur()
  })

  ipcMain.on('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    win.minimize()
  })

  ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    win.hide()
  })

  ipcMain.on('dashboard:open', (_event, payload?: { noteId?: string }) => {
    if (!isRendererAuthenticated()) {
      showAuthWindow()
      return
    }

    unregisterKeyboardShortcuts()

    const overlay = getWindow()
    if (overlay && !overlay.isDestroyed()) {
      overlay.setIgnoreMouseEvents(true, { forward: true })
      overlay.setOpacity(0)
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

  ipcMain.on('dashboard:close', () => {
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
  ipcMain.handle('shortcuts:get', () => {
    return getShortcutState()
  })

  ipcMain.handle('shortcuts:update', (_event, payload) => {
    const win = getWindow()
    const windowVisible = Boolean(win?.isVisible())

    const result = updateShortcut(payload)

    const dashboard = getDashboardWindow()
    const dashboardVisible = Boolean(dashboard && !dashboard.isDestroyed() && dashboard.isVisible())
    if (dashboardVisible) {
      unregisterKeyboardShortcuts()
    } else {
      restoreKeyboardShortcuts()
    }

    if (win && !windowVisible) {
      unregisterMovementShortcuts()
    }

    return result
  })

  ipcMain.handle('recording-settings:get', () => {
    return readRecordingSettings()
  })

  ipcMain.handle('recording-settings:update', (_event, payload: Partial<RecordingSettings>) => {
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

  ipcMain.handle('recording-settings:pick-local-path', async () => {
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
      dialog.showErrorBox('Folder not writable', 'Choose a folder where Orionly can save recordings.')
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

  // Audio capture IPC handlers

  // Windows: get a desktop source ID for system audio capture via desktopCapturer
  ipcMain.handle('audio:get-desktop-source-id', async () => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] })
      return sources.length > 0 ? sources[0].id : null
    } catch (err) {
      console.error('Failed to get desktop source:', err)
      return null
    }
  })

  // macOS: start Swift helper for system audio capture
  ipcMain.handle('audio:start-system-capture', async () => {
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
      'OrionlyAudioCapture',
      '.build',
      'release',
      'OrionlyAudioCapture',
    )

    try {
      systemAudioProcess = spawn(helperPath, ['--sample-rate', '48000', '--format', 'pcm16'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      systemAudioProcess.stdout?.on('data', (chunk: Buffer) => {
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
  ipcMain.on('audio:stop-system-capture', () => {
    if (systemAudioProcess) {
      systemAudioProcess.kill('SIGTERM')
      systemAudioProcess = null
    }
  })

}
