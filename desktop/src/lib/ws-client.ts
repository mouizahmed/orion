import { auth } from '@/config/firebase'
import type { ClientEventMap, ServerEventMap } from '@/types/ws-events'

const WS_URL = (() => {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'
  const u = new URL(`${base.replace(/\/+$/, '')}/ws`)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  return u.toString()
})()

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'connected'

type AnyHandler = (data: unknown) => void

const BACKOFF_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000]

class WebSocketClient {
  private ws: WebSocket | null = null
  private _status: ConnectionStatus = 'disconnected'
  private handlers = new Map<string, Set<AnyHandler>>()
  private statusHandlers = new Set<(s: ConnectionStatus) => void>()
  private getToken: (() => Promise<string>) | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private stopped = false

  get status(): ConnectionStatus {
    return this._status
  }

  private setStatus(s: ConnectionStatus) {
    this._status = s
    this.statusHandlers.forEach((h) => h(s))
  }

  onStatusChange(handler: (s: ConnectionStatus) => void): () => void {
    this.statusHandlers.add(handler)
    return () => this.statusHandlers.delete(handler)
  }

  connect(getToken: () => Promise<string>): void {
    this.stopped = false
    this.getToken = getToken
    this.reconnectAttempt = 0
    this.openConnection(false)
  }

  disconnect(): void {
    this.stopped = true
    this.clearReconnectTimer()
    this.ws?.close()
    this.ws = null
    this.setStatus('disconnected')
  }

  subscribe<T extends keyof ServerEventMap>(
    type: T,
    handler: (data: ServerEventMap[T]) => void,
  ): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as AnyHandler)
    return () => {
      set!.delete(handler as AnyHandler)
    }
  }

  send<T extends keyof ClientEventMap>(type: T, data: ClientEventMap[T]): void {
    if (this._status !== 'connected' || !this.ws) return
    this.ws.send(JSON.stringify({ type, data }))
  }

  private openConnection(forceRefresh: boolean): void {
    if (this.stopped || !this.getToken) return
    this.clearReconnectTimer()

    // Close any existing socket before opening a new one. The old onclose guard
    // (`if (this.ws !== ws) return`) ensures its handler is ignored once we replace this.ws.
    const old = this.ws
    this.ws = null
    old?.close()

    this.setStatus('connecting')
    const ws = new WebSocket(WS_URL)
    this.ws = ws

    ws.onopen = () => {
      if (this.ws !== ws) return
      this.setStatus('authenticating')
      const tokenPromise: Promise<string> = forceRefresh
        ? (auth.currentUser?.getIdToken(true) ?? Promise.reject(new Error('no user')))
        : this.getToken!()

      tokenPromise
        .then((token) => {
          if (this.ws !== ws) return
          ws.send(JSON.stringify({ type: 'auth', token }))
        })
        .catch((err) => { console.warn('ws: token fetch failed', err); ws.close() })
    }

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      let msg: { type: string; data?: unknown }
      try {
        msg = JSON.parse(ev.data as string) as { type: string; data?: unknown }
      } catch {
        return
      }

      if (msg.type === 'auth.ok') {
        this.reconnectAttempt = 0
        this.setStatus('connected')
        return
      }

      if (this._status !== 'connected') return

      const set = this.handlers.get(msg.type)
      if (set) {
        set.forEach((h) => h(msg.data))
      }
    }

    ws.onclose = (ev) => {
      if (this.ws !== ws) return
      this.ws = null

      if (this.stopped) return

      if (ev.code === 4001) {
        if (forceRefresh) {
          this.setStatus('disconnected')
          return
        }
        this.openConnection(true)
        return
      }

      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const delay = BACKOFF_DELAYS[Math.min(this.reconnectAttempt, BACKOFF_DELAYS.length - 1)]
    this.reconnectAttempt++
    this.setStatus('connecting')
    this.reconnectTimer = window.setTimeout(() => {
      this.openConnection(false)
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

export const wsClient = new WebSocketClient()
