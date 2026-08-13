import type { DesktopApi } from './types'

function missingApi(name: string): never {
  throw new Error(`${name} is not available in this desktop environment`)
}

export const electronDesktopApi: DesktopApi = {
  platform: {
    current: () => window.env?.platform ?? 'win32',
  },
  appEvents: {
    onMainProcessMessage: (callback) => window.appEvents?.onMainProcessMessage?.(callback) ?? (() => undefined),
  },
  window: {
    startDrag: (...args) => window.windowControl?.startDrag?.(...args),
    moveDrag: (...args) => window.windowControl?.moveDrag?.(...args),
    setIgnoreMouseEvents: (...args) => window.windowControl?.setIgnoreMouseEvents?.(...args),
    toggleVisibility: () => window.windowControl?.toggleVisibility?.(),
    setWindowHeight: (...args) => window.windowControl?.setWindowHeight?.(...args),
    setWindowSize: (...args) => window.windowControl?.setWindowSize?.(...args),
    setVisibleOverlayBounds: (...args) => window.windowControl?.setVisibleOverlayBounds?.(...args),
    onDragOffset: (callback) => window.windowControl?.onDragOffset?.(callback),
    onFocusInput: (callback) => window.windowControl?.onFocusInput?.(callback),
    onToggleNotepadFocus: (callback) => window.windowControl?.onToggleNotepadFocus?.(callback) ?? (() => undefined),
    onToggleOverlayPanel: (callback) => window.windowControl?.onToggleOverlayPanel?.(callback) ?? (() => undefined),
    blurOverlay: () => window.windowControl?.blurOverlay?.(),
    minimize: () => window.windowControl?.minimize?.(),
    close: () => window.windowControl?.close?.(),
  },
  dashboard: {
    open: (noteId) => window.dashboard?.open?.(noteId),
    close: () => window.dashboard?.close?.(),
    onSelectNote: (callback) => window.dashboard?.onSelectNote?.(callback) ?? (() => undefined),
  },
  attachments: {
    pickFiles: () => window.attachments?.pickFiles?.() ?? missingApi('attachments.pickFiles'),
  },
  shortcuts: {
    isAvailable: () => Boolean(window.shortcutControl),
    getAll: () => window.shortcutControl?.getAll?.() ?? missingApi('shortcutControl.getAll'),
    update: (action, shortcut) =>
      window.shortcutControl?.update?.(action, shortcut) ?? missingApi('shortcutControl.update'),
  },
  recordingSettings: {
    isAvailable: () => Boolean(window.recordingSettings),
    get: () => window.recordingSettings?.get?.() ?? missingApi('recordingSettings.get'),
    update: (settings) => window.recordingSettings?.update?.(settings) ?? missingApi('recordingSettings.update'),
    pickLocalPath: () =>
      window.recordingSettings?.pickLocalPath?.() ?? missingApi('recordingSettings.pickLocalPath'),
  },
  audio: {
    getDesktopSourceId: () => window.audioCapture?.getDesktopSourceId?.() ?? missingApi('audioCapture.getDesktopSourceId'),
    startSystemAudioStream: () =>
      window.audioCapture?.startSystemAudioStream?.() ?? missingApi('audioCapture.startSystemAudioStream'),
    stopSystemAudioStream: () => window.audioCapture?.stopSystemAudioStream?.(),
    onSystemAudioChunk: (callback) => window.audioCapture?.onSystemAudioChunk?.(callback) ?? (() => undefined),
  },
  auth: {
    loginWithGoogle: () => window.electronAPI?.authenticateWithGoogle?.() ?? missingApi('electronAPI.authenticateWithGoogle'),
    loginWithMicrosoft: () =>
      window.electronAPI?.authenticateWithMicrosoft?.() ?? missingApi('electronAPI.authenticateWithMicrosoft'),
    cancel: () => window.electronAPI?.cancelAuthentication?.() ?? missingApi('electronAPI.cancelAuthentication'),
    getSnapshot: () => window.electronAPI?.getAuthSnapshot?.() ?? missingApi('electronAPI.getAuthSnapshot'),
    getAccessToken: (forceRefresh) => window.electronAPI?.getAccessToken?.(forceRefresh) ?? missingApi('electronAPI.getAccessToken'),
    logout: () => window.electronAPI?.logout?.() ?? missingApi('electronAPI.logout'),
    logoutAllDevices: () => window.electronAPI?.logoutAllDevices?.() ?? missingApi('electronAPI.logoutAllDevices'),
    revalidate: () => window.electronAPI?.revalidateAuth?.() ?? missingApi('electronAPI.revalidateAuth'),
    onStateChanged: (callback) => window.electronAPI?.onAuthStateChanged?.(callback) ?? (() => undefined),
  },
  integrations: {
    connect: (provider, feature) =>
      window.electronAPI?.connectIntegration?.(provider, feature) ??
      missingApi('electronAPI.connectIntegration'),
    disconnect: (connectionID) =>
      window.electronAPI?.disconnectIntegration?.(connectionID) ??
      missingApi('electronAPI.disconnectIntegration'),
    onConnectionCompleted: (callback) =>
      window.electronAPI?.onIntegrationConnectionCompleted?.(callback) ?? (() => undefined),
  },
}
