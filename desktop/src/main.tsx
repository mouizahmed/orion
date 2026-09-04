import React from 'react'
import ReactDOM from 'react-dom/client'
import AuthApp from './app/AuthApp.tsx'
import RecordingOverlayApp, { RecordingOverlayFixtureApp } from './app/RecordingOverlayApp.tsx'
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
const isRecordingFixturePreview = import.meta.env.DEV && view === 'recording-fixture'
const isDevelopmentPreview = isChatFoundationPreview || isRecordingFixturePreview

if (!isDevelopmentPreview) syncSystemThemeToDom()

const RootComponent =
  isChatFoundationPreview
    ? <ChatFoundationPreview />
    : isRecordingFixturePreview
      ? <RecordingOverlayFixtureApp />
    : view === 'dashboard'
      ? <DashboardApp />
      : view === 'auth'
        ? <AuthApp />
        : <RecordingOverlayApp />

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {RootComponent}
  </React.StrictMode>,
)

if (!isDevelopmentPreview) {
  desktopApi.appEvents.onMainProcessMessage((message) => {
    console.log(message)
  })
}
