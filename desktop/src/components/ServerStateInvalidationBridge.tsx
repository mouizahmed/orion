import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { useAuth } from '@/contexts/AuthContext'
import {
  createResourceInvalidationBatcher,
  invalidateAccount,
  invalidateResources,
  isResourceChangedEvent,
} from '@/lib/resource-invalidation'
import { wsClient } from '@/lib/ws-client'

export default function ServerStateInvalidationBridge() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const accountID = user?.id

  useEffect(() => {
    if (!accountID) return

    const batcher = createResourceInvalidationBatcher((resources) => {
      void invalidateResources(queryClient, accountID, resources)
    })

    const unsubscribeResource = wsClient.subscribe('resource.changed', (value) => {
      if (!isResourceChangedEvent(value)) return
      batcher.add(value.resource)
    })
    const unsubscribeStatus = wsClient.onStatusChange((status) => {
      if (status !== 'connected') return
      void invalidateAccount(queryClient, accountID)
    })

    return () => {
      unsubscribeResource()
      unsubscribeStatus()
      batcher.cancel()
    }
  }, [accountID, queryClient])

  return null
}
