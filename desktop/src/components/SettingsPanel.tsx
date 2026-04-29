import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'

type SettingsPanelProps = {
  onLogout: () => void
  onLogoutEverywhere: () => void
}

type ShortcutAction =
  | 'toggleVisibility'
  | 'focusNotepad'
  | 'toggleNotepad'
  | 'toggleTranscript'
  | 'toggleAsk'
  | 'toggleInsights'
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'

type ShortcutState = {
  current: Record<ShortcutAction, string>
  defaults: Record<ShortcutAction, string>
}

type ShortcutGroup = {
  title: string
  layout?: 'two-column'
  actions: Array<{
    key: ShortcutAction
    label: string
    description: string
  }>
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: 'General',
    actions: [
      {
        key: 'toggleVisibility',
        label: 'Toggle Notepad',
        description: 'Show or hide the notepad from anywhere.',
      },
      {
        key: 'focusNotepad',
        label: 'Focus Notepad',
        description: 'Jump into the meeting notepad, or unfocus it when already typing.',
      },
      {
        key: 'toggleNotepad',
        label: 'Toggle Notepad Panel',
        description: 'Show or hide the meeting notepad panel.',
      },
      {
        key: 'toggleTranscript',
        label: 'Toggle Transcript',
        description: 'Show or hide the live transcript panel.',
      },
      {
        key: 'toggleAsk',
        label: 'Toggle Ask',
        description: 'Show or hide the meeting ask panel.',
      },
      {
        key: 'toggleInsights',
        label: 'Toggle Insights',
        description: 'Show or hide the meeting insights panel.',
      },
    ],
  },
  {
    title: 'Window Position',
    actions: [
      {
        key: 'moveUp',
        label: 'Move Up',
        description: 'Nudge the window upward in 10% increments of the current screen.',
      },
      {
        key: 'moveDown',
        label: 'Move Down',
        description: 'Nudge the window downward in 10% increments of the current screen.',
      },
      {
        key: 'moveLeft',
        label: 'Move Left',
        description: 'Nudge the window left in 10% increments of the current screen.',
      },
      {
        key: 'moveRight',
        label: 'Move Right',
        description: 'Nudge the window right in 10% increments of the current screen.',
      },
    ],
  },
]
const sections = [
  {
    key: 'behaviour',
    title: 'Behaviour',
    actions: [
      { label: 'Launch on Startup', hint: 'Coming soon' },
      { label: 'Global Shortcut', hint: 'Coming soon' },
    ],
  },
  {
    key: 'notifications',
    title: 'Notifications',
    actions: [{ label: 'Desktop Alerts', hint: 'Coming soon' }],
  },
]

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

function getKeyLabel(key: string) {
  if (!key) return ''

  switch (key) {
    case ' ':
    case 'Space':
    case 'Spacebar':
      return 'Space'
    case 'Escape':
      return 'Escape'
    case 'ArrowUp':
      return 'Up'
    case 'ArrowDown':
      return 'Down'
    case 'ArrowLeft':
      return 'Left'
    case 'ArrowRight':
      return 'Right'
    case 'Enter':
      return 'Enter'
    case 'Tab':
      return 'Tab'
    case 'Backspace':
      return 'Backspace'
    case 'Delete':
      return 'Delete'
    default:
      return key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1)
  }
}

function formatShortcut(event: KeyboardEvent) {
  const parts: string[] = []

  if (event.ctrlKey) parts.push('Ctrl')
  if (event.metaKey) parts.push('Cmd')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  const keyLabel = getKeyLabel(event.key)

  if (!keyLabel || MODIFIER_KEYS.has(event.key)) {
    return null
  }

  parts.push(keyLabel)
  return parts.join('+')
}

