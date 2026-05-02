import { initializeApp } from 'firebase/app'
import {
  initializeAuth,
  getAuth,
  signInWithCustomToken as firebaseSignInWithCustomToken,
  browserLocalPersistence,
  onAuthStateChanged,
  type Auth,
} from 'firebase/auth'

// Define Firebase config type
interface FirebaseConfig {
  apiKey: string
  authDomain: string
  projectId: string
  storageBucket: string
  messagingSenderId: string
  appId: string
}

// Declare global for build-time Firebase config
declare global {
  const __FIREBASE_CONFIG__: FirebaseConfig
}

// Firebase configuration from build-time constants
// TODO: Add Firebase credentials to vite.config.ts define
const firebaseConfig: FirebaseConfig = __FIREBASE_CONFIG__

// Initialize Firebase
const app = initializeApp(firebaseConfig)

function createAuth() {
  try {
    return initializeAuth(app, {
      persistence: browserLocalPersistence,
    })
  } catch {
    return getAuth(app)
  }
}

const auth = createAuth()
const authPersistenceReady = Promise.resolve()

async function signInWithCustomToken(authInstance: Auth, token: string) {
  return firebaseSignInWithCustomToken(authInstance, token)
}

export { auth, authPersistenceReady, signInWithCustomToken, onAuthStateChanged }
