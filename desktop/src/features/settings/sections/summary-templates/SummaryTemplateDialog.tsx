import { useEffect, useMemo, useState } from 'react'
import { Folder } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CheckboxDropdown, type CheckboxDropdownOption } from '@/components/ui/checkbox-dropdown'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { FolderRecord } from '@/features/notes/folder-types'
import type { SummaryTemplate, SummaryTemplateInput } from '@/features/settings/sections/summary-templates/types'

export function SummaryTemplateDialog({ isOpen, folders, templates, initialTemplate = null, foldersLoading = false, foldersError = null, submitting = false, onClose, onSubmit }: {
  isOpen: boolean
  folders: FolderRecord[]
  templates: SummaryTemplate[]
  initialTemplate?: SummaryTemplate | null
  foldersLoading?: boolean
  foldersError?: string | null
  submitting?: boolean
  onClose: () => void
  onSubmit: (input: SummaryTemplateInput) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [folderIDs, setFolderIDs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setName(initialTemplate?.name ?? '')
    setPrompt(initialTemplate?.prompt ?? '')
    setFolderIDs(initialTemplate?.folders.map((folder) => folder.id) ?? [])
    setError(null)
  }, [initialTemplate, isOpen])

  const assignedByOther = useMemo(() => {
    const assigned = new Set<string>()
    for (const template of templates) {
      if (template.id === initialTemplate?.id) continue
      for (const folder of template.folders) assigned.add(folder.id)
    }
    return assigned
  }, [initialTemplate?.id, templates])

  const options = useMemo<CheckboxDropdownOption[]>(() => {
    const activeIDs = new Set(folders.map((folder) => folder.id))
    const activeOptions = folders.map((folder) => ({
      value: folder.id,
      label: folder.name,
      icon: <Folder className="size-3.5 text-neutral-500" />,
      disabled: assignedByOther.has(folder.id),
      description: assignedByOther.has(folder.id) ? 'Already assigned' : undefined,
    }))
    const unavailableOptions = initialTemplate?.folders
      .filter((folder) => !folder.available && !activeIDs.has(folder.id))
      .map((folder) => ({ value: folder.id, label: folder.name ?? 'Folder unavailable', icon: <Folder className="size-3.5 text-red-400" /> })) ?? []
    return [...activeOptions, ...unavailableOptions]
  }, [assignedByOther, folders, initialTemplate])

  const activeFolderIDs = new Set(folders.map((folder) => folder.id))
  const hasUnavailableSelection = folderIDs.some((id) => !activeFolderIDs.has(id))
  const hasConflictSelection = folderIDs.some((id) => assignedByOther.has(id))
  const canSubmit = name.trim().length > 0 && name.trim().length <= 100
    && prompt.trim().length > 0 && prompt.trim().length <= 4000
    && folderIDs.length > 0 && !hasUnavailableSelection && !hasConflictSelection && !foldersError
  const handleClose = () => { if (!submitting) onClose() }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="w-[min(calc(100vw-32px),512px)] gap-0 p-4">
        <DialogHeader className="mb-5"><DialogTitle className="text-base">{initialTemplate ? 'Edit template' : 'Add new template'}</DialogTitle></DialogHeader>
        <form className="space-y-5" onSubmit={(event) => {
          event.preventDefault()
          if (!canSubmit || submitting) return
          setError(null)
          void onSubmit({ name: name.trim(), prompt: prompt.trim(), folderIds: folderIDs }).catch((submitError) => {
            setError(submitError instanceof Error ? submitError.message : 'Failed to save summary template')
          })
        }}>
          <div className="space-y-2">
            <Label htmlFor="summary-template-name" className="text-xs text-neutral-700 dark:text-neutral-100">Name</Label>
            <Input id="summary-template-name" value={name} placeholder="e.g. Sales Call" className="h-9" maxLength={100} disabled={submitting} autoFocus onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="summary-template-prompt" className="text-xs text-neutral-700 dark:text-neutral-100">Prompt</Label>
            <textarea id="summary-template-prompt" value={prompt} placeholder="e.g. Summarize the customer's goals, decisions, and next steps." rows={4} maxLength={4000} disabled={submitting} className="sidebar-scrollbar min-h-20 w-full resize-none overflow-y-auto rounded-xl border border-neutral-200 bg-white/70 px-3 py-2 text-xs text-neutral-900 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-neutral-500 focus-visible:border-neutral-300 focus-visible:ring-2 focus-visible:ring-neutral-900/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/12 dark:bg-white/5 dark:text-neutral-100 dark:focus-visible:border-white/20 dark:focus-visible:ring-white/10" onChange={(event) => setPrompt(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-neutral-700 dark:text-neutral-100">Apply to meetings in</Label>
            <CheckboxDropdown ariaLabel="Apply summary template to meetings in" value={folderIDs} options={options} disabled={submitting || (foldersLoading && folders.length === 0)} onValueChange={setFolderIDs} formatValue={(selected) => selected.length === 0 ? 'Select folders' : selected.length === 1 ? selected[0].label : `${selected.length} folders`} />
            {foldersLoading ? <div className="text-xs text-neutral-500 dark:text-neutral-400">Loading folders...</div> : null}
            {foldersError ? <div className="text-xs text-red-600 dark:text-red-400">Folders are unavailable.</div> : null}
            {hasUnavailableSelection ? <div className="text-xs text-red-600 dark:text-red-400">Remove unavailable folders before saving.</div> : null}
            {hasConflictSelection ? <div className="text-xs text-red-600 dark:text-red-400">A selected folder is assigned to another template.</div> : null}
          </div>
          {error ? <div className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</div> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" disabled={submitting} onClick={handleClose}>Cancel</Button>
            <Button type="submit" variant="brand" disabled={!canSubmit || submitting}>{submitting ? 'Saving' : initialTemplate ? 'Save' : 'Create'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteSummaryTemplateDialog({ template, deleting, error, onClose, onConfirm }: {
  template: SummaryTemplate | null
  deleting: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={Boolean(template)} onOpenChange={(open) => !open && !deleting && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Delete template</DialogTitle></DialogHeader>
        <div className="text-xs leading-5 text-neutral-400">Delete {template ? `"${template.name}"` : 'this template'}? This configuration cannot be recovered.</div>
        {error ? <div className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</div> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" disabled={deleting} onClick={onClose}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={deleting} onClick={onConfirm}>{deleting ? 'Deleting' : 'Delete'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
