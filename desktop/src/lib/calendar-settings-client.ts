import { authenticatedFetch } from '@/lib/auth-session'
import { API_BASE_URL } from '@/lib/api-config'
import type {
  CalendarSettingsSnapshot,
  ConnectedCalendar,
  IntegrationConnection,
} from '@/types/calendar-settings'

export async function getCalendarSettings(signal?: AbortSignal): Promise<CalendarSettingsSnapshot> {
  const headers = { Accept: 'application/json' }
  const [connectionsResponse, calendarsResponse] = await Promise.all([
    authenticatedFetch(`${API_BASE_URL}/integrations/connections`, { headers, signal }),
    authenticatedFetch(`${API_BASE_URL}/calendar/calendars`, { headers, signal }),
  ])

  if (!connectionsResponse.ok) {
    throw new Error(`Failed to fetch calendar accounts: ${connectionsResponse.status}`)
  }
  if (!calendarsResponse.ok) {
    throw new Error(`Failed to fetch calendars: ${calendarsResponse.status}`)
  }

  const [connectionsData, calendarsData] = await Promise.all([
    connectionsResponse.json(),
    calendarsResponse.json(),
  ])

  return {
    connections: connectionsData.status === 'success' && Array.isArray(connectionsData.connections)
      ? connectionsData.connections.filter(
        (connection: IntegrationConnection) => connection.provider === 'google' || connection.provider === 'microsoft',
      )
      : [],
    calendars: calendarsData.status === 'success' && Array.isArray(calendarsData.calendars)
      ? calendarsData.calendars as ConnectedCalendar[]
      : [],
  }
}

export async function updateCalendarVisibility(
  connectionID: string,
  calendarID: string,
  visible: boolean,
): Promise<void> {
  const response = await authenticatedFetch(
    `${API_BASE_URL}/calendar/connections/${encodeURIComponent(connectionID)}/calendars/${encodeURIComponent(calendarID)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ visible }),
    },
  )
  if (!response.ok) throw new Error(`Failed to update calendar visibility: ${response.status}`)
}
