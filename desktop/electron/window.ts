import { BrowserWindow, nativeTheme, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setAuthCallbackWindow } from './protocol-handler'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

if (!process.env.APP_ROOT) {
  process.env.APP_ROOT = path.join(__dirname, '..')
}

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT!, 'public')
  : RENDERER_DIST

export let win: BrowserWindow | null = null
let authWin: BrowserWindow | null = null
let dashboardWin: BrowserWindow | null = null
let allowDashboardClose = false
let isAppQuitting = false

const TITLE_BAR_HEIGHT = 48
const TITLE_BAR_BACKGROUND = '#ffffff00'
const AUTH_WINDOW_WIDTH = 592
const AUTH_WINDOW_HEIGHT = 562
const AUTH_WINDOW_MAX_WIDTH = 1254
const AUTH_WINDOW_MAX_HEIGHT = 842

function getTitleBarColors() {
  const isDarkMode = nativeTheme.shouldUseDarkColors
  return {
    backgroundColor: TITLE_BAR_BACKGROUND,
    symbolColor: isDarkMode ? '#ffffff' : '#000000',
  }
}

function updateDashboardTitleBarColors() {
  if (!dashboardWin || dashboardWin.isDestroyed()) return
  const titleBarColors = getTitleBarColors()
  dashboardWin.setTitleBarOverlay({
    color: titleBarColors.backgroundColor,
    symbolColor: titleBarColors.symbolColor,
    height: TITLE_BAR_HEIGHT,
  })
}

function preventRefreshShortcuts(window: BrowserWindow) {
  window.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase()
    const isRefreshShortcut = key === 'r' && (input.control || input.meta)

    if (isRefreshShortcut) {
      event.preventDefault()
    }
  })
}

function isAppNavigationUrl(rawUrl: string) {
  if (VITE_DEV_SERVER_URL && rawUrl.startsWith(VITE_DEV_SERVER_URL)) {
    return true
  }
  return rawUrl.startsWith('file://')
}

function routeExternalLinksToBrowser(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppNavigationUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (isAppNavigationUrl(url)) return
    event.preventDefault()
    void shell.openExternal(url)
  })
}

export function setAppQuitting(value: boolean) {
  isAppQuitting = value
}

