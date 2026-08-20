import { useEffect, useMemo, useState } from 'react'
import { Folder, Globe } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CheckboxDropdown, type CheckboxDropdownOption } from '@/components/ui/checkbox-dropdown'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import type { ExtractField, ExtractFieldInput } from '@/types/extract-field'
import type { FolderRecord } from '@/types/folder'

type InsightCount = 'single' | 'multiple'

type ExtractFieldDialogProps = {
  isOpen: boolean
  folders: FolderRecord[]
  initialField?: ExtractField | null
  foldersLoading?: boolean
  foldersError?: string | null
  submitting?: boolean
  onClose: () => void
  onSubmit: (input: ExtractFieldInput) => Promise<void>
}

const ALL_MEETINGS_VALUE = '__all_meetings__'

export function ExtractFieldDialog({
  isOpen,
  folders,
  initialField = null,
  foldersLoading = false,
  foldersError = null,
  submitting = false,
  onClose,
  onSubmit,
}: ExtractFieldDialogProps) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [insightCount, setInsightCount] = useState<InsightCount>('multiple')
  const [meetingScope, setMeetingScope] = useState<string[]>([ALL_MEETINGS_VALUE])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setName(initialField?.name ?? '')
    setPrompt(initialField?.prompt ?? '')
    setInsightCount(initialField?.insightCardinality ?? 'multiple')
    setMeetingScope(initialField?.scope.type === 'folders'
      ? initialField.scope.folders.map((folder) => folder.id)
      : [ALL_MEETINGS_VALUE])
    setError(null)
  }, [initialField, isOpen])

  const scopeOptions = useMemo<CheckboxDropdownOption[]>(() => {
    const activeOptions = folders.map((folder) => ({
      value: folder.id,
      label: folder.name,
      icon: <Folder className="size-3.5 text-neutral-500" />,
    }))
    const activeIDs = new Set(folders.map((folder) => folder.id))
    const unavailableOptions = initialField?.scope.type === 'folders'
      ? initialField.scope.folders
        .filter((folder) => !folder.available && !activeIDs.has(folder.id))
        .map((folder) => ({
          value: folder.id,
          label: folder.name ?? 'Folder unavailable',
          icon: <Folder className="size-3.5 text-red-400" />,
        }))
      : []
    return [
      { value: ALL_MEETINGS_VALUE, label: 'All meetings', icon: <Globe className="size-3.5 text-neutral-500" /> },
      ...activeOptions,
      ...unavailableOptions,
    ]
  }, [folders, initialField])

  const activeFolderIDs = new Set(folders.map((folder) => folder.id))
  const selectedFolderIDs = meetingScope.filter((value) => value !== ALL_MEETINGS_VALUE)
  const hasUnavailableSelection = selectedFolderIDs.some((id) => !activeFolderIDs.has(id))
  const hasValidScope = meetingScope.includes(ALL_MEETINGS_VALUE) || selectedFolderIDs.length > 0
  const canSubmit = name.trim().length > 0
    && prompt.trim().length > 0
    && name.trim().length <= 100
    && prompt.trim().length <= 4000
    && hasValidScope
    && !hasUnavailableSelection

  const handleClose = () => {
    if (!submitting) onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="w-[min(calc(100vw-32px),512px)] gap-0 p-4">
        <DialogHeader className="mb-5">
          <DialogTitle className="text-base">{initialField ? 'Edit field' : 'Add new field'}</DialogTitle>
        </DialogHeader>

        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSubmit || submitting) return
            setError(null)
            void onSubmit({
              name: name.trim(),
              prompt: prompt.trim(),
              insightCardinality: insightCount,
              scope: meetingScope.includes(ALL_MEETINGS_VALUE)
                ? { type: 'allMeetings' }
                : { type: 'folders', folderIds: selectedFolderIDs },
            }).catch((submitError) => {
              setError(submitError instanceof Error ? submitError.message : 'Failed to save extract field')
            })
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="extract-field-name" className="text-xs text-neutral-700 dark:text-neutral-100">Name</Label>
            <Input
              id="extract-field-name"
              value={name}
              placeholder="e.g. Pain Points"
              className="h-9"
              maxLength={100}
              disabled={submitting}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="extract-field-prompt" className="text-xs text-neutral-700 dark:text-neutral-100">Prompt</Label>
            <textarea
              id="extract-field-prompt"
              value={prompt}
              placeholder="e.g. What pain points does the prospect face?"
              rows={3}
              maxLength={4000}
              disabled={submitting}
              className="min-h-16 w-full resize-none rounded-xl border border-neutral-200 bg-white/70 px-3 py-2 text-xs text-neutral-900 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-neutral-500 focus-visible:border-neutral-300 focus-visible:ring-2 focus-visible:ring-neutral-900/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/12 dark:bg-white/5 dark:text-neutral-100 dark:focus-visible:border-white/20 dark:focus-visible:ring-white/10"
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="extract-field-count" className="text-xs text-neutral-700 dark:text-neutral-100">Number of insights</Label>
            <Select value={insightCount} disabled={submitting} onValueChange={(value) => setInsightCount(value as InsightCount)}>
              <SelectTrigger id="extract-field-count" className="h-9 w-full">
                <span className="font-medium capitalize">{insightCount}</span>
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value="multiple">Multiple</SelectItem>
                <SelectItem value="single">Single</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-neutral-700 dark:text-neutral-100">Apply to meetings in</Label>
            <CheckboxDropdown
              ariaLabel="Apply extract field to meetings in"
              value={meetingScope}
              options={scopeOptions}
              exclusiveValue={ALL_MEETINGS_VALUE}
              disabled={submitting}
              onValueChange={setMeetingScope}
              formatValue={(selected) => {
                if (selected.some((option) => option.value === ALL_MEETINGS_VALUE)) return 'All meetings'
                if (selected.length === 0) return 'Select folders'
                if (selected.length === 1) return selected[0].label
                return `${selected.length} folders`
              }}
            />
            {foldersLoading ? <div className="text-xs text-neutral-500 dark:text-neutral-400">Loading folders...</div> : null}
            {foldersError ? <div className="text-xs text-red-600 dark:text-red-400">Folders are unavailable. All meetings remains available.</div> : null}
            {hasUnavailableSelection ? (
              <div className="text-xs text-red-600 dark:text-red-400">Remove unavailable folders or choose All meetings.</div>
            ) : null}
          </div>

          {error ? <div className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</div> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" disabled={submitting} onClick={handleClose}>Cancel</Button>
            <Button type="submit" variant="brand" disabled={!canSubmit || submitting}>
              {submitting ? 'Saving' : initialField ? 'Save' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteExtractFieldDialog({
  field,
  deleting,
  error,
  onClose,
  onConfirm,
}: {
  field: ExtractField | null
  deleting: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={Boolean(field)} onOpenChange={(open) => !open && !deleting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete field</DialogTitle>
        </DialogHeader>
        <div className="text-xs leading-5 text-neutral-400">
          Delete {field ? `"${field.name}"` : 'this field'}? This configuration cannot be recovered.
        </div>
        {error ? <div className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</div> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" disabled={deleting} onClick={onClose}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={deleting} onClick={onConfirm}>
            {deleting ? 'Deleting' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
