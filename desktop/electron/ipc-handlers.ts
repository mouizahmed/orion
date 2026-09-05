import { BrowserWindow, ipcMain, screen } from 'electron'
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
    const [currentWidth, currentHeight] = win.getContentSize()
    if (currentWidth === width && currentHeight === height) return

    // The renderer reports content dimensions. Using setContentSize avoids
    // macOS window-frame insets clipping a frameless transparent surface.
    win.setContentSize(width, height, false)

    // Expanding the overlay keeps its existing top-left position. If it was
    // near a display edge, move it back inside that display after resizing so
    // the right and bottom corners remain visible.
    const bounds = win.getBounds()
    const { workArea } = screen.getDisplayMatching(bounds)
    const x = Math.min(
      Math.max(bounds.x, workArea.x),
      workArea.x + workArea.width - bounds.width,
    )
    const y = Math.min(
      Math.max(bounds.y, workArea.y),
      workArea.y + workArea.height - bounds.height,
    )
    if (x !== bounds.x || y !== bounds.y) win.setPosition(x, y, false)
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
