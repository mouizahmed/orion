import { app } from 'electron'

// Configuration management for the Electron app
interface AppConfig {
  backendUrl: string
  isDevelopment: boolean
  isProduction: boolean
}

function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function getBackendUrl(): string {
  const envUrl = process.env.BACKEND_URL

  // Default URLs based on environment
  const defaultUrls = {
    development: 'http://localhost:8080',
    production: 'https://api.orionly.app',
  }

  // Use environment variable if provided and valid
  if (envUrl && validateUrl(envUrl)) {
    return envUrl
  }

  // Fall back to defaults
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  return isDev ? defaultUrls.development : defaultUrls.production
}

export const config: AppConfig = {
  backendUrl: getBackendUrl(),
  isDevelopment: process.env.NODE_ENV === 'development' || !app.isPackaged,
  isProduction: process.env.NODE_ENV === 'production' && app.isPackaged,
}
