import React, { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type CreateFolderDialogProps = {
  isOpen: boolean
  onClose?: () => void
  onCreate: (name: string) => Promise<boolean> | boolean
}

export function CreateFolderDialog({ isOpen, onClose, onCreate }: CreateFolderDialogProps) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setName('')
    setCreating(false)
    setError(null)
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Folder name is required')
      return
    }

    try {
      setCreating(true)
      setError(null)
      const ok = await onCreate(trimmed)
      if (!ok) throw new Error('Failed to create folder')
      onClose?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create folder</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="space-y-1">
            <Label htmlFor="folder-name" className="text-xs text-neutral-100">
              Folder
            </Label>
            <Input
              id="folder-name"
              placeholder="e.g., Intro calls, Planning, Research"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={creating}
              autoFocus
            />
          </div>

          {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}

          <div className="flex min-h-8 justify-end gap-2 pt-2">
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
              disabled={creating || !name.trim()}
            >
              {creating ? 'Creating...' : 'Create folder'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
