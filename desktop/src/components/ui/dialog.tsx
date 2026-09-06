import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { cn } from '@/lib/utils'

type DialogContextValue = {
  open: boolean
  onOpenChange?: (open: boolean) => void
  overlayClassName?: string
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialogCtx() {
  const ctx = React.useContext(DialogContext)
  if (!ctx) {
    throw new Error('Dialog components must be used within <Dialog>.')
  }
  return ctx
}

function Dialog({
  open,
  onOpenChange,
  overlayClassName,
  children,
}: {
  open: boolean
  onOpenChange?: (open: boolean) => void
  overlayClassName?: string
  children: React.ReactNode
}) {
  return (
    <DialogContext.Provider value={{ open, onOpenChange, overlayClassName }}>
      {children}
    </DialogContext.Provider>
  )
}

function DialogTrigger({ children }: { children: React.ReactNode }) {
  // Kept for API parity; callers can wire their own trigger.
  return <>{children}</>
}

function DialogPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') {
    return null
  }
  return createPortal(children, document.body)
}

function DialogClose({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { onOpenChange } = useDialogCtx()
  return (
    <button
      type="button"
      className={className}
      onClick={(e) => {
        props.onClick?.(e)
        onOpenChange?.(false)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

const DialogOverlay = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { open, onOpenChange, overlayClassName } = useDialogCtx()
    if (!open) return null
    return (
      <div
        ref={ref}
        className={cn(
          'fixed inset-0 z-50 bg-black/80 animate-in fade-in-0',
          overlayClassName,
          className,
        )}
        onMouseDown={() => onOpenChange?.(false)}
        {...props}
      />
    )
  },
)
DialogOverlay.displayName = 'DialogOverlay'

const DialogContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const { open } = useDialogCtx()
    if (!open) return null

    return (
      <DialogPortal>
        <DialogOverlay />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          className={cn(
            'fixed left-[50%] top-[50%] z-50 grid max-h-[90vh] w-[min(calc(100vw-32px),380px)] translate-x-[-50%] translate-y-[-50%] gap-2 overflow-y-auto rounded-xl border border-white/10 bg-[#171417]/95 p-3 text-neutral-100 shadow-2xl backdrop-blur-md duration-200 animate-in fade-in-0 zoom-in-95 sidebar-scrollbar [&_[data-slot=checkbox-dropdown-trigger]]:rounded-lg [&_[data-slot=input]]:rounded-lg [&_[data-slot=select-trigger]]:rounded-lg [&_textarea]:rounded-lg',
            className,
          )}
          onMouseDown={(e) => e.stopPropagation()}
          {...props}
        >
          {children}
          <DialogClose className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-white/8 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20 disabled:pointer-events-none">
            <X size={14} />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>
      </DialogPortal>
    )
  },
)
DialogContent.displayName = 'DialogContent'

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex min-h-8 flex-col justify-center space-y-1 pr-10 text-left', className)} {...props} />
)
DialogHeader.displayName = 'DialogHeader'

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...props} />
)
DialogFooter.displayName = 'DialogFooter'

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn('text-sm font-semibold leading-none text-neutral-100', className)} {...props} />
  ),
)
DialogTitle.displayName = 'DialogTitle'

const DialogDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-xs leading-5 text-neutral-400', className)} {...props} />
  ),
)
DialogDescription.displayName = 'DialogDescription'

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
