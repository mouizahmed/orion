import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { auth, authPersistenceReady, onAuthStateChanged } from '@/config/firebase'

export interface User {
  id: string
  email: string
  name: string
  picture?: string
}

interface FirebaseAuthContextType {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  setUser: (user: User | null) => void
  getIdToken: () => Promise<string>
  signOutLocal: () => Promise<void>
}

const FirebaseAuthContext = createContext<FirebaseAuthContextType | undefined>(undefined)

const LOGOUT_STORAGE_KEYS = [
  'dashboard:selectedNoteId',
  'dashboard:selectedFolderId',
  'chat:activeConversationId',
]

const LOGOUT_STORAGE_PREFIXES = ['orionly:local-meeting-', 'calendar_events_']

export function clearKnownSessionStorage() {
  for (const key of LOGOUT_STORAGE_KEYS) {
    localStorage.removeItem(key)
  }

  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (!key) continue
    if (LOGOUT_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      localStorage.removeItem(key)
    }
  }
}

function toUser(firebaseUser: NonNullable<typeof auth.currentUser>): User {
  return {
    id: firebaseUser.uid,
    email: firebaseUser.email || '',
    name: firebaseUser.displayName || '',
    picture: firebaseUser.photoURL || undefined,
  }
}

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let cancelled = false

    void authPersistenceReady.finally(() => {
      if (cancelled) return

      unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        setUser(firebaseUser ? toUser(firebaseUser) : null)
        setIsLoading(false)
      })
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const getIdToken = useCallback(async () => {
    const idToken = await auth.currentUser?.getIdToken()
    if (!idToken) {
      throw new Error('No authentication token available')
    }
    return idToken
  }, [])

  const signOutLocal = useCallback(async () => {
    clearKnownSessionStorage()
    await auth.signOut()
    setUser(null)
  }, [])

  const value = useMemo<FirebaseAuthContextType>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      setUser,
      getIdToken,
      signOutLocal,
    }),
    [getIdToken, isLoading, signOutLocal, user],
  )

  return (
    <FirebaseAuthContext.Provider value={value}>
      {children}
    </FirebaseAuthContext.Provider>
  )
}

export function useFirebaseAuth() {
  const context = useContext(FirebaseAuthContext)
  if (!context) {
    throw new Error('useFirebaseAuth must be used within FirebaseAuthProvider')
  }
  return context
}
