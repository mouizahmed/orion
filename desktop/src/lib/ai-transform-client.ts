import { authenticatedFetch } from '@/lib/auth-session'
import { API_BASE_URL } from '@/lib/api-config'


export type TransformAction = 'improve' | 'fix_grammar' | 'make_shorter' | 'make_longer' | 'change_tone'

export async function transformText(action: TransformAction, text: string): Promise<string> {
  const response = await authenticatedFetch(`${API_BASE_URL}/ai/transform`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ action, text }),
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error || 'Transform failed')
  }

  const payload = (await response.json()) as { result: string }
  return payload.result
}
