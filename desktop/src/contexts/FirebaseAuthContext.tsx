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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080/api'

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
  updateProfileName: (name: string) => Promise<User>
  uploadProfileAvatar: (file: File) => Promise<User>
  signOutLocal: () => Promise<void>
}

const FirebaseAuthContext = createContext<FirebaseAuthContextType | undefined>(undefined)

const CACHED_USER_KEY = 'orion:cached-user'

function loadCachedUser(uid: string): User | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as User & { uid?: string }
    return parsed.id === uid ? parsed : null
  } catch {
    return null
  }
}

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

const LOGOUT_STORAGE_KEYS = [
  'dashboard:selectedNoteId',
  'dashboard:selectedFolderId',
  'chat:activeConversationId',
  CACHED_USER_KEY,
]

const LOGOUT_STORAGE_PREFIXES = ['orion:local-meeting-']

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
  return mapBackendUser(data)
}

async function fetchBackendUser(firebaseUser: NonNullable<typeof auth.currentUser>): Promise<User> {
  const idToken = await firebaseUser.getIdToken()
  return readBackendUser(await fetch(`${API_BASE_URL}/user/me`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  }))
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
        if (!firebaseUser) {
          setUser(null)
          setIsLoading(false)
          return
        }

        const cached = loadCachedUser(firebaseUser.uid)
        setUser(cached ?? toUser(firebaseUser))
        setIsLoading(false)

        void fetchBackendUser(firebaseUser)
          .then((backendUser) => {
            if (!cancelled && auth.currentUser?.uid === backendUser.id) {
              saveCachedUser(backendUser)
              setUser(backendUser)
            }
          })
          .catch((error) => {
            console.warn('Failed to hydrate backend user profile', error)
          })
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

  const updateProfileName = useCallback(async (name: string) => {
    const idToken = await getIdToken()
    const updatedUser = await readBackendUser(await fetch(`${API_BASE_URL}/user/me`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    }))
    setUser(updatedUser)
    return updatedUser
  }, [getIdToken])

  const uploadProfileAvatar = useCallback(async (file: File) => {
    const idToken = await getIdToken()
    const formData = new FormData()
    formData.append('file', file)

    const updatedUser = await readBackendUser(await fetch(`${API_BASE_URL}/user/me/avatar`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: formData,
    }))
    setUser(updatedUser)
    return updatedUser
  }, [getIdToken])

  const signOutLocal = useCallback(async () => {
    clearCachedUser()
    clearKnownSessionStorage()
    await auth.signOut()
    setUser(null)
  }, [])

  // Keep the main process token fresh so the webRequest interceptor can authorize image proxy requests.
  // Firebase tokens expire after 60 min; push a refresh every 45 min.
  useEffect(() => {
    if (!user) return
    const REFRESH_MS = 45 * 60 * 1000
    const id = setInterval(async () => {
      try {
        const token = await getIdToken()
        window.electronAPI?.refreshToken?.(token)
      } catch {
        // ignore — next interval will retry
      }
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [user, getIdToken])

  const value = useMemo<FirebaseAuthContextType>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      setUser,
      getIdToken,
      updateProfileName,
      uploadProfileAvatar,
      signOutLocal,
    }),
    [getIdToken, isLoading, signOutLocal, updateProfileName, uploadProfileAvatar, user],
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