export default function SettingsPanel({
  onLogout,
  onLogoutEverywhere,
}: SettingsPanelProps) {
  const shortcutApi = typeof window !== 'undefined' ? window.shortcutControl : undefined
  const canManageShortcuts = Boolean(shortcutApi)

  const [shortcutState, setShortcutState] = useState<ShortcutState | null>(null)
  const [isLoadingShortcuts, setIsLoadingShortcuts] = useState(() => canManageShortcuts)
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null)
  const [updatingAction, setUpdatingAction] = useState<ShortcutAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleShortcutUpdate = useCallback(
    async (action: ShortcutAction, value: string | null) => {
      if (!shortcutApi) return
      setUpdatingAction(action)
      try {
        const state = await shortcutApi.update(action, value)
        setShortcutState(state)
        setError(null)
      } catch (updateError) {
        console.error(`Failed to update shortcut for ${action}`, updateError)
        setError(
          updateError instanceof Error
            ? updateError.message
            : 'Failed to update shortcut. Please try again.',
        )
      } finally {
        setUpdatingAction(null)
      }
    },
    [shortcutApi],
  )

  useEffect(() => {
    if (!shortcutApi) return
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
        console.error('Failed to load shortcuts', loadError)
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load shortcuts. Please restart the app.',
        )
      })
      .finally(() => {
        if (isSubscribed) {
          setIsLoadingShortcuts(false)
        }
      })

    return () => {
      isSubscribed = false
    }
  }, [shortcutApi])

  useEffect(() => {
    if (!shortcutApi || !recordingAction) return

    const action = recordingAction

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()

      if (event.key === 'Escape') {
        setRecordingAction(null)
        return
      }

      const formatted = formatShortcut(event)

      if (!formatted) {
        return
      }

      setRecordingAction(null)

      const currentValue = shortcutState?.current?.[action]
      if (currentValue === formatted) {
        return
      }

      void handleShortcutUpdate(action, formatted)
    }

    const handleWindowBlur = () => {
      setRecordingAction(null)
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [shortcutApi, recordingAction, shortcutState, handleShortcutUpdate])

  const handleRecordToggle = useCallback(
    (action: ShortcutAction) => {
      if (!canManageShortcuts || isLoadingShortcuts) return
      if (updatingAction && updatingAction !== action) return
      setError(null)
      setRecordingAction((current) => (current === action ? null : action))
    },
    [canManageShortcuts, isLoadingShortcuts, updatingAction],
  )

  const handleReset = useCallback(
    (action: ShortcutAction) => {
      if (!shortcutState) return
      const currentValue = shortcutState.current[action]
      const defaultValue = shortcutState.defaults[action]
      if (currentValue === defaultValue) return
      setRecordingAction(null)
      void handleShortcutUpdate(action, null)
    },
    [handleShortcutUpdate, shortcutState],
  )

  return (
    <div className="flex w-full select-none flex-col gap-2">
      <div className="relative max-h-[520px] overflow-hidden rounded-2xl border border-neutral-200 bg-white/80 p-1 text-sm text-neutral-700 shadow-sm ring-1 ring-neutral-900/5 backdrop-blur-md before:pointer-events-none before:absolute before:inset-0 before:rounded-2xl before:bg-white/[0.35] dark:border-white/12 dark:bg-[#171417]/80 dark:text-white/80 dark:shadow-none dark:ring-white/8 dark:before:bg-white/[0.02]">
        <div className="attachments-scrollbar relative flex max-h-[512px] flex-col gap-2 overflow-y-auto p-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-neutral-100 text-neutral-700 dark:border-white/15 dark:bg-zinc-900/55 dark:text-zinc-100">
              <Settings className="h-4 w-4" />
            </div>
            <div className="flex min-w-0 flex-col">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Settings</h3>
            </div>
          </div>

          {!canManageShortcuts ? (
            <div className="rounded-full border border-neutral-200 bg-neutral-100 px-4 py-2 text-xs text-neutral-500 dark:border-white/15 dark:bg-zinc-900/55 dark:text-white/60">
              Keybind controls are only available in the desktop app.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {error && (
                <div className="rounded-full border border-red-400/20 bg-red-500/20 px-4 py-2 text-xs text-red-50">
                  {error}
                </div>
              )}

              {isLoadingShortcuts ? (
                <div className="flex h-8 items-center gap-2 rounded-full border border-neutral-200 bg-neutral-100 px-4 text-xs text-neutral-500 dark:border-white/15 dark:bg-zinc-900/55 dark:text-white/60">
                  <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-neutral-400 dark:bg-white/60" />
                  Loading shortcuts...
                </div>
              ) : !shortcutState ? (
                <div className="rounded-full border border-neutral-200 bg-neutral-100 px-4 py-2 text-xs text-neutral-500 dark:border-white/15 dark:bg-zinc-900/55 dark:text-white/60">
                  Shortcuts are not available right now.
                </div>
              ) : (
                <>
                  {shortcutGroups.map((group) => (
                    <div key={group.title} className="flex flex-col gap-1.5">
                      <span className="px-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-neutral-500 dark:text-white/40">
                        {group.title}
                      </span>

                      <div
                        className={
                          group.layout === 'two-column'
                            ? 'grid gap-1.5 sm:grid-cols-2'
                            : 'flex flex-col gap-1.5'
                        }
                      >
                        {group.actions.map((action) => {
                          const currentValue = shortcutState.current[action.key]
                          const defaultValue = shortcutState.defaults[action.key]
                          const isRecording = recordingAction === action.key
                          const isUpdating = updatingAction === action.key
                          const recordButtonDisabled =
                            !canManageShortcuts ||
                            isLoadingShortcuts ||
                            isUpdating ||
                            (recordingAction !== null && !isRecording) ||
                            (updatingAction !== null && !isUpdating)
                          const resetDisabled =
                            !shortcutState ||
                            currentValue === defaultValue ||
                            isUpdating ||
                            Boolean(recordingAction)
                          const displayValue = isRecording
                            ? 'Press new key combination...'
                            : currentValue || 'Not set'

                          return (
                            <div
                              key={action.key}
                              className="flex h-10 items-center gap-1 rounded-full border border-neutral-200 bg-neutral-100 p-1 dark:border-white/15 dark:bg-zinc-900/55"
                            >
                              <div className="flex h-8 min-w-0 flex-1 items-center px-2.5">
                                <div className="truncate text-sm font-semibold text-neutral-900 dark:text-white">
                                  {action.label}
                                </div>
                              </div>

                              <div
                                className={[
                                  'flex h-8 w-[5.9rem] items-center justify-center rounded-full border px-2 font-mono text-[11px] uppercase tracking-wide',
                                  isRecording
                                    ? 'border-neutral-300 bg-white text-neutral-950 dark:border-white/40 dark:bg-zinc-950/70 dark:text-white'
                                    : 'border-neutral-200 bg-white/70 text-neutral-700 dark:border-white/15 dark:bg-zinc-950/55 dark:text-white/80',
                                  isUpdating ? 'opacity-70' : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                <span className="truncate">{displayValue}</span>
                              </div>

                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-8 w-14 rounded-full px-0 py-0 text-xs"
                                disabled={recordButtonDisabled}
                                onClick={() => handleRecordToggle(action.key)}
                              >
                                {isRecording ? 'Cancel' : isUpdating ? 'Saving...' : 'Record'}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 w-12 rounded-full px-0 py-0 text-xs"
                                disabled={resetDisabled}
                                onClick={() => handleReset(action.key)}
                              >
                                Reset
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}

                  <p className="px-1.5 text-[11px] text-neutral-500 dark:text-white/50">
                    Press Escape to cancel while recording. Shortcuts update immediately.
                  </p>
                </>
              )}
            </div>
          )}

          {sections.map(({ key, title, actions }) => (
            <div key={key} className="flex flex-col gap-1.5">
              <span className="px-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-neutral-500 dark:text-white/40">
                {title}
              </span>

              <div className="flex flex-col gap-1.5">
                {actions.map(({ label, hint }) => (
                  <Button
                    key={label}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled
                    className="h-10 justify-between rounded-full px-3 text-sm font-semibold"
                  >
                    {label}
                    {hint && (
                      <span className="ml-2 rounded-full border border-neutral-200 bg-white/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:border-white/10 dark:bg-zinc-950/55 dark:text-white/50">
                        {hint}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-1.5 border-t border-neutral-200 pt-2 text-sm text-neutral-600 dark:border-white/10 dark:text-white/70">
            <Button
              type="button"
              variant="outline"
              className="h-8 min-w-[12rem] flex-1 rounded-full px-2.5 text-xs"
              onClick={onLogout}
            >
              Log out on this device
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-8 min-w-[12rem] flex-1 rounded-full px-2.5 text-xs"
              onClick={onLogoutEverywhere}
            >
              Log out everywhere
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}


