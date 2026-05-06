import React from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { SidebarRowButton } from '@/components/ui/sidebar-button'

export function LoadMoreButton({
  onClick,
  isLoading = false,
  disabled,
  indented = false,
}: {
  onClick: () => void
  isLoading?: boolean
  disabled?: boolean
  indented?: boolean
}) {
  return (
    <div style={indented ? { paddingLeft: '8px' } : undefined}>
      <SidebarRowButton
        className="text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-white/10"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onClick={onClick}
        disabled={disabled ?? isLoading}
      >
        {isLoading ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            <span>Loading...</span>
          </>
        ) : (
          <>
            <ChevronDown size={14} />
            <span>Load more</span>
          </>
        )}
      </SidebarRowButton>
    </div>
  )
}
