import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedFetch } from '@/features/auth/auth-session'
import {
  getEmailDraftSettings,
  patchEmailDraftSettings,
} from '@/features/settings/sections/email-drafts/email-draft-settings-client'

vi.mock('@/features/auth/auth-session', () => ({ authenticatedFetch: vi.fn() }))

const mockedFetch = vi.mocked(authenticatedFetch)

function settingsResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({
    settings: {
      enabled: true,
      include_sharing_link: true,
      draft_prompt: 'Prompt',
      created_at: null,
      updated_at: null,
      ...overrides,
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('email draft settings client', () => {
  beforeEach(() => mockedFetch.mockReset())

  it('maps backend defaults and nullable timestamps', async () => {
    mockedFetch.mockResolvedValue(settingsResponse())

    await expect(getEmailDraftSettings()).resolves.toEqual({
      enabled: true,
      includeSharingLink: true,
      draftPrompt: 'Prompt',
    })
  })

  it('serializes false and an empty prompt in a partial patch', async () => {
    mockedFetch.mockResolvedValue(settingsResponse({ enabled: false, draft_prompt: '' }))

    await patchEmailDraftSettings({ enabled: false, draftPrompt: '' })

    const init = mockedFetch.mock.calls[0][1]
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(String(init?.body))).toEqual({ enabled: false, draft_prompt: '' })
  })

  it('rejects malformed successful responses', async () => {
    mockedFetch.mockResolvedValue(settingsResponse({ enabled: 'yes' }))
    await expect(getEmailDraftSettings()).rejects.toThrow('Email draft settings are unavailable')
  })

  it('surfaces stable API errors', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Draft prompt is too long.' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    }))
    await expect(patchEmailDraftSettings({ draftPrompt: 'Prompt' })).rejects.toThrow('Draft prompt is too long.')
  })
})
