import React, { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { FolderRecord } from '@/types/folder'

type CreateNoteDialogProps = {
  isOpen: boolean
  folders: FolderRecord[]
  defaultFolderId?: string | null
  onClose?: () => void
  onCreate: (payload: { title: string; folderId?: string | null }) => Promise<boolean> | boolean
}

const UNFILED_VALUE = '__unfiled__'

export function CreateNoteDialog({
  isOpen,
  folders,
  defaultFolderId,
  onClose,
  onCreate,
}: CreateNoteDialogProps) {
  const [title, setTitle] = useState('')
  const [folderId, setFolderId] = useState<string>(defaultFolderId ?? UNFILED_VALUE)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setTitle('')
    setFolderId(defaultFolderId ?? UNFILED_VALUE)
    setCreating(false)
    setError(null)
  }, [isOpen, defaultFolderId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      setError('Note title is required')
      return
    }

    try {
      setCreating(true)
      setError(null)
      const ok = await onCreate({
        title: trimmed,
        folderId: folderId === UNFILED_VALUE ? null : folderId,
      })
      if (!ok) throw new Error('Failed to create note')
      onClose?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create note')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create note</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="note-title" className="text-xs text-neutral-100">
              Title
            </Label>
            <Input
              id="note-title"
              placeholder="e.g., Meeting summary"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={creating}
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="note-folder" className="text-xs text-neutral-100">
              Folder
            </Label>
            <Select value={folderId} onValueChange={setFolderId} disabled={creating}>
              <SelectTrigger
                id="note-folder"
                className="w-full"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <SelectValue placeholder="Choose a folder" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNFILED_VALUE}>Unfiled</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={creating || !title.trim()}
            >
              {creating ? 'Creating...' : 'Create note'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
