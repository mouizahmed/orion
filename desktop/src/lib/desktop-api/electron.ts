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
    setWindowSize: (...args) => window.windowControl?.setWindowSize?.(...args),
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
  recording: {
    start: (input) => window.recordingControl?.start?.(input) ?? missingApi('recordingControl.start'),
    stop: () => window.recordingControl?.stop?.() ?? missingApi('recordingControl.stop'),
    showOverlay: () => window.recordingControl?.showOverlay?.() ?? missingApi('recordingControl.showOverlay'),
    getSnapshot: () => window.recordingControl?.getSnapshot?.() ?? missingApi('recordingControl.getSnapshot'),
    publishSession: (session) => window.recordingControl?.publishSession?.(session),
    publishTranscriptUpdate: (segment) => window.recordingControl?.publishTranscriptUpdate?.(segment),
    markSurfaceReady: (sessionId) => window.recordingControl?.markSurfaceReady?.(sessionId),
    getNoteDraft: () => window.recordingControl?.getNoteDraft?.() ?? missingApi('recordingControl.getNoteDraft'),
    updateNoteDraft: (draft) => window.recordingControl?.updateNoteDraft?.(draft),
    acknowledgeNoteDraft: (draft) => window.recordingControl?.acknowledgeNoteDraft?.(draft),
    setDraftFlushProvider: (provider) => window.recordingControl?.setDraftFlushProvider?.(provider) ?? (() => undefined),
    onStart: (callback) => window.recordingControl?.onStart?.(callback) ?? (() => undefined),
    onStop: (callback) => window.recordingControl?.onStop?.(callback) ?? (() => undefined),
    onSession: (callback) => window.recordingControl?.onSession?.(callback) ?? (() => undefined),
    onTranscriptUpdate: (callback) => window.recordingControl?.onTranscriptUpdate?.(callback) ?? (() => undefined),
    onNoteDraft: (callback) => window.recordingControl?.onNoteDraft?.(callback) ?? (() => undefined),
  },
  recordingSettings: {
    isAvailable: () => Boolean(window.recordingSettings),
    get: () => window.recordingSettings?.get?.() ?? missingApi('recordingSettings.get'),
    update: (settings) => window.recordingSettings?.update?.(settings) ?? missingApi('recordingSettings.update'),
    pickLocalPath: () =>
      window.recordingSettings?.pickLocalPath?.() ?? missingApi('recordingSettings.pickLocalPath'),
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
