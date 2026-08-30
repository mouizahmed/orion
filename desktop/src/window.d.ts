import type {
  AttachmentResult,
  AuthResult,
  AuthSnapshot,
  IntegrationConnectionCompletedEvent,
  IntegrationProvider,
  IntegrationResult,
  MeetingPanel,
  RecordingSettings,
  ShortcutAction,
  ShortcutState,
  VisibleOverlayBounds,
} from '@/lib/desktop-api'
import type { LiveInsight, LiveResponseSuggestion } from './types/live-insight'

interface AppEventsControl {
  onMainProcessMessage: (callback: (message: unknown) => void) => () => void
}

interface WindowControl {
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

interface DashboardControl {
  open: (noteId?: string) => void
  close: () => void
  onSelectNote: (callback: (payload?: { noteId?: string }) => void) => () => void
}

interface ShortcutControl {
  getAll: () => Promise<ShortcutState>
  update: (action: ShortcutAction, shortcut: string | null) => Promise<ShortcutState>
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

interface AudioCaptureControl {
  getDesktopSourceId: () => Promise<string | null>
  startSystemAudioStream: () => Promise<void>
  stopSystemAudioStream: () => void
  onSystemAudioChunk: (callback: (buffer: ArrayBuffer) => void) => () => void
}

declare global {
  interface Window {
    appEvents?: AppEventsControl
    windowControl?: WindowControl
    electronAPI?: ElectronAPI
    shortcutControl?: ShortcutControl
    recordingSettings?: RecordingSettingsControl
    attachments?: AttachmentsControl
    editorContextMenu?: EditorContextMenuControl
    liveInsights?: LiveInsightsControl
    dashboard?: DashboardControl
    audioCapture?: AudioCaptureControl
    env?: {
      platform: NodeJS.Platform
    }
  }
}

export {}
