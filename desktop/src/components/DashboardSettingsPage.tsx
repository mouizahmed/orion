import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, CalendarDays, Check, ClipboardList, CreditCard, Download, ExternalLink, FileText, KeyRound, Keyboard, Lock, Mail, MicOff, MonitorCog, Plus, ScanText, ShieldCheck, SpellCheck, User } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SidebarRowButton } from '@/components/ui/sidebar-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DashboardPanel,
  DashboardPanelBody,
  DashboardPanelHeader,
  DashboardPanelTitle,
} from '@/components/ui/dashboard-panel'
import { auth } from '@/config/firebase'
import { useAuth } from '@/contexts/AuthContext'
import { desktopApi, type IntegrationProvider, type RecordingSettings, type ShortcutAction, type ShortcutState } from '@/lib/desktop-api'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'

export type DashboardSettingsSection = 'account' | 'billing' | 'calendar' | 'vocabulary' | 'extracts' | 'emailDraft' | 'summaryTemplates' | 'security' | 'preferences' | 'shortcuts'

type ConnectedCalendar = {
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

type IntegrationConnection = {
  id: string
  provider: 'google' | 'microsoft' | 'notion'
  provider_email?: string
  display_name?: string
  status: 'active' | 'needs_reconnect' | 'disconnected'
  connected_at: string
}

type CalendarIntegrationProvider = Extract<IntegrationProvider, 'google' | 'microsoft'>

type ShortcutGroup = {
  title: string
  actions: Array<{
    key: ShortcutAction
    label: string
  }>
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: 'General',
    actions: [
      { key: 'toggleVisibility', label: 'Toggle Notepad' },
      { key: 'focusNotepad', label: 'Focus Notepad' },
      { key: 'toggleNotepad', label: 'Toggle Notepad Panel' },
      { key: 'toggleTranscript', label: 'Toggle Transcript' },
      { key: 'toggleAsk', label: 'Toggle Ask' },
      { key: 'toggleInsights', label: 'Toggle Insights' },
    ],
  },
  {
    title: 'Window Position',
    actions: [
      { key: 'moveUp', label: 'Move Up' },
      { key: 'moveDown', label: 'Move Down' },
      { key: 'moveLeft', label: 'Move Left' },
      { key: 'moveRight', label: 'Move Right' },
    ],
  },
]

const billingPlans = [
  {
    name: 'Free',
    price: '$0',
    suffix: '/month',
    button: 'Current plan',
    current: true,
    features: [
      '200 minutes / month credits',
      'AI meeting notes and summaries',
      'Extract custom insights with AI',
      'Basic integrations',
    ],
  },
  {
    name: 'Pro',
    price: '$8.33',
    suffix: '/month',
    button: 'Upgrade',
    current: false,
    features: [
      '1500 minutes / month credits',
      'Unlimited live suggestions and coaching',
      'Send pre-readings before meeting',
      'CRM integration',
    ],
  },
]

const calendarProviderOptions: Array<{
  provider: CalendarIntegrationProvider
  label: string
  icon: string
}> = [
  { provider: 'google', label: 'Google Calendar', icon: '/google-calendar-icon.svg' },
  { provider: 'microsoft', label: 'Outlook', icon: '/microsoft-outlook-icon.svg' },
]

function clearCalendarCaches(userID?: string) {
  if (!userID) return
  localStorage.removeItem(`calendar_events_${userID}`)
  window.dispatchEvent(new Event('dashboard-calendar-refresh'))
}

function accountLabel(connection: IntegrationConnection) {
  return connection.provider_email || connection.display_name || `${connection.provider} account`
}

function providerLabel(provider: IntegrationConnection['provider'] | ConnectedCalendar['provider']) {
  switch (provider) {
    case 'google':
      return 'Google Calendar'
    case 'microsoft':
      return 'Microsoft Outlook'
    case 'notion':
      return 'Notion'
    default:
      return provider
  }
}

function calendarProviderIcon(provider: IntegrationConnection['provider'] | ConnectedCalendar['provider']) {
  switch (provider) {
    case 'google':
      return '/google-calendar-icon.svg'
    case 'microsoft':
      return '/microsoft-outlook-icon.svg'
    default:
      return null
  }
}

function isCalendarProvider(provider: IntegrationConnection['provider']): provider is CalendarIntegrationProvider {
  return provider === 'google' || provider === 'microsoft'
}

function groupCalendarsByConnection(calendars: ConnectedCalendar[]) {
  return calendars.reduce<Record<string, ConnectedCalendar[]>>((groups, calendar) => {
    const key = calendar.connection_id
    groups[key] = groups[key] || []
    groups[key].push(calendar)
    return groups
  }, {})
}

