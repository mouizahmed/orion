import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { RecordingSettings } from '@/lib/desktop-api'
import { SettingRow, ToggleSwitch } from '@/features/settings/components/SettingsPrimitives'

export function PreferencesSettings({
  recordingSettings,
  updateRecordingSettings,
  chooseLocalRecordingsPath,
}: {
  recordingSettings: RecordingSettings
  updateRecordingSettings: (settings: Partial<RecordingSettings>) => Promise<void>
  chooseLocalRecordingsPath: () => Promise<void>
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">Meeting notifications</div>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">Remind me before meetings</div>
              <div className="mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400">Send notifications before the calendar event starts.</div>
            </div>
            <Select defaultValue="5m">
              <SelectTrigger className="w-40 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}><SelectValue /></SelectTrigger>
              <SelectContent align="start">
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
              <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">Auto-detected meetings</div>
              <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">Show notifications when a call is detected. You can mute specific apps below.</div>
            </div>
            <ToggleSwitch enabled />
          </div>
        </div>
      </div>
      <div>
        <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">Behavior</div>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <SettingRow label="Launch on Startup" value="This will launch Orion automatically when your system starts." action={<ToggleSwitch enabled />} />
        </div>
      </div>
      <div>
        <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">Audio recording</div>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <SettingRow
            label="Storage location"
            value="Where to store recorded audio"
            action={
              <Select value={recordingSettings.storageLocation} onValueChange={(value) => void updateRecordingSettings({ storageLocation: value === 'local' ? 'local' : 'server' })}>
                <SelectTrigger className="w-40" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}><SelectValue /></SelectTrigger>
              <SelectContent align="start">
                  <SelectItem value="server">Orion server</SelectItem>
                  <SelectItem value="local">Local only</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          {recordingSettings.storageLocation === 'local' ? (
            <SettingRow
              label="Save recordings to"
              value={recordingSettings.localRecordingsPath || 'No folder selected'}
              action={<Button type="button" variant="outline" size="sm" onClick={() => void chooseLocalRecordingsPath()}>Choose folder</Button>}
            />
          ) : null}
        </div>
      </div>
      <div>
        <div className="px-2 pb-1 text-xs font-semibold text-neutral-400">Data retention</div>
        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
          <SettingRow
            label="Auto-delete meetings after"
            value="Automatically archive old meetings"
            action={
              <Select defaultValue="never">
                <SelectTrigger className="w-40" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}><SelectValue /></SelectTrigger>
              <SelectContent align="start">
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
  )
}
