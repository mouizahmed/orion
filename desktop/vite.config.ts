import { defineConfig, loadEnv } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const developmentFirebaseConfig = {
  apiKey: 'AIzaSyCXpAhp5TRtthtYgmjRBAKvapzXJi_udjg',
  authDomain: 'orion-1e6a1.firebaseapp.com',
  projectId: 'orion-1e6a1',
  storageBucket: 'orion-1e6a1.firebasestorage.app',
  messagingSenderId: '861156340434',
  appId: '1:861156340434:web:a62b156a38d70b60c9f30b',
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const production = mode === 'production'
  const read = (name: string, developmentValue: string) => {
    const value = env[name]?.trim()
    if (value) return value
    if (production) throw new Error(`${name} is required for a production build`)
    return developmentValue
  }
  const firebaseConfig = {
    apiKey: read('VITE_FIREBASE_API_KEY', developmentFirebaseConfig.apiKey),
    authDomain: read('VITE_FIREBASE_AUTH_DOMAIN', developmentFirebaseConfig.authDomain),
    projectId: read('VITE_FIREBASE_PROJECT_ID', developmentFirebaseConfig.projectId),
    storageBucket: read('VITE_FIREBASE_STORAGE_BUCKET', developmentFirebaseConfig.storageBucket),
    messagingSenderId: read('VITE_FIREBASE_MESSAGING_SENDER_ID', developmentFirebaseConfig.messagingSenderId),
    appId: read('VITE_FIREBASE_APP_ID', developmentFirebaseConfig.appId),
  }

  return {
    base: './',
    define: { __FIREBASE_CONFIG__: JSON.stringify(firebaseConfig) },
    plugins: [
      react(),
      tailwindcss(),
      electron({
        main: { entry: 'electron/main.ts' },
        preload: { input: path.join(__dirname, 'electron/preload.ts') },
        renderer: process.env.NODE_ENV === 'test' ? undefined : {},
      }),
    ],
    resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  }
})
