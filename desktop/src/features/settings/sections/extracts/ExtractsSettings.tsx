import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'

import { DeleteExtractFieldDialog, ExtractFieldDialog } from '@/features/settings/sections/extracts/ExtractFieldDialog'
import { Button } from '@/components/ui/button'
import { useDashboardNotes } from '@/features/notes/DashboardNotesContext'
import {
  useCreateExtractFieldMutation,
  useDeleteExtractFieldMutation,
  useExtractFieldsQuery,
  useUpdateExtractFieldMutation,
} from '@/features/settings/sections/extracts/useExtractFieldsQuery'
import type { ExtractField, ExtractFieldInput } from '@/features/settings/sections/extracts/types'

function extractFieldScopeLabel(field: ExtractField) {
  if (field.scope.type === 'allMeetings') return 'All meetings'
  return field.scope.folders
    .map((folder) => folder.available ? (folder.name ?? 'Folder') : 'Folder unavailable')
    .join(', ')
}

export function ExtractsSettings({ userID }: { userID?: string }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingField, setEditingField] = useState<ExtractField | null>(null)
  const [deletingField, setDeletingField] = useState<ExtractField | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const { folders, isLoading: isLoadingFolders, loadError: foldersError } = useDashboardNotes()
  const fieldsQuery = useExtractFieldsQuery(userID)
  const createMutation = useCreateExtractFieldMutation(userID)
  const updateMutation = useUpdateExtractFieldMutation(userID)
  const deleteMutation = useDeleteExtractFieldMutation(userID)
  const fields = fieldsQuery.data ?? []

  const closeDialog = () => {
    setIsDialogOpen(false)
    setEditingField(null)
  }

  const submitField = async (input: ExtractFieldInput) => {
    if (editingField) {
      await updateMutation.mutateAsync({ id: editingField.id, input })
    } else {
      await createMutation.mutateAsync(input)
    }
    closeDialog()
  }

  const confirmDelete = async () => {
    if (!deletingField) return
    setDeleteError(null)
    try {
      await deleteMutation.mutateAsync(deletingField.id)
      setDeletingField(null)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete extract field')
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white/60 dark:border-white/10 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-white/10">
          <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Fields</div>
          <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
            {fields.length} {fields.length === 1 ? 'field' : 'fields'}
          </span>
        </div>
        <div className="px-3 py-3">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">
            Define fields to automatically extract insights from your meetings.
          </div>
          <Button
            type="button"
            variant="secondary"
            className="mt-3 h-9 w-full justify-start px-3 text-xs font-medium"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={() => {
              setEditingField(null)
              setIsDialogOpen(true)
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add new field
          </Button>
          {fieldsQuery.isPending ? <div className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Loading fields...</div> : null}
          {fieldsQuery.isError ? (
            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-red-600 dark:text-red-400">
              <span>{fieldsQuery.error instanceof Error ? fieldsQuery.error.message : 'Failed to load fields'}</span>
              <button type="button" className="font-medium hover:underline" onClick={() => void fieldsQuery.refetch()}>Retry</button>
            </div>
          ) : null}
          {!fieldsQuery.isPending && !fieldsQuery.isError && fields.length === 0 ? (
            <div className="mt-3 text-xs text-neutral-400 dark:text-neutral-500">No fields added yet.</div>
          ) : null}
        </div>
        {fields.map((field) => (
          <div key={field.id} className="flex items-center gap-3 border-t border-neutral-200 px-3 py-2.5 dark:border-white/10">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">{field.name}</div>
              <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{field.prompt}</div>
              <div className="mt-1 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                {field.insightCardinality === 'single' ? 'Single' : 'Multiple'} · {extractFieldScopeLabel(field)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${field.name}`}
                onClick={() => {
                  setEditingField(field)
                  setIsDialogOpen(true)
                }}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${field.name}`}
                onClick={() => {
                  setDeleteError(null)
                  setDeletingField(field)
                }}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <ExtractFieldDialog
        isOpen={isDialogOpen}
        folders={folders}
        initialField={editingField}
        foldersLoading={isLoadingFolders}
        foldersError={foldersError}
        submitting={createMutation.isPending || updateMutation.isPending}
        onClose={closeDialog}
        onSubmit={submitField}
      />
      <DeleteExtractFieldDialog
        field={deletingField}
        deleting={deleteMutation.isPending}
        error={deleteError}
        onClose={() => {
          if (!deleteMutation.isPending) {
            setDeletingField(null)
            setDeleteError(null)
          }
        }}
        onConfirm={() => void confirmDelete()}
      />
    </>
  )
}
