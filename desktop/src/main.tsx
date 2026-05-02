import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import DashboardApp from './DashboardApp.tsx'
import './index.css'

function syncSystemThemeToDom() {
  if (typeof window === 'undefined') return
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (!media) return

  const apply = () => {
    document.documentElement.classList.toggle('dark', media.matches)
  }

  apply()

  if ('addEventListener' in media) {
    media.addEventListener('change', apply)
  }
}

syncSystemThemeToDom()

const params = new URLSearchParams(window.location.search)
const view = params.get('view')

const RootComponent =
  view === 'dashboard'
      ? <DashboardApp />
      : <App />

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {RootComponent}
  </React.StrictMode>,
)

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
