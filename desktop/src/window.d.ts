// TypeScript declarations for window APIs
import type { LiveInsight, LiveResponseSuggestion } from './types/live-insight'

// Authentication Result - using discriminated union for type safety
type AuthResult =
  | {
      success: true
      token?: string // Present for OAuth flows, absent for logout
    }
  | {
      success: false
      error: string
    }

// IPC Event type for Electron renderer
interface IpcRendererEvent {
  preventDefault(): void
  sender: {
    send(channel: string, ...args: unknown[]): void
  }
}

// Session update event data - using discriminated union for type safety
type AuthSessionUpdateEvent =
  | {
      success: true
      firebaseToken: string
      isNewUser?: boolean
      timestamp: string
    }
  | {
      success: false
      error: string
      timestamp: string
    }

interface WindowControl {
  startDrag: (mouseX: number, mouseY: number) => void
  moveDrag: (mouseX: number, mouseY: number, offsetX: number, offsetY: number) => void
  setIgnoreMouseEvents: (ignore: boolean) => void
  toggleVisibility: () => void
  setWindowHeight: (height: number) => void
  setWindowSize: (width: number, height: number) => void
  setVisibleOverlayBounds: (bounds: { offsetX: number; offsetY: number; width: number; height: number }) => void
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
}

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

type MeetingPanel = 'notepad' | 'transcript' | 'ask' | 'insights'

type ShortcutState = {
  current: Record<ShortcutAction, string>
  defaults: Record<ShortcutAction, string>
}

interface ShortcutControl {
  getAll: () => Promise<ShortcutState>
  update: (action: ShortcutAction, shortcut: string | null) => Promise<ShortcutState>
}

type RecordingSettings = {
  storageLocation: 'server' | 'local'
  localRecordingsPath: string
}

interface RecordingSettingsControl {
  get: () => Promise<RecordingSettings>
  update: (settings: Partial<RecordingSettings>) => Promise<RecordingSettings>
  pickLocalPath: () => Promise<RecordingSettings>
}

interface AttachmentResult {
  kind: 'image' | 'file'
  mimeType: string
  name: string
  size: number
  filePath: string
  dataUrl?: string
}

interface AttachmentsControl {
  pickFiles: () => Promise<AttachmentResult[]>
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

type NoteRecord = {
  id: string
  title: string
  folderId?: string
  noteMarkdown: string
  createdAt: number
  updatedAt: number
}

interface ElectronAPI {
  // OAuth Authentication
  authenticateWithGoogle: () => Promise<AuthResult>

  // Session Management
  cancelAuthentication: () => Promise<AuthResult>
  logout: () => Promise<AuthResult>

  // Event listeners
  onAuthSessionUpdated: (
    callback: (
      event: IpcRendererEvent,
      data: AuthSessionUpdateEvent,
    ) => void,
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
    windowControl: WindowControl
    electronAPI: ElectronAPI
    shortcutControl?: ShortcutControl
    recordingSettings?: RecordingSettingsControl
    attachments?: AttachmentsControl
    liveInsights?: LiveInsightsControl
    dashboard?: DashboardControl
    audioCapture?: AudioCaptureControl
    env: {
      platform: NodeJS.Platform
    }
  }
}

export {}
