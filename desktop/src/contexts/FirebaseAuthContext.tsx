import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { auth, onIdTokenChanged } from '@/config/firebase'
import {
  authenticatedFetch,
  clearKnownSessionStorage,
  getAuthenticatedIdToken,
  invalidateSession,
} from '@/lib/auth-session'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'

export interface User {
  id: string
  email: string
  name: string
  picture?: string
}

interface FirebaseAuthContextType {
  user: User | null
  status: SessionStatus
  isAuthenticated: boolean
  isLoading: boolean
  getIdToken: () => Promise<string>
  updateProfileName: (name: string) => Promise<User>
  uploadProfileAvatar: (file: File) => Promise<User>
  signOutLocal: () => Promise<void>
}

const FirebaseAuthContext = createContext<FirebaseAuthContextType | undefined>(undefined)

export type SessionStatus = 'initializing' | 'validating' | 'authenticated' | 'anonymous'

const CACHED_USER_KEY = 'orion:cached-user'

function saveCachedUser(user: User) {
  try {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user))
  } catch {
    // ignore storage errors
  }
}

function clearCachedUser() {
  localStorage.removeItem(CACHED_USER_KEY)
}

type BackendUserPayload = {
  id?: unknown
  email?: unknown
  name?: unknown
  avatar_url?: unknown
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function mapBackendUser(data: BackendUserPayload): User {
  return {
    id: asString(data.id),
    email: asString(data.email),
    name: asString(data.name),
    picture: asString(data.avatar_url) || undefined,
  }
}

async function readBackendUser(response: Response): Promise<User> {
  if (!response.ok) {
    throw new Error(`Profile request failed: ${response.status}`)
  }
  const data = await response.json()
  const user = mapBackendUser(data)
  if (!user.id) {
    throw new Error('Profile response did not contain a user ID')
  }
  return user
}

async function fetchBackendUser(): Promise<User> {
  return readBackendUser(await authenticatedFetch(`${API_BASE_URL}/user/me`, {
    headers: {
      Accept: 'application/json',
    },
  }))
}

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<SessionStatus>('initializing')

  useEffect(() => {
    let cancelled = false
    let validationSequence = 0

    const unsubscribe = onIdTokenChanged(auth, (firebaseUser) => {
      const sequence = ++validationSequence
      if (!firebaseUser) {
        setUser(null)
        setStatus('anonymous')
        return
      }

      setUser(null)
      setStatus('validating')

      void fetchBackendUser()
        .then((backendUser) => {
          if (
            cancelled
            || sequence !== validationSequence
            || auth.currentUser?.uid !== backendUser.id
          ) {
            return
          }
          saveCachedUser(backendUser)
          setUser(backendUser)
          setStatus('authenticated')
        })
        .catch((error) => {
          if (cancelled || sequence !== validationSequence) return
          console.warn('Failed to validate restored application session', error)
          void invalidateSession()
        })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const getIdToken = useCallback(async () => {
    return getAuthenticatedIdToken()
  }, [])

  const updateProfileName = useCallback(async (name: string) => {
    const updatedUser = await readBackendUser(await authenticatedFetch(`${API_BASE_URL}/user/me`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    }))
    saveCachedUser(updatedUser)
    setUser(updatedUser)
    return updatedUser
  }, [])

  const uploadProfileAvatar = useCallback(async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    const updatedUser = await readBackendUser(await authenticatedFetch(`${API_BASE_URL}/user/me/avatar`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
      body: formData,
    }))
    saveCachedUser(updatedUser)
    setUser(updatedUser)
    return updatedUser
  }, [])

  const signOutLocal = useCallback(async () => {
    clearCachedUser()
    clearKnownSessionStorage()
    await auth.signOut()
    setUser(null)
    setStatus('anonymous')
  }, [])

  const isLoading = status === 'initializing' || status === 'validating'
  const isAuthenticated = status === 'authenticated'

  const value = useMemo<FirebaseAuthContextType>(
    () => ({
      user,
      status,
      isAuthenticated,
      isLoading,
      getIdToken,
      updateProfileName,
      uploadProfileAvatar,
      signOutLocal,
    }),
    [getIdToken, isAuthenticated, isLoading, signOutLocal, status, updateProfileName, uploadProfileAvatar, user],
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
