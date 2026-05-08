import { cn } from '@/lib/utils'

export function OrionLogo({ className }: { className?: string }) {
  return (
    <img
      src="/orion-mark.svg"
      alt=""
      className={cn('pointer-events-none shrink-0 select-none [-webkit-user-drag:none]', className)}
      draggable={false}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}
