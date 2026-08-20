import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'

export function SummaryTemplatesSettings() {
  return (
    <div className="space-y-3">
      <div className="px-2">
        <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Templates</div>
        <div className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Define how meeting summaries should be generated with custom prompts.</div>
      </div>
      <Button type="button" variant="secondary" className="h-12 w-full justify-start rounded-lg px-3 text-sm font-semibold" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <Plus className="h-4 w-4" />
        Add new template
      </Button>
    </div>
  )
}
