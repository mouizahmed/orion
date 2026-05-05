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


export interface DesktopAuthActions {
  authError: string | null
  loginLoading: boolean
  loginProvider: LoginProvider | null
  logout: () => Promise<void>
  loginWithGoogle: () => Promise<void>
  loginWithMicrosoft: () => Promise<void>
  cancelAuth: () => void
}

type LoginProvider = 'google' | 'microsoft'

const DesktopAuthContext = createContext<DesktopAuthActions | undefined>(undefined)

function useLogoutActions() {
  const { signOutLocal } = useFirebaseAuth()

  const logout = useCallback(async () => {
    try {
      await signOutLocal()
      await desktopApi.auth.logout()
    } catch (error) {
      console.error('Logout error:', error)
    }
  }, [signOutLocal])

  return { logout }
}

export function DesktopAuthProvider({ children }: { children: ReactNode }) {
  const { user, isLoading } = useFirebaseAuth()
  const { logout } = useLogoutActions()
  const [authError, setAuthError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)
  const [loginProvider, setLoginProvider] = useState<LoginProvider | null>(null)
  const authTimeoutRef = useRef<number | null>(null)
  const pendingAuthRef = useRef(false)

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

    desktopApi.auth.notifyStateChanged(Boolean(user))
  }, [isLoading, user])

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

      authTimeoutRef.current = window.setTimeout(() => {
        resetPendingAuth('Authentication timed out. Please try again.', true)
      }, 5 * 60 * 1000)
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
      loginWithGoogle,
      loginWithMicrosoft,
      cancelAuth,
    }),
    [authError, cancelAuth, loginLoading, loginProvider, loginWithGoogle, loginWithMicrosoft, logout],
  )

  return (
    <DesktopAuthContext.Provider value={value}>
      {children}
    </DesktopAuthContext.Provider>
  )
}

export function DashboardAuthActionsProvider({ children }: { children: ReactNode }) {
  const { logout } = useLogoutActions()

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
      loginWithGoogle,
      loginWithMicrosoft,
      cancelAuth: () => undefined,
    }),
    [loginWithGoogle, loginWithMicrosoft, logout],
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
