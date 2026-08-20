import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { desktopApi, type ShortcutAction, type ShortcutState } from '@/lib/desktop-api'
import { SettingRow } from '@/features/settings/components/SettingsPrimitives'

const groups: Array<{ title: string; actions: Array<{ key: ShortcutAction; label: string }> }> = [
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

const modifierKeys = new Set(['Control', 'Shift', 'Alt', 'Meta'])

function keyLabel(key: string) {
  if (key === ' ' || key === 'Space' || key === 'Spacebar') return 'Space'
  if (key.startsWith('Arrow')) return key.slice(5)
  return key.length === 1 ? key.toUpperCase() : key
}

function formatShortcut(event: KeyboardEvent) {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.metaKey) parts.push('Cmd')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (modifierKeys.has(event.key)) return null
  parts.push(keyLabel(event.key))
  return parts.join('+')
}

export function ShortcutsSettings() {
  const shortcutApi = desktopApi.shortcuts
  const available = shortcutApi.isAvailable()
  const [state, setState] = useState<ShortcutState | null>(null)
  const [loading, setLoading] = useState(false)
  const [recordingAction, setRecordingAction] = useState<ShortcutAction | null>(null)
  const [updatingAction, setUpdatingAction] = useState<ShortcutAction | null>(null)

  const updateShortcut = useCallback(async (action: ShortcutAction, value: string | null) => {
    if (!available) return
    setUpdatingAction(action)
    try {
      setState(await shortcutApi.update(action, value))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update shortcut')
    } finally {
      setUpdatingAction(null)
    }
  }, [available, shortcutApi])

  useEffect(() => {
    if (!available) return
    let subscribed = true
    setLoading(true)
    shortcutApi.getAll()
      .then((next) => { if (subscribed) setState(next) })
      .catch((error) => { if (subscribed) console.error('Failed to load shortcuts', error) })
      .finally(() => { if (subscribed) setLoading(false) })
    return () => { subscribed = false }
  }, [available, shortcutApi])

  useEffect(() => {
    if (!available || !recordingAction) return
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
      if (state?.current[action] !== formatted) void updateShortcut(action, formatted)
    }
    const handleBlur = () => setRecordingAction(null)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [available, recordingAction, state, updateShortcut])

  return (
    <div className="space-y-3">
      {!available ? <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-400">Keybind controls are only available in the desktop app.</div> : null}
      {loading ? <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-neutral-400">Loading shortcuts...</div> : state ? (
        groups.map((group) => (
          <div key={group.title}>
            <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">{group.title}</div>
            <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
              {group.actions.map((action) => {
                const currentValue = state.current[action.key]
                const isRecording = recordingAction === action.key
                const isUpdating = updatingAction === action.key
                return (
                  <SettingRow
                    key={action.key}
                    label={action.label}
                    value={isRecording ? 'Press a new key combination...' : currentValue || 'Not set'}
                    action={
                      <div className="flex gap-1.5">
                        <Button type="button" variant="secondary" size="sm" disabled={isUpdating || (recordingAction !== null && !isRecording)} onClick={() => setRecordingAction((current) => current === action.key ? null : action.key)}>
                          {isRecording ? 'Cancel' : isUpdating ? 'Saving...' : 'Record'}
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={isUpdating || Boolean(recordingAction) || currentValue === state.defaults[action.key]} onClick={() => void updateShortcut(action.key, null)}>Reset</Button>
                      </div>
                    }
                  />
                )
              })}
            </div>
          </div>
        ))
      ) : null}
      {state ? <p className="px-2 text-xs text-neutral-500 dark:text-neutral-400">Press Escape to cancel while recording. Shortcuts update immediately.</p> : null}
    </div>
  )
}