const sectionMeta: Record<DashboardSettingsSection, { title: string; icon: typeof User }> = {
  account: { title: 'Account', icon: User },
  billing: { title: 'Billing', icon: CreditCard },
  calendar: { title: 'Calendar', icon: CalendarDays },
  vocabulary: { title: 'Vocabulary', icon: SpellCheck },
  extracts: { title: 'Extracts', icon: ScanText },
  emailDraft: { title: 'Email Draft Templates', icon: Mail },
  summaryTemplates: { title: 'Summary Templates', icon: ClipboardList },
  security: { title: 'Security', icon: ShieldCheck },
  preferences: { title: 'Preferences', icon: MonitorCog },
  shortcuts: { title: 'Shortcuts', icon: Keyboard },
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

function getKeyLabel(key: string) {
  switch (key) {
    case ' ':
    case 'Space':
    case 'Spacebar':
      return 'Space'
    case 'ArrowUp':
      return 'Up'
    case 'ArrowDown':
      return 'Down'
    case 'ArrowLeft':
      return 'Left'
    case 'ArrowRight':
      return 'Right'
    default:
      return key.length === 1 ? key.toUpperCase() : key
  }
}

function formatShortcut(event: KeyboardEvent) {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.metaKey) parts.push('Cmd')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (MODIFIER_KEYS.has(event.key)) return null
  parts.push(getKeyLabel(event.key))
  return parts.join('+')
}

