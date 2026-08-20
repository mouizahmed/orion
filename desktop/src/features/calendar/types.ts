export type ConnectedCalendar = {
  id: string
  connection_id: string
  account_email?: string
  name: string
  provider: string
  color?: string
  background_color?: string
  foreground_color?: string
  primary: boolean
  selected: boolean
  visible: boolean
  access_role?: string
}

export type IntegrationConnection = {
  id: string
  provider: 'google' | 'microsoft'
  provider_email?: string
  display_name?: string
  status: 'active' | 'needs_reconnect' | 'disconnected'
  connected_at: string
}

export type CalendarSettingsSnapshot = {
  connections: IntegrationConnection[]
  calendars: ConnectedCalendar[]
}
