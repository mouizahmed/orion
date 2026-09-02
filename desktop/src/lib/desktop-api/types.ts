import type { RecordingNoteDraft, RecordingSessionSnapshot, RecordingTranscriptSegment, RecordingUiSnapshot } from '@/features/recording/recording-types'

export type AuthResult =
  | {
      success: true
      expiresInSeconds?: number
    }
  | {
      success: false
      error: string
    }

export type AuthStatus = 'initializing' | 'validating' | 'anonymous' | 'oauth-pending' | 'authenticated' | 'service-unavailable' | 'blocked'

export type AuthUser = {
  id: string
  email: string
  name: string
  plan: 'free' | 'professional' | 'business'
  picture?: string
}

export type AuthSnapshot = {
  status: AuthStatus
  user: AuthUser | null
  error: string | null
  loginProvider: IntegrationProvider | null
}

export type IntegrationProvider = 'google' | 'microsoft'

export type IntegrationResult =
  | {
      success: true
    }
  | {
      success: false
      error: string
      authInvalid?: boolean
    }

export type IntegrationConnectionCompletedEvent = {
  type: 'integration_connection_completed'
  success: boolean
  provider?: string
  feature?: string
  error?: string
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

export type Platform = NodeJS.Platform

export type DesktopApi = {
  platform: {
    current: () => Platform
  }
  appEvents: {
    onMainProcessMessage: (callback: (message: unknown) => void) => () => void
  }
  window: {
    setWindowSize: (width: number, height: number) => void
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
  recording: {
    start: (input: { noteId: string; noteTitle: string; noteMarkdown: string }) => Promise<void>
    stop: () => Promise<void>
    showOverlay: () => Promise<void>
    getSnapshot: () => Promise<RecordingUiSnapshot>
    publishSession: (session: RecordingSessionSnapshot) => void
    publishTranscriptUpdate: (segment: RecordingTranscriptSegment) => void
    markSurfaceReady: (sessionId: string) => void
    getNoteDraft: () => Promise<RecordingNoteDraft | null>
    updateNoteDraft: (draft: Pick<RecordingNoteDraft, 'sessionId' | 'noteId' | 'value'>) => void
    acknowledgeNoteDraft: (draft: Pick<RecordingNoteDraft, 'sessionId' | 'noteId' | 'value'>) => void
    discardNoteDraft: (noteId: string) => void
    setDraftFlushProvider: (provider: () => Pick<RecordingNoteDraft, 'sessionId' | 'noteId' | 'value'> | null) => () => void
    onStart: (callback: (input: { sessionId: string; noteId: string; noteTitle: string; startedAt: number }) => void) => () => void
    onStop: (callback: (input: { stoppedAt: number }) => void) => () => void
    onSession: (callback: (session: RecordingSessionSnapshot | null) => void) => () => void
    onTranscriptUpdate: (callback: (segment: RecordingTranscriptSegment) => void) => () => void
    onNoteDraft: (callback: (draft: RecordingNoteDraft | null) => void) => () => void
  }
  recordingSettings: {
    isAvailable: () => boolean
    get: () => Promise<RecordingSettings>
    update: (settings: Partial<RecordingSettings>) => Promise<RecordingSettings>
    pickLocalPath: () => Promise<RecordingSettings>
  }
  auth: {
    loginWithGoogle: () => Promise<AuthResult>
    loginWithMicrosoft: () => Promise<AuthResult>
    cancel: () => Promise<AuthResult>
    getSnapshot: () => Promise<AuthSnapshot>
    getAccessToken: (forceRefresh?: boolean) => Promise<string>
    logout: () => Promise<AuthResult>
    logoutAllDevices: () => Promise<AuthResult>
    revalidate: () => Promise<AuthSnapshot>
    onStateChanged: (callback: (data: AuthSnapshot) => void) => () => void
  }
  integrations: {
    connect: (provider: IntegrationProvider, feature: string) => Promise<IntegrationResult>
    disconnect: (connectionID: string) => Promise<IntegrationResult>
    onConnectionCompleted: (callback: (event: IntegrationConnectionCompletedEvent) => void) => () => void
  }
}
