import { useCallback, useMemo, useState } from 'react'
import { ExternalLink, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleSwitch } from '@/features/settings/components/SettingsPrimitives'
import { useAuth } from '@/features/auth/AuthContext'
import { useCalendarConnectionMutations, useCalendarSettingsQuery, useCalendarVisibilityMutation } from '@/features/calendar/useCalendarSettingsQuery'
import { publicAssetUrl } from '@/lib/public-asset'
import type { IntegrationProvider } from '@/lib/desktop-api'
import type { ConnectedCalendar, IntegrationConnection } from '@/features/calendar/types'

type CalendarProvider = Extract<IntegrationProvider, 'google' | 'microsoft'>

const providerOptions: Array<{ provider: CalendarProvider; label: string; icon: string }> = [
  { provider: 'google', label: 'Google Calendar', icon: publicAssetUrl('google-calendar-icon.svg') },
  { provider: 'microsoft', label: 'Outlook', icon: publicAssetUrl('microsoft-outlook-icon.svg') },
]
const emptyCalendars: ConnectedCalendar[] = []

function accountLabel(connection: IntegrationConnection) {
  return connection.provider_email || connection.display_name || `${connection.provider} account`
}

function providerLabel(provider: IntegrationConnection['provider'] | ConnectedCalendar['provider']) {
  if (provider === 'google') return 'Google Calendar'
  if (provider === 'microsoft') return 'Microsoft Outlook'
  return provider
}

function providerIcon(provider: IntegrationConnection['provider'] | ConnectedCalendar['provider']) {
  if (provider === 'google') return publicAssetUrl('google-calendar-icon.svg')
  if (provider === 'microsoft') return publicAssetUrl('microsoft-outlook-icon.svg')
  return null
}

