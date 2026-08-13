import { app } from 'electron'

// Configuration management for the Electron app
interface AppConfig {
  backendUrl: string
  supabaseUrl: string
  supabasePublishableKey: string
  authCallbackUrl: string
  isDevelopment: boolean
  isProduction: boolean
}

function validatedBackendOrigin(url: string, allowHttp: boolean): string | null {
  try {
    const parsed = new URL(url)
    const allowedProtocol = parsed.protocol === 'https:' || (allowHttp && parsed.protocol === 'http:')
    if (
      !allowedProtocol
      || parsed.username
      || parsed.password
      || (parsed.pathname !== '' && parsed.pathname !== '/')
      || parsed.search
      || parsed.hash
    ) return null
    return parsed.origin
  } catch {
    return null
  }
}

function getBackendUrl(): string {
  const envUrl = process.env.BACKEND_URL
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

  // Default URLs based on environment
  const defaultUrls = {
    development: 'http://localhost:8080',
    production: 'https://api.orion.app',
  }

  // Use environment variable if provided and valid
  if (envUrl) {
    const trustedOrigin = validatedBackendOrigin(envUrl, isDev)
    if (trustedOrigin) return trustedOrigin
  }

  // Fall back to defaults
  return isDev ? defaultUrls.development : defaultUrls.production
}

const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged

function getAuthCallbackUrl(): string {
  const parsed = new URL(__SUPABASE_CONFIG__.authCallbackUrl)
  const allowedProtocol = parsed.protocol === 'https:' || (isDevelopment && parsed.protocol === 'http:')
  if (
    !allowedProtocol
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/auth/callback'
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('AUTH_CALLBACK_URL must be an exact trusted /auth/callback URL')
  }
  return parsed.toString()
}

export const config: AppConfig = {
  backendUrl: getBackendUrl(),
  supabaseUrl: __SUPABASE_CONFIG__.url,
  supabasePublishableKey: __SUPABASE_CONFIG__.publishableKey,
  authCallbackUrl: getAuthCallbackUrl(),
  isDevelopment,
  isProduction: process.env.NODE_ENV === 'production' && app.isPackaged,
}
