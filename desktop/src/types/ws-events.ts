export interface ServerEventMap {
  'auth.ok': undefined
  'auth.error': { message: string }
  'calendar.sync_status': { syncing: boolean; stale: boolean; last_synced_at?: string }
  'note.updated': { noteId: string; version: number; patch: unknown }
  'note.presence': { noteId: string; users: PresenceUser[] }
}

export interface ClientEventMap {
  'note.join': { noteId: string }
  'note.leave': { noteId: string }
  'note.patch': { noteId: string; version: number; patch: unknown }
}

export interface PresenceUser {
  userId: string
  name: string
  color: string
}
