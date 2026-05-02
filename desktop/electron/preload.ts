import { ipcRenderer, contextBridge } from 'electron'
import type { IpcRendererEvent } from 'electron'

type ShortcutAction =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'toggleVisibility'
  | 'focusNotepad'
  | 'toggleNotepad'
  | 'toggleTranscript'
  | 'toggleAsk'
  | 'toggleInsights'

type ShortcutState = {
  current: Record<ShortcutAction, string>
  defaults: Record<ShortcutAction, string>
}

type RecordingSettings = {
  storageLocation: 'server' | 'local'
  localRecordingsPath: string
}

type IntegrationProvider = 'google' | 'microsoft' | 'notion'

type IntegrationResult = {
  success: boolean
  error?: string
}

type IntegrationConnectionCompletedEvent = {
  type: 'integration_connection_completed'
  success: boolean
  provider?: string
  feature?: string
  error?: string
}

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

// Expose window control API
contextBridge.exposeInMainWorld('windowControl', {
  startDrag: (mouseX: number, mouseY: number) => {
    ipcRenderer.send('window-drag-start', { mouseX, mouseY })
  },

  moveDrag: (mouseX: number, mouseY: number, offsetX: number, offsetY: number) => {
    ipcRenderer.send('window-drag-move', { mouseX, mouseY, offsetX, offsetY })
  },

  setIgnoreMouseEvents: (ignore: boolean) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore)
  },

  toggleVisibility: () => {
    ipcRenderer.send('toggle-visibility')
  },

  setWindowHeight: (height: number) => {
    ipcRenderer.send('set-window-height', height)
  },

  setWindowSize: (width: number, height: number) => {
    ipcRenderer.send('set-window-size', { width, height })
  },

  setVisibleOverlayBounds: (bounds: { offsetX: number; offsetY: number; width: number; height: number }) => {
    ipcRenderer.send('set-visible-overlay-bounds', bounds)
  },

  onDragOffset: (callback: (offset: { x: number; y: number }) => void) => {
    ipcRenderer.on('drag-offset', (_event, offset) => callback(offset))
  },

  onFocusInput: (callback: () => void) => {
    ipcRenderer.on('focus-input', () => callback())
  },

  onToggleNotepadFocus: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('toggle-notepad-focus', listener)
    return () => {
      ipcRenderer.off('toggle-notepad-focus', listener)
    }
  },

  onToggleOverlayPanel: (callback: (panel: 'notepad' | 'transcript' | 'ask' | 'insights') => void) => {
    const listener = (_event: IpcRendererEvent, panel: 'notepad' | 'transcript' | 'ask' | 'insights') => callback(panel)
    ipcRenderer.on('toggle-overlay-panel', listener)
    return () => {
      ipcRenderer.off('toggle-overlay-panel', listener)
    }
  },

  blurOverlay: () => {
    ipcRenderer.send('blur-overlay')
  },

  minimize: () => {
    ipcRenderer.send('window-minimize')
  },

  close: () => {
    ipcRenderer.send('window-close')
  },
})

// Dashboard window controls
contextBridge.exposeInMainWorld('dashboard', {
  open: (noteId?: string) => ipcRenderer.send('dashboard:open', { noteId }),
  close: () => ipcRenderer.send('dashboard:close'),
})

contextBridge.exposeInMainWorld('attachments', {
  pickFiles: () =>
    ipcRenderer.invoke('attachments:pick') as Promise<
      Array<{
        kind: 'image' | 'file'
        mimeType: string
        name: string
        size: number
        filePath: string
        dataUrl?: string
      }>
    >,
})

contextBridge.exposeInMainWorld('shortcutControl', {
  getAll: () => ipcRenderer.invoke('shortcuts:get') as Promise<ShortcutState>,
  update: (action: ShortcutAction, shortcut: string | null) =>
    ipcRenderer.invoke('shortcuts:update', { action, shortcut }) as Promise<ShortcutState>,
})

contextBridge.exposeInMainWorld('recordingSettings', {
  get: () => ipcRenderer.invoke('recording-settings:get') as Promise<RecordingSettings>,
  update: (settings: Partial<RecordingSettings>) =>
    ipcRenderer.invoke('recording-settings:update', settings) as Promise<RecordingSettings>,
  pickLocalPath: () =>
    ipcRenderer.invoke('recording-settings:pick-local-path') as Promise<RecordingSettings>,
})


// Audio capture API
contextBridge.exposeInMainWorld('audioCapture', {
  getDesktopSourceId: () => ipcRenderer.invoke('audio:get-desktop-source-id') as Promise<string | null>,
  startSystemAudioStream: () => ipcRenderer.invoke('audio:start-system-capture') as Promise<void>,
  stopSystemAudioStream: () => ipcRenderer.send('audio:stop-system-capture'),
  onSystemAudioChunk: (callback: (buffer: ArrayBuffer) => void) => {
    const listener = (_event: IpcRendererEvent, buffer: ArrayBuffer) => callback(buffer)
    ipcRenderer.on('audio:system-chunk', listener)
    return () => {
      ipcRenderer.off('audio:system-chunk', listener)
    }
  },
})

// Authentication API
contextBridge.exposeInMainWorld('electronAPI', {
  // OAuth Authentication
  authenticateWithGoogle: () => ipcRenderer.invoke('auth:google'),

  // Integration connections
  connectIntegration: (provider: IntegrationProvider, feature: string, idToken: string) =>
    ipcRenderer.invoke('integration:connect', { provider, feature, idToken }) as Promise<IntegrationResult>,
  disconnectIntegration: (connectionID: string, idToken: string) =>
    ipcRenderer.invoke('integration:disconnect', { connectionID, idToken }) as Promise<IntegrationResult>,

  // Session Management
  cancelAuthentication: () => ipcRenderer.invoke('auth:cancel'),
  logout: () => ipcRenderer.invoke('auth:logout'),

  // Event listeners
  onAuthSessionUpdated: (callback: (event: IpcRendererEvent, data: unknown) => void) => {
    const listener = (event: IpcRendererEvent, data: unknown) => callback(event, data)
    ipcRenderer.on('auth-session-updated', listener)
    return () => {
      ipcRenderer.off('auth-session-updated', listener)
    }
  },
  onIntegrationConnectionCompleted: (callback: (data: IntegrationConnectionCompletedEvent) => void) => {
    const listener = (_event: IpcRendererEvent, data: IntegrationConnectionCompletedEvent) => callback(data)
    ipcRenderer.on('integration:connection-completed', listener)
    return () => {
      ipcRenderer.off('integration:connection-completed', listener)
    }
  },
})

// Expose environment info
contextBridge.exposeInMainWorld('env', {
  platform: process.platform
})
