import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'

import ServerStateInvalidationBridge from '@/app/providers/ServerStateInvalidationBridge'
import ServerStateSessionBoundary from '@/app/providers/ServerStateSessionBoundary'
import { DesktopAuthRoot } from '@/features/auth/AuthContext'
import { overlayQueryClient } from '@/lib/query-client'

export function OverlayProviders({ children }: { children: ReactNode }) {
  return (
    <DesktopAuthRoot>
      <QueryClientProvider client={overlayQueryClient}>
        <ServerStateSessionBoundary>
          <ServerStateInvalidationBridge />
          {children}
        </ServerStateSessionBoundary>
      </QueryClientProvider>
    </DesktopAuthRoot>
  )
}
