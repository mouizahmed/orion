export type AuthResult =
  | {
      success: true
      token?: string
    }
  | {
      success: false
      error: string
    }

export type AuthSessionUpdateEvent =
  | {
      success: true
      firebaseToken: string
      timestamp: string
    }
  | {
      success: false
      error: string
      timestamp: string
    }

export type IntegrationProvider = 'google' | 'microsoft' | 'notion'

export type IntegrationResult =
  | {
      success: true
    }
  | {
      success: false
      error: string
    }

export type IntegrationConnectionCompletedEvent = {
  type: 'integration_connection_completed'
  success: boolean
  provider?: string
  feature?: string
  error?: string
}

export type ShortcutAction =
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

export type MeetingPanel = 'notepad' | 'transcript' | 'ask' | 'insights'

export type ShortcutState = {
  current: Record<ShortcutAction, string>
  defaults: Record<ShortcutAction, string>
}

export type RecordingSettings = {
  storageLocation: 'server' | 'local'
  localRecordingsPath: string
}

export type AttachmentResult = {
  kind: 'image' | 'file'
  mimeType: string
  name: string
  size: number
  filePath: string
  dataUrl?: string
}

export type VisibleOverlayBounds = {
  offsetX: number
  offsetY: number
  width: number
  height: number
}

export type Platform = NodeJS.Platform

export type DesktopApi = {
  platform: {
    current: () => Platform
  }
  appEvents: {
    onMainProcessMessage: (callback: (message: unknown) => void) => () => void
  }
  window: {
    startDrag: (mouseX: number, mouseY: number) => void
    moveDrag: (mouseX: number, mouseY: number, offsetX: number, offsetY: number) => void
    setIgnoreMouseEvents: (ignore: boolean) => void
    toggleVisibility: () => void
    setWindowHeight: (height: number) => void
    setWindowSize: (width: number, height: number) => void
    setVisibleOverlayBounds: (bounds: VisibleOverlayBounds) => void
    onDragOffset: (callback: (offset: { x: number; y: number }) => void) => void
    onFocusInput: (callback: () => void) => void
    onToggleNotepadFocus: (callback: () => void) => () => void
    onToggleOverlayPanel: (callback: (panel: MeetingPanel) => void) => () => void
    blurOverlay: () => void
    minimize: () => void
    close: () => void
  }
  dashboard: {
    open: (noteId?: string) => void
    close: () => void
    onSelectNote: (callback: (payload?: { noteId?: string }) => void) => () => void
  }
  attachments: {
    pickFiles: () => Promise<AttachmentResult[]>
  }
  shortcuts: {
    isAvailable: () => boolean
    getAll: () => Promise<ShortcutState>
    update: (action: ShortcutAction, shortcut: string | null) => Promise<ShortcutState>
  }
  recordingSettings: {
    isAvailable: () => boolean
    get: () => Promise<RecordingSettings>
    update: (settings: Partial<RecordingSettings>) => Promise<RecordingSettings>
    pickLocalPath: () => Promise<RecordingSettings>
  }
  audio: {
    getDesktopSourceId: () => Promise<string | null>
    startSystemAudioStream: () => Promise<void>
    stopSystemAudioStream: () => void
    onSystemAudioChunk: (callback: (buffer: ArrayBuffer) => void) => () => void
  }
  auth: {
    loginWithGoogle: () => Promise<AuthResult>
    loginWithMicrosoft: () => Promise<AuthResult>
    cancel: () => Promise<AuthResult>
    logout: () => Promise<AuthResult>
    notifyStateChanged: (isAuthenticated: boolean) => void
    onSessionUpdated: (callback: (data: AuthSessionUpdateEvent) => void) => () => void
  }
  integrations: {
    connect: (provider: IntegrationProvider, feature: string, idToken: string) => Promise<IntegrationResult>
    disconnect: (connectionID: string, idToken: string) => Promise<IntegrationResult>
    onConnectionCompleted: (callback: (event: IntegrationConnectionCompletedEvent) => void) => () => void
  }
}
