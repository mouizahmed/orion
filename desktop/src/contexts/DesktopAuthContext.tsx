import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { auth, signInWithCustomToken } from '@/config/firebase'
import { useFirebaseAuth } from '@/contexts/FirebaseAuthContext'
import { desktopApi, type AuthResult } from '@/lib/desktop-api'
import {
  consumeSessionExpiredMessage,
  SESSION_EXPIRED_EVENT,
  SESSION_EXPIRED_MESSAGE,
  SESSION_EXPIRED_MESSAGE_KEY,
} from '@/lib/auth-session'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'

export interface DesktopAuthActions {
  authError: string | null
  loginLoading: boolean
  loginProvider: LoginProvider | null
  logout: () => Promise<void>
  logoutAllDevices: () => Promise<void>
  loginWithGoogle: () => Promise<void>
  loginWithMicrosoft: () => Promise<void>
  cancelAuth: () => void
}

type LoginProvider = 'google' | 'microsoft'

const DEFAULT_AUTH_TIMEOUT_SECONDS = 5 * 60

const DesktopAuthContext = createContext<DesktopAuthActions | undefined>(undefined)

async function revokeBackendSession(idToken: string) {
  const response = await fetch(`${API_BASE_URL}/auth/logout-all`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Backend logout failed: ${response.status}`)
  }
}

function useLogoutActions() {
  const { getIdToken, signOutLocal } = useFirebaseAuth()

  const logout = useCallback(async () => {
    try {
      await signOutLocal()
      await desktopApi.auth.logout()
    } catch (error) {
      console.error('Logout error:', error)
    }
  }, [signOutLocal])

  const logoutAllDevices = useCallback(async () => {
    const idToken = await getIdToken()
    await revokeBackendSession(idToken)
    await signOutLocal()
    await desktopApi.auth.logout()
  }, [getIdToken, signOutLocal])

  return { logout, logoutAllDevices }
}

export function DesktopAuthProvider({ children }: { children: ReactNode }) {
  const { user, isLoading, getIdToken } = useFirebaseAuth()
  const { logout, logoutAllDevices } = useLogoutActions()
  const [authError, setAuthError] = useState<string | null>(() => consumeSessionExpiredMessage())
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginProvider, setLoginProvider] = useState<LoginProvider | null>(null)
  const authTimeoutRef = useRef<number | null>(null)
  const pendingAuthRef = useRef(false)

  useEffect(() => {
    const handleSessionExpired = () => setAuthError(SESSION_EXPIRED_MESSAGE)
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SESSION_EXPIRED_MESSAGE_KEY && event.newValue) {
        setAuthError(event.newValue)
        localStorage.removeItem(SESSION_EXPIRED_MESSAGE_KEY)
      }
    }

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const clearAuthTimeout = useCallback(() => {
    if (authTimeoutRef.current !== null) {
      window.clearTimeout(authTimeoutRef.current)
      authTimeoutRef.current = null
    }
  }, [])

  const resetPendingAuth = useCallback((error: string | null = null, notifyMain = true) => {
    const wasPending = pendingAuthRef.current

    pendingAuthRef.current = false
    clearAuthTimeout()
    setLoginLoading(false)
    setLoginProvider(null)
    setAuthError(error)

    if (notifyMain && wasPending) {
      void desktopApi.auth.cancel()
    }
  }, [clearAuthTimeout])

  useEffect(() => {
    if (isLoading) return

    if (!user) {
      desktopApi.auth.notifyStateChanged({ isAuthenticated: false })
      return
    }

    let cancelled = false
    void getIdToken()
      .then((idToken) => {
        if (!cancelled) {
          desktopApi.auth.notifyStateChanged({ isAuthenticated: true, idToken })
        }
      })
      .catch((error) => {
        console.warn('Failed to get auth token for desktop state:', error)
        if (!cancelled) {
          desktopApi.auth.notifyStateChanged({ isAuthenticated: false })
        }
      })

    return () => {
      cancelled = true
    }
  }, [getIdToken, isLoading, user])

  useEffect(() => {
    const removeListener = desktopApi.auth.onSessionUpdated((data) => {
      clearAuthTimeout()

      if (!pendingAuthRef.current && !data.success) {
        console.warn('Ignoring failed auth callback with no active OAuth flow')
        return
      }

      if (!data.success) {
        resetPendingAuth(data.error, true)
        return
      }

      signInWithCustomToken(auth, data.firebaseToken)
        .then(() => {
          resetPendingAuth(null, false)
        })
        .catch((firebaseError) => {
          console.error('Firebase sign-in failed:', firebaseError)
          resetPendingAuth('Firebase authentication failed', true)
        })
    })

    return () => {
      clearAuthTimeout()
      removeListener()
    }
  }, [clearAuthTimeout, resetPendingAuth])

  const handleOAuthLogin = useCallback(async (
    provider: LoginProvider,
    authFn: () => Promise<AuthResult>,
  ) => {
    clearAuthTimeout()
    pendingAuthRef.current = true
    setLoginLoading(true)
    setLoginProvider(provider)
    setAuthError(null)

    try {
      const result = await authFn()
      if (!result.success) {
        throw new Error(result.error)
      }

      const timeoutSeconds =
        result.expiresInSeconds && result.expiresInSeconds > 0
          ? result.expiresInSeconds
          : DEFAULT_AUTH_TIMEOUT_SECONDS

      authTimeoutRef.current = window.setTimeout(() => {
        resetPendingAuth('Authentication timed out. Please try again.', true)
      }, timeoutSeconds * 1000)
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Authentication failed. Please try again.'
      resetPendingAuth(errorMessage, true)
    }
  }, [clearAuthTimeout, resetPendingAuth])

  const loginWithGoogle = useCallback(
    () => handleOAuthLogin('google', desktopApi.auth.loginWithGoogle),
    [handleOAuthLogin],
  )
  const loginWithMicrosoft = useCallback(
    () => handleOAuthLogin('microsoft', desktopApi.auth.loginWithMicrosoft),
    [handleOAuthLogin],
  )

  const cancelAuth = useCallback(() => {
    resetPendingAuth(null, true)
  }, [resetPendingAuth])

  const value = useMemo<DesktopAuthActions>(
    () => ({
      authError,
      loginLoading,
      loginProvider,
      logout,
      logoutAllDevices,
      loginWithGoogle,
      loginWithMicrosoft,
      cancelAuth,
    }),
    [authError, cancelAuth, loginLoading, loginProvider, loginWithGoogle, loginWithMicrosoft, logout, logoutAllDevices],
  )

  return (
    <DesktopAuthContext.Provider value={value}>
      {children}
    </DesktopAuthContext.Provider>
  )
}

export function DashboardAuthActionsProvider({ children }: { children: ReactNode }) {
  const { logout, logoutAllDevices } = useLogoutActions()

  const loginWithGoogle = useCallback(async () => {
    throw new Error('Login is only available in the auth window')
  }, [])
  const loginWithMicrosoft = useCallback(async () => {
    throw new Error('Login is only available in the auth window')
  }, [])

  const value = useMemo<DesktopAuthActions>(
    () => ({
      authError: null,
      loginLoading: false,
      loginProvider: null,
      logout,
      logoutAllDevices,
      loginWithGoogle,
      loginWithMicrosoft,
      cancelAuth: () => undefined,
    }),
    [loginWithGoogle, loginWithMicrosoft, logout, logoutAllDevices],
  )

  return (
    <DesktopAuthContext.Provider value={value}>
      {children}
    </DesktopAuthContext.Provider>
  )
}

export function useDesktopAuthActions() {
  const context = useContext(DesktopAuthContext)
  if (!context) {
    throw new Error('useDesktopAuthActions must be used within a desktop auth provider')
  }
  return context
}