function SettingRow({
  label,
  value,
  action,
}: {
  label: string
  value?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 last:border-b-0 dark:border-white/10">
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">{label}</div>
        {value ? <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{value}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

function ToggleSwitch({
  enabled,
  onClick,
  disabled = false,
  ariaLabel,
}: {
  enabled: boolean
  onClick?: () => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={[
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        enabled ? 'bg-[#7c3aed] dark:bg-[#9f73f2]' : 'bg-neutral-300 dark:bg-white/25',
        disabled ? 'cursor-not-allowed opacity-60' : '',
      ].join(' ')}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <span
        className={[
          'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
          enabled ? 'translate-x-4' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}

function BillingSettingsContent() {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-neutral-200 bg-white/60 px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex min-h-11 items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
              Credits This Month
            </div>
            <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
              Your credit usage resets at the start of each billing cycle
            </div>
          </div>
          <div className="w-48 shrink-0">
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-white/10">
              <div className="h-full w-[97%] rounded-full bg-[#7c3aed] dark:bg-[#9f73f2]" />
            </div>
            <div className="mt-1.5 text-right text-xs text-neutral-500 dark:text-neutral-400">
              194 / 200 minutes remaining
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 pb-1 pl-2">
          <div className="text-xs font-semibold text-neutral-400">Credit History</div>
          <div className="flex items-center gap-1.5">
            <Select defaultValue="2026-04">
              <SelectTrigger
                className="w-28"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="2026-04">2026-04</SelectItem>
                <SelectItem value="2026-03">2026-03</SelectItem>
                <SelectItem value="2026-02">2026-02</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" disabled>
              <Download className="h-3.5 w-3.5" />
              Download
            </Button>
          </div>
        </div>
        <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200 bg-white/60 p-1 sidebar-scrollbar dark:border-white/10 dark:bg-white/[0.03]">
          {[
            ['Meeting', '2026/04/28'],
            ['Meeting', '2026/04/27'],
            ['Meeting', '2026/04/27'],
            ['Meeting', '2026/04/26'],
            ['Meeting', '2026/04/26'],
            ['Meeting', '2026/04/25'],
          ].map(([label, date], index) => (
            <div
              key={`${label}-${date}-${index}`}
              className="flex h-8 min-w-0 items-center gap-2 rounded-full px-2 text-xs text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-white/8 dark:hover:text-white"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-neutral-500 dark:text-neutral-400" />
              <span className="min-w-0 truncate">{label}</span>
              <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{date}</span>
              <span className="ml-auto shrink-0 text-xs font-medium text-red-500 dark:text-red-300">-1 minute</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">Plans</div>
        <div className="grid gap-2 lg:grid-cols-2">
          {billingPlans.map((plan) => (
            <div
              key={plan.name}
              className="flex min-h-56 flex-col rounded-lg border border-neutral-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{plan.name}</div>
                  <div className="mt-2 flex items-end gap-1">
                    <span className="text-2xl font-semibold leading-none text-neutral-950 dark:text-white">
                      {plan.price}
                    </span>
                    <span className="pb-0.5 text-xs text-neutral-500 dark:text-neutral-400">{plan.suffix}</span>
                  </div>
                </div>
                {plan.current ? (
                  <span className="rounded-full border border-neutral-200 bg-neutral-100 px-2 py-1 text-xs font-medium text-neutral-600 dark:border-white/10 dark:bg-white/5 dark:text-neutral-300">
                    Current
                  </span>
                ) : (
                  <div className="flex items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
                    <span>Monthly</span>
                    <ToggleSwitch enabled />
                    <span className="text-neutral-900 dark:text-neutral-100">Yearly</span>
                    <span className="text-[#7c3aed] dark:text-[#9f73f2]">-20%</span>
                  </div>
                )}
              </div>
              <div className="mt-3 space-y-2">
                {plan.features.map((feature, index) => (
                  <div key={feature} className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                    <span
                      className={[
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                        index === 0
                          ? 'bg-[#7c3aed] text-white dark:bg-[#9f73f2]'
                          : 'bg-neutral-100 text-neutral-500 dark:bg-white/8 dark:text-neutral-300',
                      ].join(' ')}
                    >
                      {index === 0 ? <Plus className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                    </span>
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant={plan.current ? 'outline' : 'secondary'}
                size="sm"
                className="mt-auto w-full"
                disabled
              >
                {plan.button}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function DashboardSettingsNav({
  selectedSection,
  onSelectSection,
  onBackToApp,
}: {
  selectedSection: DashboardSettingsSection
  onSelectSection: (section: DashboardSettingsSection) => void
  onBackToApp: () => void
}) {
  return (
    <div className="space-y-1">
      <SidebarRowButton
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={onBackToApp}
      >
        <ArrowLeft size={14} />
        <span>Back to app</span>
      </SidebarRowButton>
      <div className="-mx-1 border-t border-neutral-200 dark:border-white/10" />
      {(Object.keys(sectionMeta) as DashboardSettingsSection[]).map((section) => {
        const Icon = sectionMeta[section].icon
        return (
          <Fragment key={section}>
            {section === 'vocabulary' || section === 'security' ? (
              <div className="my-1 border-t border-neutral-200 dark:border-white/10" />
            ) : null}
            <SidebarRowButton
              active={selectedSection === section}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={() => onSelectSection(section)}
            >
              <Icon size={14} />
              <span>{sectionMeta[section].title}</span>
            </SidebarRowButton>
          </Fragment>
        )
      })}
    </div>
  )
}

export default function DashboardSettingsPage({
  selectedSection,
}: {
  selectedSection: DashboardSettingsSection
}) {
  const { user, logout, updateProfileName, uploadProfileAvatar } = useAuth()
  const shortcutApi = desktopApi.shortcuts
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const canManageShortcuts = shortcutApi.isAvailable()
  const [shortcutState, setShortcutState] = useState<ShortcutState | null>(null)
  const [isLoadingShortcuts, setIsLoadingShortcuts] = useState(false)
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null)
  const [updatingAction, setUpdatingAction] = useState<ShortcutAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [profileImageFailed, setProfileImageFailed] = useState(false)
  const [calendarConnections, setCalendarConnections] = useState<IntegrationConnection[]>([])
  const [connectedCalendars, setConnectedCalendars] = useState<ConnectedCalendar[]>([])
  const [isLoadingCalendars, setIsLoadingCalendars] = useState(false)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [calendarAction, setCalendarAction] = useState<string | null>(null)
  const [profileName, setProfileName] = useState(user?.name || '')
  const [profileAction, setProfileAction] = useState<'name' | 'avatar' | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [recordingSettings, setRecordingSettings] = useState<RecordingSettings>({
    storageLocation: 'server',
    localRecordingsPath: '',
  })
  const displayName = user?.name || user?.email || 'Account'
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'S'

  useEffect(() => {
    setProfileImageFailed(false)
  }, [user?.picture])

  useEffect(() => {
    setProfileName(user?.name || '')
  }, [user?.name])

  const trimmedProfileName = profileName.trim()
  const canSaveProfileName = Boolean(user) && trimmedProfileName !== '' && trimmedProfileName !== (user?.name || '')

  const handleSaveProfileName = useCallback(async () => {
    if (!canSaveProfileName) return
    setProfileAction('name')
    setProfileError(null)
    try {
      await updateProfileName(trimmedProfileName)
    } catch (updateError) {
      setProfileError(updateError instanceof Error ? updateError.message : 'Failed to update profile')
    } finally {
      setProfileAction(null)
    }
  }, [canSaveProfileName, trimmedProfileName, updateProfileName])

  const handleAvatarChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setProfileAction('avatar')
    setProfileError(null)
    try {
      await uploadProfileAvatar(file)
      setProfileImageFailed(false)
    } catch (uploadError) {
      setProfileError(uploadError instanceof Error ? uploadError.message : 'Failed to update avatar')
    } finally {
      setProfileAction(null)
    }
  }, [uploadProfileAvatar])

  const loadCalendarSettings = useCallback(async () => {
    if (!user) return
    setIsLoadingCalendars(true)
    setCalendarError(null)

    try {
      const currentUser = auth.currentUser
      if (!currentUser) throw new Error('Not authenticated')

      const idToken = await currentUser.getIdToken()
      const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      }

      const [connectionsResponse, calendarsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/integrations/connections`, { headers }),
        fetch(`${API_BASE_URL}/calendar/calendars`, { headers }),
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

      setCalendarConnections(
        connectionsData.status === 'success' && Array.isArray(connectionsData.connections)
          ? connectionsData.connections.filter((connection: IntegrationConnection) => isCalendarProvider(connection.provider))
          : [],
      )
      setConnectedCalendars(
        calendarsData.status === 'success' && Array.isArray(calendarsData.calendars)
          ? calendarsData.calendars
          : [],
      )
    } catch (loadError) {
      setCalendarConnections([])
      setConnectedCalendars([])
      setCalendarError(loadError instanceof Error ? loadError.message : 'Failed to load calendar settings')
    } finally {
      setIsLoadingCalendars(false)
    }
  }, [user])

  useEffect(() => {
    if (selectedSection !== 'calendar' || !user) return
    void loadCalendarSettings()
  }, [loadCalendarSettings, selectedSection, user])

  useEffect(() => {
    return desktopApi.integrations.onConnectionCompleted((event) => {
      if (event.provider && event.provider !== 'google' && event.provider !== 'microsoft') return
      if (event.feature && event.feature !== 'calendar') return

      if (!event.success) {
        setCalendarError(event.error || 'Calendar connection failed')
        return
      }

      clearCalendarCaches(user?.id)
      if (selectedSection === 'calendar') {
        void loadCalendarSettings()
      }
    })
  }, [loadCalendarSettings, selectedSection, user?.id])

  useEffect(() => {
    if (selectedSection !== 'security' || !desktopApi.recordingSettings.isAvailable()) return
    let isSubscribed = true
    desktopApi.recordingSettings
      .get()
      .then((settings) => {
        if (isSubscribed) setRecordingSettings(settings)
      })
      .catch((loadError) => {
        console.error('Failed to load recording settings', loadError)
      })
    return () => {
      isSubscribed = false
    }
  }, [selectedSection])

  const updateRecordingSettings = useCallback(async (settings: Partial<RecordingSettings>) => {
    if (!desktopApi.recordingSettings.isAvailable()) {
      setRecordingSettings((current) => ({ ...current, ...settings }))
      return
    }
    try {
      const next = await desktopApi.recordingSettings.update(settings)
      setRecordingSettings(next)
    } catch (updateError) {
      console.error('Failed to update recording settings', updateError)
    }
  }, [])

  const chooseLocalRecordingsPath = useCallback(async () => {
    if (!desktopApi.recordingSettings.isAvailable()) return
    try {
      const next = await desktopApi.recordingSettings.pickLocalPath()
      setRecordingSettings(next)
    } catch (updateError) {
      console.error('Failed to choose recordings folder', updateError)
    }
  }, [])

  const handleConnectCalendar = useCallback(async (provider: CalendarIntegrationProvider) => {
    const currentUser = auth.currentUser
    if (!currentUser) {
      setCalendarError('Not authenticated')
      return
    }

    setCalendarAction(`connect:${provider}`)
    setCalendarError(null)
    try {
      const idToken = await currentUser.getIdToken()
      const result = await desktopApi.integrations.connect(provider, 'calendar', idToken)
      if (!result.success) {
        throw new Error(result.error)
      }
      clearCalendarCaches(user?.id)
      void loadCalendarSettings()
    } catch (connectError) {
      setCalendarError(connectError instanceof Error ? connectError.message : 'Failed to connect calendar')
    } finally {
      setCalendarAction(null)
    }
  }, [loadCalendarSettings, user?.id])

  const handleDisconnectCalendar = useCallback(
    async (connectionID: string) => {
      const currentUser = auth.currentUser
      if (!currentUser) {
        setCalendarError('Not authenticated')
        return
      }

      setCalendarAction(`disconnect:${connectionID}`)
      setCalendarError(null)
      try {
        const idToken = await currentUser.getIdToken()
        const result = await desktopApi.integrations.disconnect(connectionID, idToken)
        if (!result.success) {
          throw new Error(result.error)
        }
        clearCalendarCaches(user?.id)
        await loadCalendarSettings()
      } catch (disconnectError) {
        setCalendarError(disconnectError instanceof Error ? disconnectError.message : 'Failed to disconnect calendar')
      } finally {
        setCalendarAction(null)
      }
    },
    [loadCalendarSettings, user?.id],
  )

  const handleCalendarVisibility = useCallback(
    async (calendar: ConnectedCalendar, visible: boolean) => {
      const currentUser = auth.currentUser
      if (!currentUser) {
        setCalendarError('Not authenticated')
        return
      }

      const actionKey = `toggle:${calendar.connection_id}:${calendar.id}`
      setCalendarAction(actionKey)
      setCalendarError(null)
      setConnectedCalendars((current) =>
        current.map((item) =>
          item.connection_id === calendar.connection_id && item.id === calendar.id
            ? { ...item, visible }
            : item,
        ),
      )

      try {
        const idToken = await currentUser.getIdToken()
        const response = await fetch(
          `${API_BASE_URL}/calendar/connections/${encodeURIComponent(calendar.connection_id)}/calendars/${encodeURIComponent(calendar.id)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ visible }),
          },
        )
        if (!response.ok) {
          throw new Error(`Failed to update calendar visibility: ${response.status}`)
        }
        clearCalendarCaches(user?.id)
      } catch (visibilityError) {
        setConnectedCalendars((current) =>
          current.map((item) =>
            item.connection_id === calendar.connection_id && item.id === calendar.id
              ? { ...item, visible: calendar.visible }
              : item,
          ),
        )
        setCalendarError(visibilityError instanceof Error ? visibilityError.message : 'Failed to update calendar')
      } finally {
        setCalendarAction(null)
      }
    },
    [user?.id],
  )

  const handleShortcutUpdate = useCallback(
    async (action: ShortcutAction, value: string | null) => {
      if (!canManageShortcuts) return
      setUpdatingAction(action)
      try {
        const state = await shortcutApi.update(action, value)
        setShortcutState(state)
        setError(null)
      } catch (updateError) {
        setError(updateError instanceof Error ? updateError.message : 'Failed to update shortcut')
      } finally {
        setUpdatingAction(null)
      }
    },
    [canManageShortcuts, shortcutApi],
  )

  useEffect(() => {
    if (!canManageShortcuts || selectedSection !== 'shortcuts') return
    let isSubscribed = true
    setIsLoadingShortcuts(true)
    shortcutApi
      .getAll()
      .then((state) => {
        if (!isSubscribed) return
        setShortcutState(state)
        setError(null)
      })
      .catch((loadError) => {
        if (!isSubscribed) return
        setError(loadError instanceof Error ? loadError.message : 'Failed to load shortcuts')
      })
      .finally(() => {
        if (isSubscribed) setIsLoadingShortcuts(false)
      })
    return () => {
      isSubscribed = false
    }
  }, [canManageShortcuts, selectedSection, shortcutApi])

  useEffect(() => {
    if (!canManageShortcuts || !recordingAction) return
    const action = recordingAction

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      if (event.key === 'Escape') {
        setRecordingAction(null)
        return
      }
      const formatted = formatShortcut(event)
      if (!formatted) return
      setRecordingAction(null)
      if (shortcutState?.current[action] === formatted) return
      void handleShortcutUpdate(action, formatted)
    }

    const handleWindowBlur = () => setRecordingAction(null)

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [canManageShortcuts, handleShortcutUpdate, recordingAction, shortcutState])

  const calendarsByConnection = groupCalendarsByConnection(connectedCalendars)
  const title = sectionMeta[selectedSection].title

  return (
    <DashboardPanel className="flex h-full min-h-0 flex-col">
      <DashboardPanelHeader className="px-2.5 py-2">
        <div className="flex h-8 w-full items-center">
          <DashboardPanelTitle>{title}</DashboardPanelTitle>
        </div>
      </DashboardPanelHeader>
      <DashboardPanelBody className="min-h-0 flex-1 overflow-y-auto">
        {selectedSection === 'account' ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex items-center gap-3 border-b border-neutral-200 px-3 py-3 dark:border-white/10">
                <div className="shrink-0">
                  {user?.picture && !profileImageFailed ? (
                    <img
                      src={user.picture}
                      alt=""
                      className="h-12 w-12 rounded-full object-cover"
                      draggable={false}
                      referrerPolicy="no-referrer"
                      onError={() => setProfileImageFailed(true)}
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-200 text-sm font-semibold text-neutral-700 dark:bg-white/10 dark:text-white">
                      {initials}
                    </div>
                  )}
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    className="hidden"
                    onChange={handleAvatarChange}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{displayName}</div>
                  <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{user?.email || 'Not signed in'}</div>
                  {profileError ? (
                    <div className="mt-1 truncate text-xs text-red-600 dark:text-red-300">{profileError}</div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!user || profileAction === 'avatar'}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {profileAction === 'avatar' ? 'Saving' : 'Change photo'}
                </Button>
              </div>
              <SettingRow
                label="Name"
                action={
                  <div className="flex w-[320px] max-w-[45vw] items-center gap-2">
                    <Input
                      value={profileName}
                      disabled={!user || profileAction === 'name'}
                      maxLength={120}
                      onChange={(event) => setProfileName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void handleSaveProfileName()
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canSaveProfileName || profileAction === 'name'}
                      onClick={() => void handleSaveProfileName()}
                    >
                      {profileAction === 'name' ? 'Saving' : 'Save'}
                    </Button>
                  </div>
                }
              />
              <SettingRow label="Email" value={user?.email || 'Not signed in'} />
              <SettingRow
                label="Session"
                value="Manage sign-in on this device."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={logout}>
                    Log out
                  </Button>
                }
              />
            </div>

            <div className="overflow-hidden rounded-lg border border-red-500/25 bg-red-50/70 dark:border-red-400/20 dark:bg-red-950/20">
              <SettingRow
                label="Delete account"
                value="Permanently delete your account and all synced data."
                action={
                  <Button type="button" variant="destructive" size="sm" disabled>
                    Coming soon
                  </Button>
                }
              />
            </div>
          </div>
        ) : null}

        {selectedSection === 'billing' ? <BillingSettingsContent /> : null}

        {selectedSection === 'shortcuts' ? (
          <div className="space-y-3">
            {!canManageShortcuts ? (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-400">
                Keybind controls are only available in the desktop app.
              </div>
            ) : error ? (
              <div className="rounded-lg border border-red-500/30 bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-200">
                {error}
              </div>
            ) : null}

            {isLoadingShortcuts ? (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-400">
                Loading shortcuts...
              </div>
            ) : shortcutState ? (
              shortcutGroups.map((group) => (
                <div key={group.title}>
                  <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">{group.title}</div>
                  <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                    {group.actions.map((action) => {
                      const currentValue = shortcutState.current[action.key]
                      const defaultValue = shortcutState.defaults[action.key]
                      const isRecording = recordingAction === action.key
                      const isUpdating = updatingAction === action.key
                      return (
                        <SettingRow
                          key={action.key}
                          label={action.label}
                          value={isRecording ? 'Press a new key combination...' : currentValue || 'Not set'}
                          action={
                            <div className="flex gap-1.5">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={isUpdating || (recordingAction !== null && !isRecording)}
                                onClick={() => setRecordingAction((current) => (current === action.key ? null : action.key))}
                              >
                                {isRecording ? 'Cancel' : isUpdating ? 'Saving...' : 'Record'}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isUpdating || Boolean(recordingAction) || currentValue === defaultValue}
                                onClick={() => void handleShortcutUpdate(action.key, null)}
                              >
                                Reset
                              </Button>
                            </div>
                          }
                        />
                      )
                    })}
                  </div>
                </div>
              ))
            ) : null}
            {shortcutState ? (
              <p className="px-2 text-xs text-neutral-500 dark:text-neutral-400">
                Press Escape to cancel while recording. Shortcuts update immediately.
              </p>
            ) : null}
          </div>
        ) : null}

        {selectedSection === 'calendar' ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Calendar accounts</div>
                <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
                  <Select
                    value=""
                    disabled={Boolean(calendarAction)}
                    onValueChange={(value) => void handleConnectCalendar(value as CalendarIntegrationProvider)}
                  >
                    <SelectTrigger size="sm">
                      <Plus className="h-3.5 w-3.5" />
                      <SelectValue placeholder="Add" />
                    </SelectTrigger>
                    <SelectContent align="end">
                      {calendarProviderOptions.map((option) => (
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
              {isLoadingCalendars ? (
                <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">Loading accounts...</div>
              ) : calendarConnections.length > 0 ? (
                calendarConnections.map((connection) => {
                  const isDisconnecting = calendarAction === `disconnect:${connection.id}`
                  const providerIcon = calendarProviderIcon(connection.provider)
                  return (
                    <div
                      key={connection.id}
                      className="flex min-h-14 items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 last:border-b-0 dark:border-white/10"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {providerIcon ? (
                          <img
                            src={providerIcon}
                            alt=""
                            aria-hidden="true"
                            className="h-5 w-5 shrink-0"
                          />
                        ) : null}
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                            {providerLabel(connection.provider)}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                            {accountLabel(connection)}
                          </div>
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(calendarAction)}
                        className="border-red-500/25 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-400/20 dark:text-red-300 dark:hover:bg-red-500/10 dark:hover:text-red-200"
                        onClick={() => void handleDisconnectCalendar(connection.id)}
                      >
                        {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
                      </Button>
                    </div>
                  )
                })
              ) : (
                <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">No calendar accounts connected.</div>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
                <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Visible calendars</div>
                <button
                  type="button"
                  className="text-xs font-medium text-[#7c3aed] hover:text-[#6d28d9] dark:text-[#9f73f2] dark:hover:text-[#b79df7]"
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                  onClick={() => void loadCalendarSettings()}
                >
                  Refresh
                </button>
              </div>
              {isLoadingCalendars ? (
                <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">Loading calendars...</div>
              ) : calendarError ? (
                <div className="px-3 py-4 text-xs text-red-600 dark:text-red-300">{calendarError}</div>
              ) : connectedCalendars.length > 0 && calendarConnections.length > 0 ? (
                calendarConnections.map((connection) => {
                  const calendars = calendarsByConnection[connection.id] || []
                  if (calendars.length === 0) return null
                  return (
                    <div key={connection.id} className="border-b border-neutral-200 last:border-b-0 dark:border-white/10">
                      <div className="bg-neutral-50/80 px-3 py-2 text-xs font-medium text-neutral-500 dark:bg-white/[0.03] dark:text-neutral-400">
                        {accountLabel(connection)}
                      </div>
                      {calendars.map((calendar) => {
                        const actionKey = `toggle:${calendar.connection_id}:${calendar.id}`
                        return (
                          <div
                            key={`${calendar.connection_id}-${calendar.id}`}
                            className="flex min-h-12 items-center justify-between gap-3 px-3 py-2"
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <span
                                className="h-3 w-3 shrink-0 rounded-sm bg-neutral-300 dark:bg-white/25"
                                style={
                                  calendar.color || calendar.background_color
                                    ? { backgroundColor: calendar.color || calendar.background_color }
                                    : undefined
                                }
                              />
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                                  {calendar.name || calendar.id}
                                </div>
                                <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                                  {providerLabel(calendar.provider)}
                                </div>
                              </div>
                            </div>
                            <ToggleSwitch
                              enabled={calendar.visible}
                              disabled={calendarAction === actionKey}
                              ariaLabel={`${calendar.visible ? 'Hide' : 'Show'} ${calendar.name || calendar.id}`}
                              onClick={() => void handleCalendarVisibility(calendar, !calendar.visible)}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              ) : (
                <div className="px-3 py-4 text-xs text-neutral-500 dark:text-neutral-400">Connect a calendar account to choose visible calendars.</div>
              )}
            </div>
          </div>
        ) : null}

        {selectedSection === 'vocabulary' ? (
          <div className="space-y-2">
            <div className="px-2">
              <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Custom vocabulary</div>
              <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Define key terms or product names. Orionly will transcribe them more accurately.
              </div>
            </div>
            <div className="relative">
              <textarea
                placeholder="e.g. Orionly, Salesforce, BANT, SPICED, ..."
                maxLength={350}
                className="min-h-24 w-full resize-none rounded-lg border border-neutral-200 bg-white/60 px-3 py-3 pr-24 text-xs text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-300 focus:ring-2 focus:ring-neutral-900/10 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-white/20 dark:focus:ring-white/10"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              />
              <div className="absolute bottom-3 right-3 text-xs text-neutral-400 dark:text-neutral-500">
                0 / 350 chars
              </div>
            </div>
          </div>
        ) : null}

        {selectedSection === 'extracts' ? (
          <div className="space-y-3">
            <div className="px-2">
              <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Fields</div>
              <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Define fields to automatically extract insights from your meetings.
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="h-12 w-full justify-start rounded-lg px-3 text-sm font-semibold"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Plus className="h-4 w-4" />
              Add new field
            </Button>
          </div>
        ) : null}

        {selectedSection === 'emailDraft' ? (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
              <SettingRow
                label="Enable email draft"
                value="Automatically draft follow-up emails after meetings."
                action={<ToggleSwitch enabled />}
              />
              <SettingRow
                label="Save draft in Gmail"
                value="Save the draft email in your Gmail account."
                action={
                  <Button type="button" variant="outline" size="sm">
                    <span className="font-semibold text-[#4285f4]">G</span>
                    Connect
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                }
              />
            </div>

            <div className="space-y-3">
              <div className="px-2">
                <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Templates</div>
                <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Define how follow-up emails should be generated with custom prompts.
                </div>
              </div>
              <Button
                type="button"
                variant="secondary"
                className="h-12 w-full justify-start rounded-lg px-3 text-sm font-semibold"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <Plus className="h-4 w-4" />
                Add new template
              </Button>

            </div>

            <div>
              <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">Options</div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                <SettingRow
                  label="Include sharing link in the email body"
                  value="e.g. You can review the full meeting notes here: https://orionly.so/m/..."
                  action={<ToggleSwitch enabled />}
                />
              </div>
            </div>
          </div>
        ) : null}

        {selectedSection === 'summaryTemplates' ? (
          <div className="space-y-3">
            <div className="px-2">
              <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Templates</div>
              <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                Define how meeting summaries should be generated with custom prompts.
              </div>
            </div>
            <Button
              type="button"
              variant="secondary"
              className="h-12 w-full justify-start rounded-lg px-3 text-sm font-semibold"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <Plus className="h-4 w-4" />
              Add new template
            </Button>
          </div>
        ) : null}

        {selectedSection === 'security' ? (
          <div className="space-y-5">
            <div className="grid gap-2 lg:grid-cols-3">
              {[
                {
                  icon: Lock,
                  title: 'No AI training with your data',
                  body: 'We block model providers from using your data to train AI models.',
                },
                {
                  icon: MicOff,
                  title: 'Your audio data is in your control',
                  body: 'Choose where to store audio recordings. You can opt out of server uploads.',
                },
                {
                  icon: KeyRound,
                  title: 'End-to-end encryption',
                  body: 'AES-256 encryption protects your data to keep sensitive information secure.',
                },
              ].map((item) => {
                const Icon = item.icon
                return (
                  <div
                    key={item.title}
                    className="rounded-lg border border-neutral-200 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]"
                  >
                    <Icon className="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
                    <div className="mt-5 text-xs font-semibold text-neutral-900 dark:text-neutral-100">{item.title}</div>
                    <div className="mt-1 text-xs leading-4 text-neutral-500 dark:text-neutral-400">{item.body}</div>
                  </div>
                )
              })}
            </div>

            <div>
              <div className="px-2 pb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Meeting permissions</div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                <SettingRow
                  label="Default permission for new meetings"
                  value="Choose who can access meetings by default"
                  action={
                    <Select defaultValue="only-me">
                      <SelectTrigger
                        className="w-40"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="only-me">Only me</SelectItem>
                        <SelectItem value="link">Anyone with the link</SelectItem>
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingRow
                  label="Change permission to 'Anyone with the link' when sharing meetings"
                  value="Automatically changes permission when copying share link or composing follow-up emails"
                  action={<ToggleSwitch enabled />}
                />
              </div>
            </div>

            <div>
              <div className="px-2 pb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Audio recording</div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                <SettingRow
                  label="Record audio"
                  value="Enable audio recording for meetings"
                  action={<ToggleSwitch enabled />}
                />
                <SettingRow
                  label="Storage location"
                  value="Where to store recorded audio"
                  action={
                    <Select
                      value={recordingSettings.storageLocation}
                      onValueChange={(value) => {
                        void updateRecordingSettings({
                          storageLocation: value === 'local' ? 'local' : 'server',
                        })
                      }}
                    >
                      <SelectTrigger
                        className="w-40"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="server">Orionly server</SelectItem>
                        <SelectItem value="local">Local only</SelectItem>
                      </SelectContent>
                    </Select>
                  }
                />
                {recordingSettings.storageLocation === 'local' ? (
                  <SettingRow
                    label="Save recordings to"
                    value={recordingSettings.localRecordingsPath || 'No folder selected'}
                    action={
                      <Button type="button" variant="outline" size="sm" onClick={() => void chooseLocalRecordingsPath()}>
                        Choose folder
                      </Button>
                    }
                  />
                ) : null}
              </div>
            </div>

            <div>
              <div className="px-2 pb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Data retention</div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                <SettingRow
                  label="Auto-delete meetings after"
                  value="Automatically archive old meetings"
                  action={
                    <Select defaultValue="never">
                      <SelectTrigger
                        className="w-40"
                        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="never">Never</SelectItem>
                        <SelectItem value="30">30 days</SelectItem>
                        <SelectItem value="90">90 days</SelectItem>
                        <SelectItem value="365">1 year</SelectItem>
                      </SelectContent>
                    </Select>
                  }
                />
              </div>
            </div>
          </div>
        ) : null}

        {selectedSection === 'preferences' ? (
          <div className="space-y-3">
            <div>
              <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">Meeting notifications</div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                <div className="flex min-h-14 items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      Remind me before meetings
                    </div>
                    <div className="mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400">
                      Send notifications before the calendar event starts.
                    </div>
                  </div>
                  <Select defaultValue="5m">
                    <SelectTrigger
                      className="w-40 shrink-0"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="none">Don&apos;t notify me</SelectItem>
                      <SelectItem value="1m">Before 1m</SelectItem>
                      <SelectItem value="5m">Before 5m</SelectItem>
                      <SelectItem value="10m">Before 10m</SelectItem>
                      <SelectItem value="15m">Before 15m</SelectItem>
                      <SelectItem value="30m">Before 30m</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex min-h-14 items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                      Auto-detected meetings
                    </div>
                    <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                      Show notifications when a call is detected. You can mute specific apps below.
                    </div>
                  </div>
                  <ToggleSwitch enabled />
                </div>
              </div>
            </div>
            <div>
              <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">Behavior</div>
              <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
                <SettingRow
                  label="Launch on Startup"
                  value="This will launch Orionly automatically when your system starts."
                  action={<ToggleSwitch enabled />}
                />
              </div>
            </div>
          </div>
        ) : null}
      </DashboardPanelBody>
    </DashboardPanel>
  )
}
