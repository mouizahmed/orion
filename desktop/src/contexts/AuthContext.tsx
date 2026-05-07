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
import { WebSocketProvider } from '@/contexts/WebSocketContext'

export type { User }

export function DesktopAuthRoot({ children }: { children: ReactNode }) {
  return (
    <FirebaseAuthProvider>
      <WebSocketProvider>
        <DesktopAuthProvider>{children}</DesktopAuthProvider>
      </WebSocketProvider>
    </FirebaseAuthProvider>
  )
}

export function DashboardAuthRoot({ children }: { children: ReactNode }) {
  return (
    <FirebaseAuthProvider>
      <WebSocketProvider>
        <DashboardAuthActionsProvider>{children}</DashboardAuthActionsProvider>
      </WebSocketProvider>
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
      updateProfileName: firebase.updateProfileName,
      uploadProfileAvatar: firebase.uploadProfileAvatar,
      loginWithGoogle: desktop.loginWithGoogle,
      loginWithMicrosoft: desktop.loginWithMicrosoft,
      cancelAuth: desktop.cancelAuth,
    }),
    [
      desktop.authError,
      desktop.cancelAuth,
      desktop.loginLoading,
      desktop.loginProvider,
      desktop.loginWithGoogle,
      desktop.loginWithMicrosoft,
      desktop.logout,
      firebase.isAuthenticated,
      firebase.isLoading,
      firebase.updateProfileName,
      firebase.uploadProfileAvatar,
      firebase.user,
    ],
  )
}
