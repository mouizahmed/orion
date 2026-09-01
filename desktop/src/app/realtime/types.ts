export interface ServerEventMap {
  'auth.ok': undefined
  'auth.error': { message: string }
  'calendar.sync_status': { syncing: boolean; last_synced_at?: string }
  'resource.changed': ResourceChangedEvent
}

export type ResourceName =
  | 'vocabulary'
  | 'calendar_settings'
  | 'calendar_events'
  | 'billing_status'
  | 'extract_fields'
  | 'email_draft_settings'
  | 'summary_templates'
  | 'notes'
  | 'folders'
  | 'activity'
  | 'chat'

export interface ResourceChangedEvent {
  version: 1
  event_id: string
  resource: ResourceName
  resource_id?: string
  occurred_at: string
}
