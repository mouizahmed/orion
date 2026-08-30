import React from 'react'
import ReactDOM from 'react-dom/client'
import OverlayApp from './app/OverlayApp.tsx'
import DashboardApp from './app/DashboardApp.tsx'
import ChatFoundationPreview from './features/chat/dev/ChatFoundationPreview.tsx'
import './index.css'
import { desktopApi } from './lib/desktop-api'

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

const params = new URLSearchParams(window.location.search)
const view = params.get('view')
const isChatFoundationPreview = import.meta.env.DEV && view === 'chat-foundation'

if (!isChatFoundationPreview) syncSystemThemeToDom()

const RootComponent =
  isChatFoundationPreview
    ? <ChatFoundationPreview />
    : view === 'dashboard'
      ? <DashboardApp />
      : <OverlayApp />

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {RootComponent}
  </React.StrictMode>,
)

if (!isChatFoundationPreview) {
  desktopApi.appEvents.onMainProcessMessage((message) => {
    console.log(message)
  })
}