export function createWindow() {
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return win
  }

  win = new BrowserWindow({
    width: 656,
    height: 140,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    icon: path.join(process.env.VITE_PUBLIC!, 'orion-app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#00000000',
  })

  setAuthCallbackWindow(win)
  preventRefreshShortcuts(win)
  routeExternalLinksToBrowser(win)

  // Enable content protection to hide window from screen sharing
  win.setContentProtection(false)

  // Make window visible on all workspaces/desktops
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Platform-specific configuration
  if (process.platform === 'darwin') {
    // macOS: hide from mission control
    win.setHiddenInMissionControl(true)
  } else if (process.platform === 'win32') {
    // Windows: set highest always-on-top level
    win.setAlwaysOnTop(true, 'screen-saver')
  }

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  win.on('show', () => {
    // Defer focus event one frame to avoid blocking first paint on show.
    setTimeout(() => {
      if (!win?.isDestroyed() && win?.isVisible()) {
        win.webContents.send('focus-input')
      }
    }, 16)
  })

  win.on('closed', () => {
    win = null
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  return win
}

export function createAuthWindow(options: { show?: boolean } = {}) {
  const shouldShow = options.show ?? false

  if (authWin && !authWin.isDestroyed()) {
    setAuthCallbackWindow(authWin)
    if (shouldShow) {
      authWin.show()
      authWin.focus()
    }
    return authWin
  }

  authWin = new BrowserWindow({
    width: AUTH_WINDOW_WIDTH,
    height: AUTH_WINDOW_HEIGHT,
    minWidth: AUTH_WINDOW_WIDTH,
    minHeight: AUTH_WINDOW_HEIGHT,
    maxWidth: AUTH_WINDOW_MAX_WIDTH,
    maxHeight: AUTH_WINDOW_MAX_HEIGHT,
    frame: false,
    transparent: false,
    hasShadow: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    resizable: false,
    show: shouldShow,
    icon: path.join(process.env.VITE_PUBLIC!, 'orion-app-icon.png'),
    title: 'Orion',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#171417',
  })

  setAuthCallbackWindow(authWin)
  preventRefreshShortcuts(authWin)
  routeExternalLinksToBrowser(authWin)
  authWin.setContentProtection(false)
  authWin.setMenuBarVisibility(false)

  authWin.on('closed', () => {
    authWin = null
  })

  if (VITE_DEV_SERVER_URL) {
    authWin.loadURL(`${VITE_DEV_SERVER_URL}?view=auth`)
  } else {
    authWin.loadFile(path.join(RENDERER_DIST, 'index.html'), {
      query: { view: 'auth' },
    })
  }

  return authWin
}

export function closeAuthWindow() {
  if (!authWin || authWin.isDestroyed()) return
  authWin.close()
}

export function showAuthWindow() {
  const auth = createAuthWindow({ show: true })
  if (auth.isMinimized()) auth.restore()
  auth.show()
  auth.focus()
  return auth
}

export function createDashboardWindow(noteId?: string) {
  if (dashboardWin && !dashboardWin.isDestroyed()) {
    dashboardWin.show()
    dashboardWin.focus()
    return dashboardWin
  }

  dashboardWin = new BrowserWindow({
    width: 1280,
    height: 800,
    transparent: false,
    hasShadow: true,
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    icon: path.join(process.env.VITE_PUBLIC!, 'orion-app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    backgroundColor: '#0b0b0c',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: getTitleBarColors().backgroundColor,
      symbolColor: getTitleBarColors().symbolColor,
      height: TITLE_BAR_HEIGHT,
    },
  })

  dashboardWin.setMenuBarVisibility(false)
  preventRefreshShortcuts(dashboardWin)
  routeExternalLinksToBrowser(dashboardWin)

  // On Windows: clicking the window "X" should minimize-to-tray (hide),
  // not quit the app. We'll allow programmatic closes (e.g. "Back to overlay")
  // and app quit to proceed.
  dashboardWin.on('close', (event) => {
    if (isAppQuitting || allowDashboardClose) {
      return
    }
    event.preventDefault()
    dashboardWin?.hide()
  })

  dashboardWin.on('closed', () => {
    nativeTheme.removeListener('updated', updateDashboardTitleBarColors)
    dashboardWin = null
    allowDashboardClose = false
  })

  nativeTheme.on('updated', updateDashboardTitleBarColors)

  const query = new URLSearchParams({ view: 'dashboard' })
  if (noteId) {
    query.set('noteId', noteId)
  }

  if (VITE_DEV_SERVER_URL) {
    dashboardWin.loadURL(`${VITE_DEV_SERVER_URL}?${query.toString()}`)
  } else {
    dashboardWin.loadFile(path.join(RENDERER_DIST, 'index.html'), {
      query: Object.fromEntries(query.entries()),
    })
  }

  return dashboardWin
}

export function closeDashboardWindow() {
  if (!dashboardWin || dashboardWin.isDestroyed()) return
  allowDashboardClose = true
  dashboardWin.close()
}

export function destroyOverlayWindow() {
  if (!win || win.isDestroyed()) return
  const overlay = win
  win = null
  overlay.destroy()
}

export function getWindow() {
  return win
}

export function getAuthWindow() {
  return authWin
}

export function getDashboardWindow() {
  return dashboardWin
}

export function setWindow(window: BrowserWindow | null) {
  win = window
}

export function setAuthWindow(window: BrowserWindow | null) {
  authWin = window
}

export function setDashboardWindow(window: BrowserWindow | null) {
  dashboardWin = window
}

