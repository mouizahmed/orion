import { app, safeStorage } from 'electron'
import Store from 'electron-store'

import type { RecordingNoteDraft } from '../src/features/recording/recording-types'

type StoredRecordingDraft = {
  encryptedDrafts: Record<string, string>
}

const memoryDrafts = new Map<string, RecordingNoteDraft>()
let store: Store<StoredRecordingDraft> | null = null

function getStore() {
  store ??= new Store<StoredRecordingDraft>({
    name: 'orion-recording-draft',
    defaults: { encryptedDrafts: {} },
  })
  return store
}

function securePersistenceAvailable() {
  const selectedBackend = safeStorage.getSelectedStorageBackend?.()
  return safeStorage.isEncryptionAvailable() && selectedBackend !== 'basic_text'
}

function isValidAccountId(accountId: string) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(accountId)
}

function isRecordingNoteDraft(value: unknown): value is RecordingNoteDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<RecordingNoteDraft>
  return typeof draft.sessionId === 'string'
    && draft.sessionId.length > 0
    && typeof draft.noteId === 'string'
    && draft.noteId.length > 0
    && typeof draft.value === 'string'
    && draft.value.length <= 5_000_000
    && Number.isSafeInteger(draft.version)
    && (draft.version ?? 0) > 0
}

export function loadRecordingDraft(accountId: string): RecordingNoteDraft | null {
  if (!isValidAccountId(accountId)) return null
  if (!app.isReady()) return null
  if (!securePersistenceAvailable()) return memoryDrafts.get(accountId) ?? null

  const encrypted = getStore().get('encryptedDrafts')[accountId]
  if (!encrypted) return null
  try {
    const parsed = JSON.parse(
      safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
    ) as unknown
    if (!isRecordingNoteDraft(parsed)) throw new Error('Invalid recording draft')
    return parsed
  } catch (error) {
    console.error('Could not recover the encrypted recording draft:', error)
    const encryptedDrafts = { ...getStore().get('encryptedDrafts') }
    delete encryptedDrafts[accountId]
    getStore().set('encryptedDrafts', encryptedDrafts)
    return null
  }
}

export function saveRecordingDraft(accountId: string, draft: RecordingNoteDraft | null) {
  if (!isValidAccountId(accountId)) return
  if (draft) memoryDrafts.set(accountId, draft)
  else memoryDrafts.delete(accountId)
  if (!app.isReady() || !securePersistenceAvailable()) {
    if (app.isPackaged && draft) {
      console.error('Secure recording draft persistence is unavailable')
    }
    return
  }

  const encryptedDrafts = { ...getStore().get('encryptedDrafts') }
  if (draft) {
    encryptedDrafts[accountId] = safeStorage.encryptString(JSON.stringify(draft)).toString('base64')
  } else {
    delete encryptedDrafts[accountId]
  }
  getStore().set('encryptedDrafts', encryptedDrafts)
}
