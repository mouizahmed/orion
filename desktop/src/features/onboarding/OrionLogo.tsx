import { cn } from '@/lib/utils'
import { publicAssetUrl } from '@/lib/public-asset'

export function OrionLogo({ className }: { className?: string }) {
  return (
    <img
      src={publicAssetUrl('orion-logo.svg')}
      alt=""
      className={cn('pointer-events-none shrink-0 select-none [-webkit-user-drag:none]', className)}
      draggable={false}
      onContextMenu={(event) => event.preventDefault()}
    />
  )
}
