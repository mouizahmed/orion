import { Menu, Tray, nativeImage } from 'electron'
import path from 'node:path'
import { showAuthWindow } from './window'
import { revealDashboardWithDraftFlush } from './recording-ipc'
import { isRendererAuthenticated } from './auth-handlers'

let tray: Tray | null = null
let trayOptions: { onQuit: () => void } | null = null

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
  trayOptions = null
}

function buildTrayMenu(options: { onQuit: () => void }) {
  const authenticated = isRendererAuthenticated()

  return Menu.buildFromTemplate([
    {
      label: authenticated ? 'Open Dashboard' : 'Log in',
      click: () => {
        if (!isRendererAuthenticated()) {
          showAuthWindow()
          return
        }
        revealDashboardWithDraftFlush()
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => options.onQuit(),
    },
  ])
}

export function refreshTrayMenu() {
  if (!tray || !trayOptions) return
  tray.setContextMenu(buildTrayMenu(trayOptions))
}

export function setupTray(options: { onQuit: () => void }) {
  trayOptions = options
  if (tray) {
    tray.setContextMenu(buildTrayMenu(options))
    return tray
  }

  const iconPath = getTrayIconPath()
  const image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()

  // Windows tray often expects small icons; resize defensively.
  const trayImage = image.isEmpty() ? image : image.resize({ width: 16, height: 16 })

  tray = new Tray(trayImage)
  tray.setToolTip('Orion')

  tray.setContextMenu(buildTrayMenu(options))

  tray.on('click', () => {
    // While signed out, the tray icon only exposes the menu. The explicit
    // "Log in" item is the action that reopens the auth window.
    if (!isRendererAuthenticated()) return
    revealDashboardWithDraftFlush()
  })

  return tray
}
