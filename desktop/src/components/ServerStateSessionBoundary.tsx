import { useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'

import { useAuth } from '@/contexts/AuthContext'
import { clearAccountServerState, setActiveServerStateAccount } from '@/lib/query-client'

export default function ServerStateSessionBoundary({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const previousAccountIDRef = useRef<string | null>(null)

  useLayoutEffect(() => {
    const accountID = user?.id ?? null
    setActiveServerStateAccount(accountID)
    return () => setActiveServerStateAccount(null)
  }, [user?.id])

  useEffect(() => {
    const previousAccountID = previousAccountIDRef.current
    const nextAccountID = user?.id ?? null
    previousAccountIDRef.current = nextAccountID

    if (!previousAccountID || previousAccountID === nextAccountID) return

    void clearAccountServerState(queryClient, previousAccountID)
  }, [queryClient, user?.id])

  return children
}
