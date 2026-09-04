import { app, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getDashboardWindow, getWindow, isKnownRendererSender } from './window'
import { isRendererAuthenticated } from './auth-handlers'

export type RecordingSettings = {
  storageLocation: 'server' | 'local' | 'none'
  localRecordingsPath: string
}

function defaultLocalRecordingsPath() {
  return path.join(app.getPath('documents'), 'Orion Recordings')
}

function defaultRecordingSettings(): RecordingSettings {
  return {
    storageLocation: 'server',
    localRecordingsPath: defaultLocalRecordingsPath(),
  }
}

function recordingSettingsPath() {
  return path.join(app.getPath('userData'), 'recording-settings.json')
}

export function getRecordingSettings(): RecordingSettings {
  try {
    const raw = fs.readFileSync(recordingSettingsPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<RecordingSettings>
    return {
      storageLocation: recordingStorageLocation(parsed.storageLocation),
      localRecordingsPath:
        typeof parsed.localRecordingsPath === 'string' && parsed.localRecordingsPath.trim().length > 0
          ? parsed.localRecordingsPath
          : defaultLocalRecordingsPath(),
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return defaultRecordingSettings()
    }
    console.error('Failed to read recording settings:', error)
    return defaultRecordingSettings()
  }
}

function writeRecordingSettings(settings: RecordingSettings) {
  fs.mkdirSync(path.dirname(recordingSettingsPath()), { recursive: true })
  fs.writeFileSync(recordingSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

function ensureWritableDirectory(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true })
  fs.accessSync(dirPath, fs.constants.W_OK)
}

export function setupRecordingSettingsIpc() {
  ipcMain.handle('recording-settings:get', (event) => {
    if (!isKnownRendererSender(event.sender) || !isRendererAuthenticated()) throw new Error('Unauthorized IPC sender')
    return getRecordingSettings()
  })

  ipcMain.handle('recording-settings:update', (event, payload: Partial<RecordingSettings>) => {
    if (!isKnownRendererSender(event.sender) || !isRendererAuthenticated()) throw new Error('Unauthorized IPC sender')
    const current = getRecordingSettings()
    const storageLocation = payload.storageLocation === undefined
      ? current.storageLocation
      : recordingStorageLocation(payload.storageLocation)
    const localRecordingsPath =
      typeof payload.localRecordingsPath === 'string'
        ? payload.localRecordingsPath
        : current.localRecordingsPath || defaultLocalRecordingsPath()

    if (storageLocation === 'local') {
      ensureWritableDirectory(localRecordingsPath)
    }

    const next: RecordingSettings = {
      storageLocation,
      localRecordingsPath,
    }

    writeRecordingSettings(next)
    return next
  })

  ipcMain.handle('recording-settings:pick-local-path', async (event) => {
    if (!isKnownRendererSender(event.sender) || !isRendererAuthenticated()) throw new Error('Unauthorized IPC sender')
    const win = getDashboardWindow() ?? getWindow()
    const dialogOptions: OpenDialogOptions = {
      title: 'Choose recordings folder',
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return getRecordingSettings()
    }

    const selectedPath = result.filePaths[0]
    try {
      ensureWritableDirectory(selectedPath)
    } catch {
      dialog.showErrorBox('Folder not writable', 'Choose a folder where Orion can save recordings.')
      return getRecordingSettings()
    }

    const next: RecordingSettings = {
      ...getRecordingSettings(),
      storageLocation: 'local',
      localRecordingsPath: selectedPath,
    }
    writeRecordingSettings(next)
    return next
  })
}

function recordingStorageLocation(value: unknown): RecordingSettings['storageLocation'] {
  if (value === 'local' || value === 'none') return value
  return 'server'
}
