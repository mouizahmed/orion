import { Menu, Tray, nativeImage } from 'electron'
import path from 'node:path'
import { closeDashboardWindow, createDashboardWindow, getDashboardWindow, getWindow, showAuthWindow } from './window'
import { restoreKeyboardShortcuts, unregisterKeyboardShortcuts } from './shortcuts'
import { isRendererAuthenticated } from './auth-handlers'

let tray: Tray | null = null

function getTrayIconPath() {
  const publicDir = process.env.VITE_PUBLIC
  if (!publicDir) return null
  return path.join(publicDir, 'orion-app-icon.png')
}

export function destroyTray() {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

export function setupTray(options: { onQuit: () => void }) {
  if (tray) {
    return tray
  }

  const iconPath = getTrayIconPath()
  const image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()

  // Windows tray often expects small icons; resize defensively.
  const trayImage = image.isEmpty() ? image : image.resize({ width: 16, height: 16 })

  tray = new Tray(trayImage)
  tray.setToolTip('Orion')

  const buildMenu = () =>
    Menu.buildFromTemplate([
      {
        label: 'Show Overlay',
        click: () => {
          if (!isRendererAuthenticated()) {
            showAuthWindow()
            return
          }
          const overlay = getWindow()
          const dashboard = getDashboardWindow()
          if (dashboard && !dashboard.isDestroyed()) {
            closeDashboardWindow()
          }
          overlay?.show()
          overlay?.focus()
          if (overlay?.isVisible()) restoreKeyboardShortcuts()
        },
      },
      {
        label: 'Open Dashboard',
        click: () => {
          const overlay = getWindow()
          if (!isRendererAuthenticated()) {
            showAuthWindow()
            return
          }
          if (overlay && !overlay.isDestroyed()) {
            overlay.hide()
          }
          unregisterKeyboardShortcuts()
          const dash = createDashboardWindow()
          dash.show()
          dash.focus()
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => options.onQuit(),
      },
    ])

  tray.setContextMenu(buildMenu())

  tray.on('click', () => {
    if (!isRendererAuthenticated()) {
      showAuthWindow()
      return
    }

    const overlay = getWindow()
    if (!overlay) return
    if (overlay.isVisible()) {
      overlay.hide()
      unregisterKeyboardShortcuts()
      return
    }
    const dashboard = getDashboardWindow()
    if (dashboard && !dashboard.isDestroyed()) {
      unregisterKeyboardShortcuts()
      dashboard.show()
      dashboard.focus()
      return
    }
    restoreKeyboardShortcuts()
    overlay.show()
    overlay.focus()
  })

  return tray
}

