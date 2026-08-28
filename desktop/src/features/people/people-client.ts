import { authenticatedFetch, getAuthenticatedAccessToken } from '@/features/auth/auth-session'
import type { Person } from '@/features/people/types'
import { API_BASE_URL } from '@/lib/api-config'

type ApiPerson = {
  id: string
  name: string
  email?: string
  created_at: string
  updated_at: string
}

function toPerson(person: ApiPerson): Person {
  return {
    id: person.id,
    name: person.name,
    email: person.email ?? '',
    createdAt: person.created_at,
    updatedAt: person.updated_at,
  }
}

async function fetchJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(input, init)
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error || 'Request failed')
  }
  return (await response.json()) as T
}

export async function listPeople(): Promise<Person[]> {
  const accessToken = await getAuthenticatedAccessToken()
  const payload = await fetchJson<{ people: ApiPerson[] }>(`${API_BASE_URL}/people`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })
  return (payload.people ?? []).map(toPerson)
}

export async function createPerson(input: { name?: string; email: string }): Promise<Person> {
  const accessToken = await getAuthenticatedAccessToken()
  const payload = await fetchJson<{ person: ApiPerson }>(`${API_BASE_URL}/people`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name: input.name?.trim() || undefined, email: input.email.trim() }),
  })
  return toPerson(payload.person)
}

export async function deletePerson(personID: string): Promise<void> {
  const accessToken = await getAuthenticatedAccessToken()
  const response = await authenticatedFetch(`${API_BASE_URL}/people/${personID}`, {
    method: 'DELETE',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string }
    throw new Error(payload.error || 'Could not remove person')
  }
}
