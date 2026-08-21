import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useDashboardNotes } from '@/features/notes/DashboardNotesContext'
import { DeleteSummaryTemplateDialog, SummaryTemplateDialog } from '@/features/settings/sections/summary-templates/SummaryTemplateDialog'
import { MAX_SUMMARY_TEMPLATES, type SummaryTemplate, type SummaryTemplateInput } from '@/features/settings/sections/summary-templates/types'
import { useCreateSummaryTemplateMutation, useDeleteSummaryTemplateMutation, useSummaryTemplatesQuery, useUpdateSummaryTemplateMutation } from '@/features/settings/sections/summary-templates/useSummaryTemplatesQuery'

function folderLabel(template: SummaryTemplate) {
  const labels = template.folders.map((folder) => folder.available ? (folder.name ?? 'Folder') : 'Folder unavailable')
  return labels.length <= 2 ? labels.join(', ') : `${labels.length} folders`
}

export function SummaryTemplatesSettings({ userID }: { userID?: string }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<SummaryTemplate | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState<SummaryTemplate | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { folders, isLoading: foldersLoading, loadError: foldersError } = useDashboardNotes()
  const templatesQuery = useSummaryTemplatesQuery(userID)
  const createMutation = useCreateSummaryTemplateMutation(userID)
  const updateMutation = useUpdateSummaryTemplateMutation(userID)
  const deleteMutation = useDeleteSummaryTemplateMutation(userID)
  const templates = templatesQuery.data ?? []
  const closeDialog = () => { setIsDialogOpen(false); setEditingTemplate(null) }
  const submitTemplate = async (input: SummaryTemplateInput) => {
    if (editingTemplate) await updateMutation.mutateAsync({ id: editingTemplate.id, input })
    else await createMutation.mutateAsync(input)
    closeDialog()
  }
  const confirmDelete = async () => {
    if (!deletingTemplate) return
    setDeleteError(null)
    try { await deleteMutation.mutateAsync(deletingTemplate.id); setDeletingTemplate(null) } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete summary template')
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
          <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Templates</div>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">{templates.length} / {MAX_SUMMARY_TEMPLATES} templates</span>
        </div>
        <div className="px-3 py-3">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">Define how meeting summaries should be generated with custom prompts.</div>
          <Button type="button" variant="secondary" className="mt-3 h-9 w-full justify-start px-3 text-xs font-medium" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} disabled={templates.length >= MAX_SUMMARY_TEMPLATES} onClick={() => { setEditingTemplate(null); setIsDialogOpen(true) }}>
            <Plus className="size-3.5" /> Add new template
          </Button>
          {templates.length >= MAX_SUMMARY_TEMPLATES ? <div className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">Maximum of {MAX_SUMMARY_TEMPLATES} templates reached.</div> : null}
          {templatesQuery.isPending ? <div className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Loading templates...</div> : null}
          {templatesQuery.isError ? <div className="mt-3 flex items-center justify-between gap-3 text-xs text-red-600 dark:text-red-400"><span>{templatesQuery.error instanceof Error ? templatesQuery.error.message : 'Failed to load templates'}</span><button type="button" className="font-medium hover:underline" onClick={() => void templatesQuery.refetch()}>Retry</button></div> : null}
          {!templatesQuery.isPending && !templatesQuery.isError && templates.length === 0 ? <div className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">No templates added yet.</div> : null}
        </div>
        {templates.map((template) => (
          <div key={template.id} className="flex items-center gap-3 border-t border-neutral-200 px-3 py-2.5 dark:border-white/10">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">{template.name}</div>
              <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{template.prompt}</div>
              <div className="mt-1 truncate text-[11px] text-neutral-400 dark:text-neutral-500">{folderLabel(template)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${template.name}`} onClick={() => { setEditingTemplate(template); setIsDialogOpen(true) }}><Pencil className="size-3.5" /></Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${template.name}`} onClick={() => { setDeleteError(null); setDeletingTemplate(template) }}><Trash2 className="size-3.5" /></Button>
            </div>
          </div>
        ))}
      </div>
      <SummaryTemplateDialog isOpen={isDialogOpen} folders={folders} templates={templates} initialTemplate={editingTemplate} foldersLoading={foldersLoading} foldersError={foldersError} submitting={createMutation.isPending || updateMutation.isPending} onClose={closeDialog} onSubmit={submitTemplate} />
      <DeleteSummaryTemplateDialog template={deletingTemplate} deleting={deleteMutation.isPending} error={deleteError} onClose={() => { if (!deleteMutation.isPending) { setDeletingTemplate(null); setDeleteError(null) } }} onConfirm={() => void confirmDelete()} />
    </>
  )
}
