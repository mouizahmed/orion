import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { wsClient, type ConnectionStatus } from '@/lib/ws-client'
import { useFirebaseAuth } from '@/contexts/FirebaseAuthContext'

interface WebSocketContextType {
  status: ConnectionStatus
  subscribe: typeof wsClient.subscribe
  send: typeof wsClient.send
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined)

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { user, getIdToken } = useFirebaseAuth()
  const [status, setStatus] = useState<ConnectionStatus>(wsClient.status)

  useEffect(() => {
    return wsClient.onStatusChange(setStatus)
  }, [])

  useEffect(() => {
    if (!user) {
      wsClient.disconnect()
      return
    }
    wsClient.connect(getIdToken)
    return () => {
      wsClient.disconnect()
    }
  }, [user, getIdToken])

  const value = useMemo<WebSocketContextType>(
    () => ({
      status,
      subscribe: wsClient.subscribe.bind(wsClient),
      send: wsClient.send.bind(wsClient),
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
