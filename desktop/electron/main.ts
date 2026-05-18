import { app, BrowserWindow, desktopCapturer, globalShortcut, session } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { isRendererAuthenticated, setupAuthHandlers } from './auth-handlers'
import {
  setupProtocolHandler,
  setupProtocolEvents,
  setAuthCallbackWindow,
  setAuthWindowRevealHandler,
  setIntegrationWindowRevealHandler,
} from './protocol-handler'
import {
  closeAuthWindow,
  closeDashboardWindow,
  createDashboardWindow,
  createAuthWindow,
  createWindow,
  destroyOverlayWindow,
  getWindow,
  setAppQuitting,
  setAuthWindow,
  setWindow,
  showAuthWindow,
} from './window'
import { setupAttachmentHandlers } from './attachments'
import {
  registerKeyboardShortcuts,
  unregisterKeyboardShortcuts,
} from './shortcuts'
import { setupIpcHandlers, stopSystemAudioCapture, getCurrentAuthToken } from './ipc-handlers'
import { config } from './config'
import { destroyTray, setupTray } from './tray'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

// Setup protocol handler before app is ready (for OS protocol registration)
setupProtocolHandler()

// Single instance lock - ensure only one instance of the app runs
// This is critical for protocol handling (orion:// URLs)
const gotTheLock = app.requestSingleInstanceLock()
let isQuitting = false

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit()
} else {
  // Setup protocol event listeners (for handling orion:// URLs from second instance)
  setupProtocolEvents()

  app.whenReady().then(() => {
    // Route renderer getDisplayMedia() requests through Electron desktopCapturer on Windows.
    if (process.platform === 'win32') {
      session.defaultSession.setDisplayMediaRequestHandler(
        async (_request, callback) => {
          if (!isRendererAuthenticated()) {
            callback({})
            return
          }

          try {
            const sources = await desktopCapturer.getSources({ types: ['screen'] })
            const source = sources[0]
            if (!source) {
              callback({})
              return
            }
            callback({
              video: source,
              audio: 'loopback',
            })
          } catch (error) {
            console.error('Failed to handle display media request:', error)
            callback({})
          }
        },
        { useSystemPicker: false },
      )
    }

    // Setup attachment handlers
    setupAttachmentHandlers()
    setAuthWindowRevealHandler(() => {
      destroyOverlayWindow()
      showAuthWindow()
    })
    setIntegrationWindowRevealHandler(() => {
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

      const dashboard = createDashboardWindow()
      if (dashboard.isMinimized()) dashboard.restore()
      dashboard.show()
      dashboard.focus()
    })

    // Setup IPC handlers
    setupIpcHandlers()

    // Inject Authorization header on image proxy requests. <img> tags don't send
    // auth headers automatically, so the main process adds them here.
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ['<all_urls>'] },
      (details, callback) => {
        const isImageProxy =
          details.url.startsWith(config.backendUrl) &&
          /\/api\/notes\/[^/]+\/images\/[^/]+$/.test(new URL(details.url).pathname)
        const token = getCurrentAuthToken()
        if (isImageProxy && token) {
          callback({
            requestHeaders: { ...details.requestHeaders, Authorization: `Bearer ${token}` },
          })
        } else {
          callback({ requestHeaders: details.requestHeaders })
        }
      },
    )

    const registerOverlayShortcuts = () => {
      const toggleOverlayPanel = (panel: 'notepad' | 'transcript' | 'ask' | 'insights') => {
        const overlay = getWindow()
        if (!overlay || overlay.isDestroyed()) return
        if (!overlay.isVisible()) {
          overlay.show()
        }
        overlay.focus()
        setTimeout(() => {
          if (!overlay.isDestroyed() && overlay.isVisible()) {
            overlay.webContents.send('toggle-overlay-panel', panel)
          }
        }, 16)
      }

      const toggleVisibilityHandler = () => {
        const overlay = getWindow()
        if (!overlay || overlay.isDestroyed()) return
        if (overlay.isVisible()) {
          overlay.hide()
        } else {
          overlay.show()
          setTimeout(() => {
            if (!overlay.isDestroyed() && overlay.isVisible()) {
              overlay.focus()
            }
          }, 16)
        }
      }

      const focusNotepadHandler = () => {
        const overlay = getWindow()
        if (!overlay || overlay.isDestroyed()) return
        if (!overlay.isVisible()) {
          overlay.show()
        }
        overlay.focus()
        setTimeout(() => {
          if (!overlay.isDestroyed() && overlay.isVisible()) {
            overlay.webContents.send('toggle-notepad-focus')
          }
        }, 16)
      }

      registerKeyboardShortcuts(toggleVisibilityHandler, focusNotepadHandler, {
        toggleNotepad: () => toggleOverlayPanel('notepad'),
        toggleTranscript: () => toggleOverlayPanel('transcript'),
        toggleAsk: () => toggleOverlayPanel('ask'),
        toggleInsights: () => toggleOverlayPanel('insights'),
      })
    }

    // Register auth IPC before loading the renderer, otherwise a restored
    // Firebase session can emit auth state before the main process is listening.
    setupAuthHandlers({
      onSignedIn: () => {
        const overlay = createWindow()
        if (overlay.isVisible()) overlay.hide()
        closeAuthWindow()
        registerOverlayShortcuts()
        const dashboard = createDashboardWindow()
        dashboard.show()
        dashboard.focus()
      },
      onSignedOut: () => {
        stopSystemAudioCapture()
        closeDashboardWindow()
        destroyOverlayWindow()
        showAuthWindow()
        unregisterKeyboardShortcuts()
      },
      onOAuthPending: () => {
        stopSystemAudioCapture()
        closeDashboardWindow()
        destroyOverlayWindow()
        showAuthWindow()
        unregisterKeyboardShortcuts()
      },
    })

    // Create the logged-out auth window first. The overlay window is created
    // only after auth so its frameless transparent flags stay isolated.
    createAuthWindow({ show: false })

    // Setup system tray (keep app running even if windows are closed)
    setupTray({
      onQuit: () => {
        isQuitting = true
        setAppQuitting(true)
        app.quit()
      },
    })
  })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // With a tray icon we keep the app running. Only quit when explicitly requested.
  if (isQuitting) {
    app.quit()
    setWindow(null)
    setAuthWindow(null)
    setAuthCallbackWindow(null)
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    if (isRendererAuthenticated()) {
      createWindow()
    } else {
      showAuthWindow()
    }
  }
})

// Cleanup shortcuts on quit
app.on('will-quit', () => {
  isQuitting = true
  setAppQuitting(true)
  globalShortcut.unregisterAll()
  destroyTray()
})
