import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedFetch } from '@/features/auth/auth-session'
import { createExtractField, listExtractFields } from '@/features/settings/sections/extracts/extract-fields-client'

vi.mock('@/features/auth/auth-session', () => ({ authenticatedFetch: vi.fn() }))

const mockedFetch = vi.mocked(authenticatedFetch)

describe('extract fields client', () => {
  beforeEach(() => mockedFetch.mockReset())

  it('maps multi-folder API fields to renderer types', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({
      fields: [{
        id: 'field-1',
        name: 'Pain points',
        prompt: 'Find pain points',
        insight_cardinality: 'multiple',
        scope: { type: 'folders', folders: [{ id: 'folder-1', name: 'Sales', available: true }] },
        created_at: '2026-08-20T00:00:00Z',
        updated_at: '2026-08-20T00:00:00Z',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const fields = await listExtractFields()
    expect(fields[0].scope).toEqual({
      type: 'folders',
      folders: [{ id: 'folder-1', name: 'Sales', available: true }],
    })
  })

  it('serializes a multi-folder create request', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({
      field: {
        id: 'field-1',
        name: 'Pain points',
        prompt: 'Find pain points',
        insight_cardinality: 'multiple',
        scope: { type: 'folders', folders: [] },
        created_at: '2026-08-20T00:00:00Z',
        updated_at: '2026-08-20T00:00:00Z',
      },
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }))

    await createExtractField({
      name: 'Pain points',
      prompt: 'Find pain points',
      insightCardinality: 'multiple',
      scope: { type: 'folders', folderIds: ['folder-1', 'folder-2'] },
    })

    const init = mockedFetch.mock.calls[0][1]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      scope: { type: 'folders', folder_ids: ['folder-1', 'folder-2'] },
    })
  })
})
