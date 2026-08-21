import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { wsClient, type ConnectionStatus } from '@/app/realtime/ws-client'

interface WebSocketContextType {
  status: ConnectionStatus
  subscribe: typeof wsClient.subscribe
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined)

export function WebSocketProvider({ children, authenticated, getAccessToken }: {
  children: ReactNode
  authenticated: boolean
  getAccessToken: (forceRefresh?: boolean) => Promise<string>
}) {
  const [status, setStatus] = useState<ConnectionStatus>(wsClient.status)

  useEffect(() => {
    return wsClient.onStatusChange(setStatus)
  }, [])

  useEffect(() => {
    if (!authenticated) {
      wsClient.disconnect()
      return
    }
    wsClient.connect(getAccessToken)
    return () => {
      wsClient.disconnect()
    }
  }, [authenticated, getAccessToken])

  const value = useMemo<WebSocketContextType>(
    () => ({
      status,
      subscribe: wsClient.subscribe.bind(wsClient),
    }),
    [status],
  )

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>
}

export function useWebSocket() {
  const ctx = useContext(WebSocketContext)
  if (!ctx) throw new Error('useWebSocket must be used within WebSocketProvider')
  return ctx
}
