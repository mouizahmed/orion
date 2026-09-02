import type {
  AttachmentResult,
  AuthResult,
  AuthSnapshot,
  IntegrationConnectionCompletedEvent,
  IntegrationProvider,
  IntegrationResult,
  RecordingSettings,
} from '@/lib/desktop-api'
import type { RecordingNoteDraft, RecordingSessionSnapshot, RecordingTranscriptSegment, RecordingUiSnapshot } from '@/features/recording/recording-types'
import type { LiveInsight, LiveResponseSuggestion } from './types/live-insight'

interface AppEventsControl {
  onMainProcessMessage: (callback: (message: unknown) => void) => () => void
}

interface WindowControl {
  setWindowSize: (width: number, height: number) => void
  minimize: () => void
  close: () => void
}

interface DashboardControl {
  open: (noteId?: string) => void
  close: () => void
  onSelectNote: (callback: (payload?: { noteId?: string }) => void) => () => void
}

interface RecordingControl {
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

interface RecordingSettingsControl {
  get: () => Promise<RecordingSettings>
  update: (settings: Partial<RecordingSettings>) => Promise<RecordingSettings>
  pickLocalPath: () => Promise<RecordingSettings>
}

interface AttachmentsControl {
  pickFiles: () => Promise<AttachmentResult[]>
}

interface EditorContextMenuControl {
  run: (command: 'cut' | 'copy' | 'paste' | 'selectAll') => void
}

interface LiveInsightsControl {
  onInsight?: (callback: (event: { insight: LiveInsight }) => void) => () => void
  onProcessing?: (callback: (processing: boolean) => void) => () => void
  onReset?: (callback: () => void) => () => void
  onEnabledChange?: (callback: (enabled: boolean) => void) => () => void
  setEnabled?: (enabled: boolean) => void
  isEnabled?: () => boolean | Promise<boolean>
  onResponseSuggestion?: (callback: (event: { suggestion: LiveResponseSuggestion }) => void) => () => void
  onResponseClear?: (callback: () => void) => () => void
  clearResponseSuggestion?: () => void
}

interface ElectronAPI {
  authenticateWithGoogle: () => Promise<AuthResult>
  authenticateWithMicrosoft: () => Promise<AuthResult>
  connectIntegration: (
    provider: IntegrationProvider,
    feature: string,
  ) => Promise<IntegrationResult>
  disconnectIntegration: (
    connectionID: string,
  ) => Promise<IntegrationResult>
  cancelAuthentication: () => Promise<AuthResult>
  getAuthSnapshot: () => Promise<AuthSnapshot>
  getAccessToken: (forceRefresh?: boolean) => Promise<string>
  logout: () => Promise<AuthResult>
  logoutAllDevices: () => Promise<AuthResult>
  revalidateAuth: () => Promise<AuthSnapshot>
  onAuthStateChanged: (callback: (data: AuthSnapshot) => void) => () => void
  onIntegrationConnectionCompleted: (
    callback: (data: IntegrationConnectionCompletedEvent) => void,
  ) => () => void
}

declare global {
  interface Window {
    appEvents?: AppEventsControl
    windowControl?: WindowControl
    electronAPI?: ElectronAPI
    recordingControl?: RecordingControl
    recordingSettings?: RecordingSettingsControl
    attachments?: AttachmentsControl
    editorContextMenu?: EditorContextMenuControl
    liveInsights?: LiveInsightsControl
    dashboard?: DashboardControl
    env?: {
      platform: NodeJS.Platform
    }
  }
}

export {}
