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
  const filename = process.platform === 'darwin'
    ? 'orion-menubarTemplate.png'
    : 'orion-app-icon.png'
  return path.join(publicDir, filename)
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
      label: authenticated ? 'Open Orion' : 'Log in',
      click: () => {
        if (!isRendererAuthenticated()) {
          showAuthWindow()
          return
        }
        revealDashboardWithDraftFlush()
      },
    },
    { label: 'New Note' },
    { label: 'Settings' },
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

  let trayImage = image
  if (!trayImage.isEmpty()) {
    if (process.platform === 'darwin') {
      trayImage.setTemplateImage(true)
    } else {
      // Windows tray often expects small icons; resize defensively.
      trayImage = trayImage.resize({ width: 16, height: 16 })
    }
  }

  tray = new Tray(trayImage)
  tray.setToolTip('Orion')

  tray.setContextMenu(buildTrayMenu(options))

  tray.on('click', () => {
    // Keep a tray click menu-first in every auth state. The first menu item
    // is the explicit action that opens the auth window or dashboard.
    return
  })

  return tray
}
