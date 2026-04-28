import { app, BrowserWindow, desktopCapturer, globalShortcut, session } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { setupAuthHandlers } from './auth-handlers'
import { setupProtocolHandler, setupProtocolEvents, setMainWindow } from './protocol-handler'
import {
  closeDashboardWindow,
  createWindow,
  getDashboardWindow,
  getWindow,
  setAppQuitting,
  setWindow,
} from './window'
import { setupAttachmentHandlers } from './attachments'
import {
  registerKeyboardShortcuts,
} from './shortcuts'
import { setupIpcHandlers } from './ipc-handlers'
import { destroyTray, setupTray } from './tray'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

// Setup protocol handler before app is ready (for OS protocol registration)
setupProtocolHandler()

// Single instance lock - ensure only one instance of the app runs
// This is critical for protocol handling (sunless:// URLs)
const gotTheLock = app.requestSingleInstanceLock()
let isQuitting = false

if (!gotTheLock) {
  // Another instance is already running, quit this one
  app.quit()
} else {
  // Setup protocol event listeners (for handling sunless:// URLs from second instance)
  setupProtocolEvents()

  app.whenReady().then(() => {
    // Route renderer getDisplayMedia() requests through Electron desktopCapturer on Windows.
    if (process.platform === 'win32') {
      session.defaultSession.setDisplayMediaRequestHandler(
        async (_request, callback) => {
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

    // Setup auth IPC handlers
    setupAuthHandlers()

    // Setup attachment handlers
    setupAttachmentHandlers()

    // Setup IPC handlers
    setupIpcHandlers()

    // Create the main window
    const win = createWindow()

    // Setup system tray (keep app running even if windows are closed)
    setupTray({
      onQuit: () => {
        isQuitting = true
        setAppQuitting(true)
        app.quit()
      },
    })

    // Register keyboard shortcuts after window is ready
    win.webContents.on('did-finish-load', () => {
      const toggleOverlayPanel = (panel: 'notepad' | 'transcript' | 'ask' | 'insights') => {
        const dashboard = getDashboardWindow()
        if (dashboard && !dashboard.isDestroyed() && dashboard.isVisible()) {
          closeDashboardWindow()
        }

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
        const dashboard = getDashboardWindow()
        if (dashboard && !dashboard.isDestroyed() && dashboard.isVisible()) {
          closeDashboardWindow()

          const overlay = getWindow()
          if (overlay && !overlay.isDestroyed()) {
            overlay.show()
            setTimeout(() => {
              if (!overlay.isDestroyed() && overlay.isVisible()) {
                overlay.focus()
              }
            }, 16)
          }
          return
        }

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
        const dashboard = getDashboardWindow()
        if (dashboard && !dashboard.isDestroyed() && dashboard.isVisible()) {
          closeDashboardWindow()
        }

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
    })

    // Focus input when window is shown
    win.on('show', () => {
      // Defer focus event one frame to avoid blocking first paint on show.
      setTimeout(() => {
        if (!win.isDestroyed() && win.isVisible()) {
          win.webContents.send('focus-input')
        }
      }, 16)
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
    setMainWindow(null)
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Cleanup shortcuts on quit
app.on('will-quit', () => {
  isQuitting = true
  setAppQuitting(true)
  globalShortcut.unregisterAll()
  destroyTray()
})
