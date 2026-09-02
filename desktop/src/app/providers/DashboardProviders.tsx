import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

import { SidebarProvider } from '@/components/ui/sidebar'
import { DashboardAuthRoot } from '@/features/auth/AuthContext'
import CalendarQueryEvents from '@/features/calendar/CalendarQueryEvents'
import { BillingProvider } from '@/features/settings/sections/billing/BillingContext'
import { dashboardQueryClient } from '@/lib/query-client'
import ServerStateInvalidationBridge from '@/app/providers/ServerStateInvalidationBridge'
import ServerStateSessionBoundary from '@/app/providers/ServerStateSessionBoundary'
import { DashboardRecordingProvider } from '@/features/recording/DashboardRecordingContext'

export function DashboardProviders({ children }: { children: ReactNode }) {
  return (
    <DashboardAuthRoot>
      <QueryClientProvider client={dashboardQueryClient}>
        <ServerStateSessionBoundary>
          <CalendarQueryEvents />
          <ServerStateInvalidationBridge />
          <BillingProvider>
            <DashboardRecordingProvider>
              <SidebarProvider defaultOpen>{children}</SidebarProvider>
            </DashboardRecordingProvider>
          </BillingProvider>
          <Toaster
            position="bottom-center"
            theme="system"
            toastOptions={{ style: { borderRadius: '10px', fontSize: '13px' } }}
          />
        </ServerStateSessionBoundary>
      </QueryClientProvider>
    </DashboardAuthRoot>
  )
}
