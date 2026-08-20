import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { SettingRow, ToggleSwitch } from '@/features/settings/components/SettingsPrimitives'

export function EmailDraftSettings() {
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
        <SettingRow label="Enable email draft" value="Automatically draft follow-up emails after meetings." action={<ToggleSwitch enabled />} />
        <SettingRow label="Include sharing link in the email body" value="e.g. You can review the full meeting notes here: https://orion.so/m/..." action={<ToggleSwitch enabled />} />
      </div>
      <div className="space-y-3">
        <div className="px-2">
          <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Templates</div>
          <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Define how follow-up emails should be generated with custom prompts.</div>
        </div>
        <Button type="button" variant="secondary" className="h-12 w-full justify-start rounded-lg px-3 text-sm font-semibold" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <Plus className="h-4 w-4" />
          Add new template
        </Button>
      </div>
    </div>
  )
}
