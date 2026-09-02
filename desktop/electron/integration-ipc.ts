import { ipcMain, shell } from 'electron'
import { isKnownRendererSender } from './window'
import { getCurrentAuthTokenForRequest, isRendererAuthenticated } from './auth-handlers'
import { config } from './config'
import { beginIntegrationOAuthTransaction, cancelIntegrationOAuthTransaction } from './protocol-handler'

type IntegrationProvider = 'google' | 'microsoft'

type IntegrationResult = {
  success: boolean
  error?: string
  authInvalid?: boolean
}

function isIntegrationProvider(value: unknown): value is IntegrationProvider {
  return value === 'google' || value === 'microsoft'
}

async function integrationBackendFetch(pathname: string, init: RequestInit): Promise<Response> {
  const send = async (forceRefresh: boolean) => {
    const accessToken = await getCurrentAuthTokenForRequest(forceRefresh)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${accessToken}`)
    return fetch(`${config.backendUrl}${pathname}`, { ...init, headers })
  }

  const response = await send(false)
  if (response.status !== 401) return response
  return send(true)
}

function validatedIntegrationAuthorizationUrl(provider: IntegrationProvider, rawUrl: string): string {
  const parsed = new URL(rawUrl)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('Integration provider returned an unsafe authorization URL')
  }

  const allowed = provider === 'google'
    ? parsed.origin === 'https://accounts.google.com' && parsed.pathname === '/o/oauth2/v2/auth'
    : provider === 'microsoft'
      ? parsed.origin === 'https://login.microsoftonline.com' && parsed.pathname === '/common/oauth2/v2.0/authorize'
      : false

  const expectedRedirect = `${config.backendUrl}/integrations/oauth/callback`
  const state = parsed.searchParams.get('state') || ''
  const scopes = (parsed.searchParams.get('scope') || '').split(/\s+/).filter(Boolean)
  const allowedScopes = provider === 'google'
    ? new Set(['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.readonly'])
    : new Set(['openid', 'email', 'profile', 'offline_access', 'User.Read', 'Calendars.Read'])
  const singletonParameters = ['response_type', 'redirect_uri', 'client_id', 'state', 'scope']

  if (
    !allowed
    || singletonParameters.some((name) => parsed.searchParams.getAll(name).length !== 1)
    || parsed.searchParams.get('response_type') !== 'code'
    || parsed.searchParams.get('redirect_uri') !== expectedRedirect
    || !parsed.searchParams.get('client_id')
    || (parsed.searchParams.get('client_id')?.length ?? 0) > 512
    || !/^[A-Za-z0-9_-]{43}$/.test(state)
    || scopes.length !== allowedScopes.size
    || scopes.some((scope) => !allowedScopes.has(scope))
    || [...allowedScopes].some((scope) => !scopes.includes(scope))
  ) {
    throw new Error('Integration provider returned an unexpected authorization URL')
  }
  return parsed.toString()
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown }
    if (typeof body.error === 'string' && body.error.trim().length > 0) {
      return body.error
    }
    if (typeof body.message === 'string' && body.message.trim().length > 0) {
      return body.message
    }
  } catch {
    // Use the fallback below.
  }
  return fallback
}

export function setupIntegrationIpc() {
  ipcMain.handle(
    'integration:connect',
    async (
      event,
      payload?: { provider?: unknown; feature?: unknown },
    ): Promise<IntegrationResult> => {
      const provider = payload?.provider
      const feature = typeof payload?.feature === 'string' ? payload.feature.trim() : ''

      if (!isKnownRendererSender(event.sender)) {
        return { success: false, error: 'Not authenticated', authInvalid: true }
      }
      if (!isRendererAuthenticated()) return { success: false, error: 'Authentication is unavailable' }
      if (!isIntegrationProvider(provider)) {
        return { success: false, error: 'Unsupported integration provider' }
      }
      if (feature !== 'calendar') {
        return { success: false, error: 'Unsupported integration feature' }
      }

      try {
        const response = await integrationBackendFetch('/api/integrations/connections/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ provider, feature, platform: 'desktop' }),
        })

        if (!response.ok) {
          return {
            success: false,
            error: await readApiError(response, 'Failed to start integration connection'),
            authInvalid: response.status === 401,
          }
        }

        const result = (await response.json()) as { auth_url?: unknown }
        if (typeof result.auth_url !== 'string' || result.auth_url.length === 0) {
          return { success: false, error: 'Integration connection did not return an auth URL' }
        }

        const authorizationURL = validatedIntegrationAuthorizationUrl(provider, result.auth_url)
        const state = new URL(authorizationURL).searchParams.get('state')
        if (!state) {
          return { success: false, error: 'Integration connection did not return a correlation state' }
        }
        beginIntegrationOAuthTransaction(state, provider, 'calendar')
        try {
          await shell.openExternal(authorizationURL)
        } catch (error) {
          cancelIntegrationOAuthTransaction(state)
          throw error
        }
        return { success: true }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    },
  )

  ipcMain.handle(
    'integration:disconnect',
    async (event, payload?: { connectionID?: unknown }): Promise<IntegrationResult> => {
      const connectionID =
        typeof payload?.connectionID === 'string' && payload.connectionID.trim().length > 0
          ? payload.connectionID.trim()
          : null

      if (!isKnownRendererSender(event.sender)) {
        return { success: false, error: 'Not authenticated', authInvalid: true }
      }
      if (!isRendererAuthenticated()) return { success: false, error: 'Authentication is unavailable' }
      if (!connectionID) {
        return { success: false, error: 'Missing connection ID' }
      }

      try {
        const response = await integrationBackendFetch(
          `/api/integrations/connections/${encodeURIComponent(connectionID)}`,
          {
            method: 'DELETE',
          },
        )

        if (!response.ok) {
          return {
            success: false,
            error: await readApiError(response, 'Failed to disconnect integration'),
            authInvalid: response.status === 401,
          }
        }

        return { success: true }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        return { success: false, error: errorMessage }
      }
    },
  )
}
