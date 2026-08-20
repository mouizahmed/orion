import { useCallback, useEffect, useState } from 'react'

import { desktopApi, type RecordingSettings } from '@/lib/desktop-api'
import { PreferencesSettings as PreferencesSettingsView } from './StaticSettings'

export function PreferencesSettings() {
  const [settings, setSettings] = useState<RecordingSettings>({ storageLocation: 'server', localRecordingsPath: '' })

  useEffect(() => {
    if (!desktopApi.recordingSettings.isAvailable()) return
    let subscribed = true
    desktopApi.recordingSettings.get().then((next) => {
      if (subscribed) setSettings(next)
    }).catch((error) => console.error('Failed to load recording settings', error))
    return () => { subscribed = false }
  }, [])

  const updateSettings = useCallback(async (changes: Partial<RecordingSettings>) => {
    if (!desktopApi.recordingSettings.isAvailable()) {
      setSettings((current) => ({ ...current, ...changes }))
      return
    }
    try {
      setSettings(await desktopApi.recordingSettings.update(changes))
    } catch (error) {
      console.error('Failed to update recording settings', error)
    }
  }, [])

  const chooseLocalRecordingsPath = useCallback(async () => {
    if (!desktopApi.recordingSettings.isAvailable()) return
    try {
      setSettings(await desktopApi.recordingSettings.pickLocalPath())
    } catch (error) {
      console.error('Failed to choose recordings folder', error)
    }
  }, [])

  return <PreferencesSettingsView recordingSettings={settings} updateRecordingSettings={updateSettings} chooseLocalRecordingsPath={chooseLocalRecordingsPath} />
}
