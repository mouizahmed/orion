import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticatedFetchMock, getAuthenticatedAccessTokenMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
  getAuthenticatedAccessTokenMock: vi.fn(),
}))

vi.mock('@/features/auth/auth-session', () => ({
  authenticatedFetch: authenticatedFetchMock,
  getAuthenticatedAccessToken: getAuthenticatedAccessTokenMock,
}))

vi.mock('@/lib/api-config', () => ({
  API_BASE_URL: 'http://api.test',
}))

import { removeNoteAttendee } from '@/features/notes/api/notes-client'

describe('removeNoteAttendee', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset()
    getAuthenticatedAccessTokenMock.mockReset()
    getAuthenticatedAccessTokenMock.mockResolvedValue('access-token')
  })

  it('accepts a successful 204 response without trying to parse JSON', async () => {
    authenticatedFetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(removeNoteAttendee('note-a', 'ada@example.com')).resolves.toBeUndefined()

    expect(authenticatedFetchMock).toHaveBeenCalledWith(
      'http://api.test/notes/note-a/attendees/ada%40example.com',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
