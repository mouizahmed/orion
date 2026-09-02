import { ipcRenderer, contextBridge } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { RecordingNoteDraft, RecordingSessionSnapshot, RecordingTranscriptSegment, RecordingUiSnapshot } from '../src/features/recording/recording-types'

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

type RecordingStartInput = {
  sessionId: string
  noteId: string
  noteTitle: string
  startedAt: number
}

type RecordingDraftFlushValue = Pick<RecordingNoteDraft, 'sessionId' | 'noteId' | 'value'>

const recordingStartListeners = new Set<(input: RecordingStartInput) => void>()
const recordingStopListeners = new Set<(input: { stoppedAt: number }) => void>()
const dashboardSelectNoteListeners = new Set<(payload?: { noteId?: string }) => void>()
let pendingRecordingStart: RecordingStartInput | null = null
let pendingRecordingStop: { stoppedAt: number } | null = null
let pendingDashboardSelectNote: { noteId?: string } | null = null
let recordingDraftFlushProvider: (() => RecordingDraftFlushValue | null) | null = null

// Main sends this before swapping window visibility. The response is a
// barrier: same-renderer IPC is ordered, so by the time main receives it,
// every draft update this renderer sent beforehand has been applied. The
// provider also returns the live editor value in case a future editor change
// path defers its updates. A renderer with no provider has no editor state,
// so replying immediately with no draft is correct, and replying always is
// what keeps main's flush from waiting out its timeout.
ipcRenderer.on('recording:request-draft-flush', (_event, input?: { flushId?: string }) => {
  const flushId = input?.flushId
  if (typeof flushId !== 'string') return
  let draft: RecordingDraftFlushValue | null = null
  try {
    draft = recordingDraftFlushProvider?.() ?? null
  } catch {
    // A broken provider must not block the visibility transition.
  }
  ipcRenderer.send('recording:flush-draft', { flushId, draft })
})

ipcRenderer.on('dashboard:select-note', (_event, payload?: { noteId?: string }) => {
  if (dashboardSelectNoteListeners.size === 0) {
    pendingDashboardSelectNote = payload ?? {}
    return
  }
  for (const listener of dashboardSelectNoteListeners) listener(payload)
})

ipcRenderer.on('recording:start', (_event, input: RecordingStartInput) => {
  if (recordingStartListeners.size === 0) {
    pendingRecordingStart = input
    return
  }
  for (const listener of recordingStartListeners) listener(input)
})

ipcRenderer.on('recording:stop', (_event, input: { stoppedAt: number }) => {
  if (recordingStopListeners.size === 0) {
    pendingRecordingStop = input
    return
  }
  for (const listener of recordingStopListeners) listener(input)
})

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
  setWindowSize: (width: number, height: number) => {
    ipcRenderer.send('set-window-size', { width, height })
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
    dashboardSelectNoteListeners.add(callback)
    if (pendingDashboardSelectNote) {
      const payload = pendingDashboardSelectNote
      pendingDashboardSelectNote = null
      callback(payload)
    }
    return () => dashboardSelectNoteListeners.delete(callback)
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

contextBridge.exposeInMainWorld('recordingControl', {
  start: (input: { noteId: string; noteTitle: string; noteMarkdown: string }) => ipcRenderer.invoke('recording:start', input) as Promise<void>,
  stop: () => ipcRenderer.invoke('recording:stop') as Promise<void>,
  showOverlay: () => ipcRenderer.invoke('recording:show-overlay') as Promise<void>,
  getSnapshot: () => ipcRenderer.invoke('recording:get-snapshot') as Promise<RecordingUiSnapshot>,
  publishSession: (session: RecordingSessionSnapshot) => ipcRenderer.send('recording:publish-session', session),
  publishTranscriptUpdate: (segment: RecordingTranscriptSegment) => ipcRenderer.send('recording:publish-transcript-update', segment),
  markSurfaceReady: (sessionId: string) => ipcRenderer.send('recording:surface-ready', { sessionId }),
  getNoteDraft: () => ipcRenderer.invoke('recording:get-note-draft') as Promise<RecordingNoteDraft | null>,
  updateNoteDraft: (draft: Pick<RecordingNoteDraft, 'sessionId' | 'noteId' | 'value'>) => {
    ipcRenderer.send('recording:update-note-draft', draft)
  },
  acknowledgeNoteDraft: (draft: Pick<RecordingNoteDraft, 'sessionId' | 'noteId' | 'value'>) => {
    ipcRenderer.send('recording:ack-note-draft', draft)
  },
  discardNoteDraft: (noteId: string) => {
    ipcRenderer.send('recording:discard-note-draft', { noteId })
  },
  setDraftFlushProvider: (provider: () => RecordingDraftFlushValue | null) => {
    recordingDraftFlushProvider = provider
    return () => {
      if (recordingDraftFlushProvider === provider) recordingDraftFlushProvider = null
    }
  },
  onStart: (callback: (input: RecordingStartInput) => void) => {
    recordingStartListeners.add(callback)
    if (pendingRecordingStart) {
      const input = pendingRecordingStart
      pendingRecordingStart = null
      callback(input)
    }
    return () => recordingStartListeners.delete(callback)
  },
  onStop: (callback: (input: { stoppedAt: number }) => void) => {
    recordingStopListeners.add(callback)
    if (pendingRecordingStop) {
      const input = pendingRecordingStop
      pendingRecordingStop = null
      callback(input)
    }
    return () => recordingStopListeners.delete(callback)
  },
  onSession: (callback: (session: RecordingSessionSnapshot | null) => void) => {
    const listener = (_event: IpcRendererEvent, session: RecordingSessionSnapshot | null) => callback(session)
    ipcRenderer.on('recording:session', listener)
    return () => ipcRenderer.off('recording:session', listener)
  },
  onTranscriptUpdate: (callback: (segment: RecordingTranscriptSegment) => void) => {
    const listener = (_event: IpcRendererEvent, segment: RecordingTranscriptSegment) => callback(segment)
    ipcRenderer.on('recording:transcript-update', listener)
    return () => ipcRenderer.off('recording:transcript-update', listener)
  },
  onNoteDraft: (callback: (draft: RecordingNoteDraft | null) => void) => {
    const listener = (_event: IpcRendererEvent, draft: RecordingNoteDraft | null) => callback(draft)
    ipcRenderer.on('recording:note-draft', listener)
    return () => ipcRenderer.off('recording:note-draft', listener)
  },
})

// Main may send recording commands as soon as preload has installed the
// listeners above. Commands are buffered until the React controller subscribes.
ipcRenderer.send('recording:preload-ready')

contextBridge.exposeInMainWorld('recordingSettings', {
  get: () => ipcRenderer.invoke('recording-settings:get') as Promise<RecordingSettings>,
  update: (settings: Partial<RecordingSettings>) =>
    ipcRenderer.invoke('recording-settings:update', settings) as Promise<RecordingSettings>,
  pickLocalPath: () =>
    ipcRenderer.invoke('recording-settings:pick-local-path') as Promise<RecordingSettings>,
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
