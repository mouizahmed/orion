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

type IntegrationProvider = 'google' | 'microsoft'

type IntegrationResult = {
  success: boolean
  error?: string
  authInvalid?: boolean
}

type IntegrationConnectionCompletedEvent = {
  type: 'integration_connection_completed'
  success: boolean
  provider?: string
  feature?: string
  error?: string
}

contextBridge.exposeInMainWorld('appEvents', {
  onMainProcessMessage: (callback: (message: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, message: unknown) => callback(message)
    ipcRenderer.on('main-process-message', listener)
    return () => {
      ipcRenderer.off('main-process-message', listener)
    }
  },
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
  onSelectNote: (callback: (payload?: { noteId?: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload?: { noteId?: string }) => callback(payload)
    ipcRenderer.on('dashboard:select-note', listener)
    return () => {
      ipcRenderer.off('dashboard:select-note', listener)
    }
  },
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

contextBridge.exposeInMainWorld('editorContextMenu', {
  run: (command: 'cut' | 'copy' | 'paste' | 'selectAll') => ipcRenderer.send('editor:run-command', command),
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
  authenticateWithMicrosoft: () => ipcRenderer.invoke('auth:microsoft'),

  // Integration connections
  connectIntegration: (provider: IntegrationProvider, feature: string) =>
    ipcRenderer.invoke('integration:connect', { provider, feature }) as Promise<IntegrationResult>,
  disconnectIntegration: (connectionID: string) =>
    ipcRenderer.invoke('integration:disconnect', { connectionID }) as Promise<IntegrationResult>,

  // Session Management
  cancelAuthentication: () => ipcRenderer.invoke('auth:cancel'),
  getAuthSnapshot: () => ipcRenderer.invoke('auth:get-snapshot'),
  getAccessToken: (forceRefresh = false) => ipcRenderer.invoke('auth:get-access-token', forceRefresh),
  logout: () => ipcRenderer.invoke('auth:logout'),
  logoutAllDevices: () => ipcRenderer.invoke('auth:logout-all'),
  revalidateAuth: () => ipcRenderer.invoke('auth:revalidate'),

  // Event listeners
  onAuthStateChanged: (callback: (data: unknown) => void) => {
    const listener = (_event: IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('auth:changed', listener)
    return () => {
      ipcRenderer.off('auth:changed', listener)
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
