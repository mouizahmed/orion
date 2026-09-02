import { Menu, Tray, nativeImage } from 'electron'
import path from 'node:path'
import { showAuthWindow } from './window'
import { revealDashboardWithDraftFlush } from './recording-ipc'
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
        label: 'Open Dashboard',
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

  tray.setContextMenu(buildMenu())

  tray.on('click', () => {
    if (!isRendererAuthenticated()) {
      showAuthWindow()
      return
    }

    revealDashboardWithDraftFlush()
  })

  return tray
}

