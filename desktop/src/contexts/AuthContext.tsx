import { ReactNode, useMemo } from 'react'
import {
  FirebaseAuthProvider,
  useFirebaseAuth,
  type User,
} from '@/contexts/FirebaseAuthContext'
import {
  DashboardAuthActionsProvider,
  DesktopAuthProvider,
  useDesktopAuthActions,
} from '@/contexts/DesktopAuthContext'

export type { User }

export function DesktopAuthRoot({ children }: { children: ReactNode }) {
  return (
    <FirebaseAuthProvider>
      <DesktopAuthProvider>{children}</DesktopAuthProvider>
    </FirebaseAuthProvider>
  )
}

export function DashboardAuthRoot({ children }: { children: ReactNode }) {
  return (
    <FirebaseAuthProvider>
      <DashboardAuthActionsProvider>{children}</DashboardAuthActionsProvider>
    </FirebaseAuthProvider>
  )
}

export function useAuth() {
  const firebase = useFirebaseAuth()
  const desktop = useDesktopAuthActions()

  return useMemo(
    () => ({
      user: firebase.user,
      isAuthenticated: firebase.isAuthenticated,
      isLoading: firebase.isLoading,
      authError: desktop.authError,
      loginLoading: desktop.loginLoading,
      loginProvider: desktop.loginProvider,
      logout: desktop.logout,
      loginWithGoogle: desktop.loginWithGoogle,
      cancelAuth: desktop.cancelAuth,
    }),
    [
      desktop.authError,
      desktop.cancelAuth,
      desktop.loginLoading,
      desktop.loginProvider,
      desktop.loginWithGoogle,
      desktop.logout,
      firebase.isAuthenticated,
      firebase.isLoading,
      firebase.user,
    ],
  )
}
