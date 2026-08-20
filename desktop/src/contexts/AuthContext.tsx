import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { WebSocketProvider } from '@/contexts/WebSocketContext'
import { desktopApi, type AuthSnapshot, type AuthStatus, type AuthUser } from '@/lib/desktop-api'
import { authenticatedFetch, consumeSessionExpiredMessage, SESSION_EXPIRED_EVENT, SESSION_EXPIRED_MESSAGE } from '@/lib/auth-session'
import { API_BASE_URL } from '@/lib/api-config'

export type User = AuthUser

type AuthContextValue = {
  user: User | null
  status: AuthStatus
  isAuthenticated: boolean
  isLoading: boolean
  authError: string | null
  loginLoading: boolean
  loginProvider: 'google' | 'microsoft' | null
  getAccessToken: (forceRefresh?: boolean) => Promise<string>
  loginWithGoogle: () => Promise<void>
  loginWithMicrosoft: () => Promise<void>
  retryAuthentication: () => Promise<void>
  cancelAuth: () => void
  logout: () => Promise<void>
  logoutAllDevices: () => Promise<void>
  updateProfileName: (name: string) => Promise<User>
  uploadProfileAvatar: (file: File) => Promise<User>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)
const INITIAL: AuthSnapshot = { status: 'initializing', user: null, error: null, loginProvider: null }

function mapBackendUser(payload: unknown): User {
  const data = payload as Record<string, unknown>
  const plan: User['plan'] | null = data.plan === 'free' || data.plan === 'professional' || data.plan === 'business'
    ? data.plan
    : null
  const user = {
    id: typeof data.id === 'string' ? data.id : '',
    email: typeof data.email === 'string' ? data.email : '',
    name: typeof data.name === 'string' ? data.name : '',
    plan,
    picture: typeof data.avatar_url === 'string' && data.avatar_url ? data.avatar_url : undefined,
  }
  if (!user.id || !user.email || !user.name || !user.plan) throw new Error('Profile response was invalid')
  return { ...user, plan: user.plan }
}

async function readBackendUser(response: Response): Promise<User> {
  if (!response.ok) throw new Error(`Profile request failed: ${response.status}`)
  return mapBackendUser(await response.json())
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(INITIAL)
  const [localError, setLocalError] = useState<string | null>(() => consumeSessionExpiredMessage())

  useEffect(() => {
    let active = true
    const removeListener = desktopApi.auth.onStateChanged((next) => {
      if (active) {
        setSnapshot(next)
        if (next.status === 'authenticated') setLocalError(null)
        else if (next.error) setLocalError(next.error)
      }
    })
    void desktopApi.auth.getSnapshot().then((next) => {
      if (active) {
        setSnapshot(next)
        if (next.status === 'authenticated') setLocalError(null)
        else if (next.error) setLocalError(next.error)
      }
    }).catch(() => {
      if (active) setSnapshot({ status: 'service-unavailable', user: null, error: 'Authentication service is unavailable.', loginProvider: null })
    })
    const expired = () => setLocalError(SESSION_EXPIRED_MESSAGE)
    window.addEventListener(SESSION_EXPIRED_EVENT, expired)
    return () => {
      active = false
      removeListener()
      window.removeEventListener(SESSION_EXPIRED_EVENT, expired)
    }
  }, [])

  const login = useCallback(async (provider: 'google' | 'microsoft') => {
    setLocalError(null)
    const result = provider === 'google'
      ? await desktopApi.auth.loginWithGoogle()
      : await desktopApi.auth.loginWithMicrosoft()
    if (!result.success) setLocalError(result.error)
  }, [])
  const loginWithGoogle = useCallback(() => login('google'), [login])
  const loginWithMicrosoft = useCallback(() => login('microsoft'), [login])
  const retryAuthentication = useCallback(async () => {
    setLocalError(null)
    try {
      const next = await desktopApi.auth.revalidate()
      setSnapshot(next)
      if (next.error) setLocalError(next.error)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Authentication service is unavailable.')
    }
  }, [])
  const cancelAuth = useCallback(() => { void desktopApi.auth.cancel() }, [])
  const logout = useCallback(async () => {
    const result = await desktopApi.auth.logout()
    if (!result.success) throw new Error(result.error)
  }, [])
  const logoutAllDevices = useCallback(async () => {
    const result = await desktopApi.auth.logoutAllDevices()
    if (!result.success) throw new Error(result.error)
  }, [])
  const getAccessToken = useCallback((forceRefresh = false) => desktopApi.auth.getAccessToken(forceRefresh), [])

  const updateProfileName = useCallback(async (name: string) => {
    const user = await readBackendUser(await authenticatedFetch(`${API_BASE_URL}/user/me`, {
      method: 'PATCH',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }))
    const next = await desktopApi.auth.revalidate()
    setSnapshot(next)
    return user
  }, [])

  const uploadProfileAvatar = useCallback(async (file: File) => {
    const body = new FormData()
    body.append('file', file)
    const user = await readBackendUser(await authenticatedFetch(`${API_BASE_URL}/user/me/avatar`, {
      method: 'POST', headers: { Accept: 'application/json' }, body,
    }))
    const next = await desktopApi.auth.revalidate()
    setSnapshot(next)
    return user
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user: snapshot.user,
    status: snapshot.status,
    isAuthenticated: snapshot.status === 'authenticated' && Boolean(snapshot.user),
    isLoading: snapshot.status === 'initializing' || snapshot.status === 'validating',
    authError: localError ?? snapshot.error,
    loginLoading: snapshot.status === 'oauth-pending',
    loginProvider: snapshot.loginProvider,
    getAccessToken,
    loginWithGoogle,
    loginWithMicrosoft,
    retryAuthentication,
    cancelAuth,
    logout,
    logoutAllDevices,
    updateProfileName,
    uploadProfileAvatar,
  }), [cancelAuth, getAccessToken, localError, loginWithGoogle, loginWithMicrosoft, logout, logoutAllDevices, retryAuthentication, snapshot, updateProfileName, uploadProfileAvatar])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function AuthRoot({ children }: { children: ReactNode }) {
  return <AuthProvider><AuthenticatedSockets>{children}</AuthenticatedSockets></AuthProvider>
}

function AuthenticatedSockets({ children }: { children: ReactNode }) {
  const { isAuthenticated, getAccessToken } = useAuth()
  return <WebSocketProvider authenticated={isAuthenticated} getAccessToken={getAccessToken}>{children}</WebSocketProvider>
}

export const DesktopAuthRoot = AuthRoot
export const DashboardAuthRoot = AuthRoot

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthRoot')
  return context
}
