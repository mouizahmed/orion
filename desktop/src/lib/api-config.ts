const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim()

if (!configuredApiBaseUrl) {
  throw new Error('VITE_API_BASE_URL is required')
}

const parsedApiBaseUrl = new URL(configuredApiBaseUrl)
if (
  (parsedApiBaseUrl.protocol !== 'http:' && parsedApiBaseUrl.protocol !== 'https:')
  || parsedApiBaseUrl.username !== ''
  || parsedApiBaseUrl.password !== ''
  || parsedApiBaseUrl.search !== ''
  || parsedApiBaseUrl.hash !== ''
) {
  throw new Error('VITE_API_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment')
}

export const API_BASE_URL = configuredApiBaseUrl.replace(/\/+$/, '')

export function apiWebSocketUrl(path: string) {
  const url = new URL(`${API_BASE_URL}/${path.replace(/^\/+/, '')}`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
