import { authenticatedFetch } from '@/features/auth/auth-session'
import { API_BASE_URL } from '@/lib/api-config'

export type AccountVocabulary = {
  terms: string[]
  created_at?: string
  updated_at?: string
}

type VocabularyResponse = {
  vocabulary?: AccountVocabulary
  code?: string
  error?: string
}

async function readVocabularyResponse(response: Response): Promise<AccountVocabulary> {
  const payload = await response.json().catch(() => ({})) as VocabularyResponse
  if (!response.ok || !payload.vocabulary) {
    throw new Error(payload.error || 'Vocabulary is unavailable')
  }
  return {
    ...payload.vocabulary,
    terms: Array.isArray(payload.vocabulary.terms) ? payload.vocabulary.terms : [],
  }
}

export async function getVocabulary(signal?: AbortSignal): Promise<AccountVocabulary> {
  const response = await authenticatedFetch(`${API_BASE_URL}/vocabulary`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  return readVocabularyResponse(response)
}

export async function putVocabulary(terms: string[]): Promise<AccountVocabulary> {
  const response = await authenticatedFetch(`${API_BASE_URL}/vocabulary`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ terms }),
  })
  return readVocabularyResponse(response)
}
