import { BrowserWindow, ipcMain } from 'electron'
import { closeDashboardWindow, getDashboardWindow, isKnownRendererSender, isOverlayRendererSender, showAuthWindow } from './window'
import { isRendererAuthenticated } from './auth-handlers'
import { setupRecordingIpc } from './recording-ipc'
import { setupRecordingSettingsIpc } from './recording-settings-ipc'
import { setupIntegrationIpc } from './integration-ipc'

export function setupIpcHandlers() {
  setupRecordingIpc()
  setupRecordingSettingsIpc()
  setupIntegrationIpc()

  ipcMain.on('editor:run-command', (event, command: unknown) => {
    if (!isKnownRendererSender(event.sender)) return
    if (command === 'cut') event.sender.cut()
    else if (command === 'copy') event.sender.copy()
    else if (command === 'paste') event.sender.paste()
    else if (command === 'selectAll') event.sender.selectAll()
  })

  // Only the frameless recording overlay owns content-sized window bounds.
  ipcMain.on('set-window-size', (event, payload: { width: number; height: number }) => {
    if (!isOverlayRendererSender(event.sender)) return
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (!Number.isFinite(payload?.width) || !Number.isFinite(payload?.height)) return
    const width = Math.min(900, Math.max(240, Math.round(payload.width)))
    const height = Math.min(1_000, Math.max(60, Math.round(payload.height)))
    const [currentWidth, currentHeight] = win.getSize()
    if (currentWidth === width && currentHeight === height) return

    const [x, y] = win.getPosition()
    // Keep top-left fixed; grow/shrink down/right.
    win.setBounds({ x, y, width, height }, false)
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
  })

  ipcMain.on('dashboard:close', (event) => {
    if (!isKnownRendererSender(event.sender)) return
    if (!isRendererAuthenticated()) {
      closeDashboardWindow()
      showAuthWindow()
      return
    }

    const dashboard = getDashboardWindow()
    if (dashboard && !dashboard.isDestroyed()) {
      dashboard.hide()
    }
  })
}
