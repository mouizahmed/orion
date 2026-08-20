export interface ServerEventMap {
  'auth.ok': undefined
  'auth.error': { message: string }
  'calendar.sync_status': { syncing: boolean; stale: boolean; last_synced_at?: string }
  'resource.changed': ResourceChangedEvent
  'note.updated': { noteId: string; version: number; patch: unknown }
  'note.presence': { noteId: string; users: PresenceUser[] }
}

export type ResourceName =
  | 'vocabulary'
  | 'calendar_settings'
  | 'calendar_events'
  | 'billing_status'
  | 'extract_fields'

export interface ResourceChangedEvent {
  version: 1
  event_id: string
  resource: ResourceName
  resource_id?: string
  occurred_at: string
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
