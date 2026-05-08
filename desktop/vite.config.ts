import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  define: {
    // Embed Firebase config at build time
    __FIREBASE_CONFIG__: JSON.stringify({
      apiKey: process.env.VITE_FIREBASE_API_KEY || 'AIzaSyCXpAhp5TRtthtYgmjRBAKvapzXJi_udjg',
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || 'orion-1e6a1.firebaseapp.com',
      projectId: process.env.VITE_FIREBASE_PROJECT_ID || 'orion-1e6a1',
      storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || 'orion-1e6a1.firebasestorage.app',
      messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '861156340434',
      appId: process.env.VITE_FIREBASE_APP_ID || '1:861156340434:web:a62b156a38d70b60c9f30b'
    })
  },
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: 'electron/main.ts',
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
