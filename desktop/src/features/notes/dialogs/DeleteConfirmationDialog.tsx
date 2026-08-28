import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type DeleteConfirmationDialogProps = {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  deleting?: boolean
  error?: string | null
  onClose: () => void
  onConfirm: () => void
}

export function DeleteConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  deleting = false,
  error = null,
  onClose,
  onConfirm,
}: DeleteConfirmationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !deleting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? <div className="text-xs leading-5 text-red-600 dark:text-red-400" role="alert">{error}</div> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" disabled={deleting} onClick={onClose}>
            Keep it
          </Button>
          <Button type="button" variant="destructive" disabled={deleting} onClick={onConfirm}>
            {deleting ? 'Deleting...' : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