export function CalendarSettings() {
  const { user } = useAuth()
  const [action, setAction] = useState<string | null>(null)
  const query = useCalendarSettingsQuery(user?.id, true)
  const visibilityMutation = useCalendarVisibilityMutation(user?.id)
  const { connect, disconnect } = useCalendarConnectionMutations(user?.id, (message) => toast.error(message))
  const connections = query.data?.connections ?? []
  const calendars = query.data?.calendars ?? emptyCalendars
  const error = query.error instanceof Error ? query.error.message : null
  const calendarsByConnection = useMemo(() => calendars.reduce<Record<string, ConnectedCalendar[]>>((groups, calendar) => {
    groups[calendar.connection_id] = groups[calendar.connection_id] || []
    groups[calendar.connection_id].push(calendar)
    return groups
  }, {}), [calendars])

  const connectProvider = useCallback(async (provider: CalendarProvider) => {
    if (!user) return toast.error('Not authenticated')
    setAction(`connect:${provider}`)
    try {
      await connect.mutateAsync(provider)
    } catch (connectError) {
      toast.error(connectError instanceof Error ? connectError.message : 'Failed to connect calendar')
    } finally {
      setAction(null)
    }
  }, [connect, user])

  const disconnectConnection = useCallback(async (connectionID: string) => {
    if (!user) return toast.error('Not authenticated')
    setAction(`disconnect:${connectionID}`)
    try {
      await disconnect.mutateAsync(connectionID)
    } catch (disconnectError) {
      toast.error(disconnectError instanceof Error ? disconnectError.message : 'Failed to disconnect calendar')
    } finally {
      setAction(null)
    }
  }, [disconnect, user])

  const setVisibility = useCallback(async (calendar: ConnectedCalendar, visible: boolean) => {
    if (!user) return toast.error('Not authenticated')
    const actionKey = `toggle:${calendar.connection_id}:${calendar.id}`
    setAction(actionKey)
    try {
      await visibilityMutation.mutateAsync({ calendar, visible })
    } catch (visibilityError) {
      toast.error(visibilityError instanceof Error ? visibilityError.message : 'Failed to update calendar')
    } finally {
      setAction(null)
    }
  }, [user, visibilityMutation])

  return (
    <div className="space-y-3">
      {error && query.data ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
          <span>Calendar settings could not be refreshed. Showing the last available data.</span>
          <button type="button" className="shrink-0 font-medium underline-offset-2 hover:underline" onClick={() => void query.refetch()}>Retry</button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
          <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Calendar accounts</div>
          <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <Select value="" disabled={Boolean(action)} onValueChange={(value) => void connectProvider(value as CalendarProvider)}>
              <SelectTrigger size="sm"><Plus className="h-3.5 w-3.5" /><SelectValue placeholder="Add" /></SelectTrigger>
              <SelectContent align="start">
                {providerOptions.map((option) => (
                  <SelectItem key={option.provider} value={option.provider}>
                    <img src={option.icon} alt="" aria-hidden="true" className="h-4 w-4 shrink-0" />
                    {option.label}
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {connections.length > 0 ? connections.map((connection) => {
          const isDisconnecting = action === `disconnect:${connection.id}`
          const needsReconnect = connection.status === 'needs_reconnect'
          const isReconnecting = action === `connect:${connection.provider}`
          const icon = providerIcon(connection.provider)
          return (
            <div key={connection.id} className="flex min-h-14 items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 last:border-b-0 dark:border-white/10">
              <div className="flex min-w-0 items-center gap-3">
                {icon ? <img src={icon} alt="" aria-hidden="true" className="h-5 w-5 shrink-0" /> : null}
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">{providerLabel(connection.provider)}</div>
                  <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{accountLabel(connection)}</div>
                  {needsReconnect ? <div className="mt-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">Authorization required</div> : null}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {needsReconnect ? (
                  <Button type="button" variant="secondary" size="sm" disabled={Boolean(action)} onClick={() => void connectProvider(connection.provider)}>
                    {isReconnecting ? 'Reconnecting...' : 'Reconnect'}
                  </Button>
                ) : null}
                <Button type="button" variant="outline" size="sm" disabled={Boolean(action)} className="border-red-500/25 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-400/20 dark:text-red-300 dark:hover:bg-red-500/10 dark:hover:text-red-200" onClick={() => void disconnectConnection(connection.id)}>
                  {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                </Button>
              </div>
            </div>
          )
        }) : query.isPending ? (
          <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">Loading accounts...</div>
        ) : error ? (
          <div className="flex items-center justify-between gap-3 px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">
            <span>Calendar settings are unavailable.</span>
            <button type="button" className="font-medium text-[#7c3aed] hover:text-[#6d28d9] dark:text-[#9f73f2] dark:hover:text-[#b79df7]" onClick={() => void query.refetch()}>Retry</button>
          </div>
        ) : <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">No calendar accounts connected.</div>}
      </div>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
          <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Visible calendars</div>
          <button type="button" className="text-xs font-medium text-[#7c3aed] hover:text-[#6d28d9] dark:text-[#9f73f2] dark:hover:text-[#b79df7]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} onClick={() => void query.refetch()}>Refresh</button>
        </div>
        {calendars.length > 0 && connections.length > 0 ? connections.map((connection) => {
          const connectionCalendars = calendarsByConnection[connection.id] || []
          if (connectionCalendars.length === 0) return null
          return (
            <div key={connection.id} className="border-b border-neutral-200 last:border-b-0 dark:border-white/10">
              <div className="bg-neutral-50/80 px-3 py-2 text-xs font-medium text-neutral-500 dark:bg-white/[0.03] dark:text-neutral-400">{accountLabel(connection)}</div>
              {connectionCalendars.map((calendar) => {
                const actionKey = `toggle:${calendar.connection_id}:${calendar.id}`
                return (
                  <div key={`${calendar.connection_id}-${calendar.id}`} className="flex min-h-12 items-center justify-between gap-3 px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="h-3 w-3 shrink-0 rounded-sm bg-neutral-300 dark:bg-white/25" style={calendar.color || calendar.background_color ? { backgroundColor: calendar.color || calendar.background_color } : undefined} />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">{calendar.name || calendar.id}</div>
                        <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{providerLabel(calendar.provider)}</div>
                      </div>
                    </div>
                    <ToggleSwitch enabled={calendar.visible} disabled={action === actionKey} ariaLabel={`${calendar.visible ? 'Hide' : 'Show'} ${calendar.name || calendar.id}`} onClick={() => void setVisibility(calendar, !calendar.visible)} />
                  </div>
                )
              })}
            </div>
          )
        }) : query.isPending ? <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">Loading calendars...</div> : <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">Connect a calendar account to choose visible calendars.</div>}
      </div>
    </div>
  )
}
