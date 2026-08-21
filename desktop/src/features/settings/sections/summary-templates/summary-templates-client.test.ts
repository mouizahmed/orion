import { beforeEach, describe, expect, it, vi } from 'vitest'

import { authenticatedFetch } from '@/features/auth/auth-session'
import { createSummaryTemplate, listSummaryTemplates } from '@/features/settings/sections/summary-templates/summary-templates-client'

vi.mock('@/features/auth/auth-session', () => ({ authenticatedFetch: vi.fn() }))

const mockedFetch = vi.mocked(authenticatedFetch)

describe('summary templates client', () => {
  beforeEach(() => mockedFetch.mockReset())

  it('maps multi-folder API templates to renderer types', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({ templates: [{
      id: 'template-1', name: 'Sales call', prompt: 'Summarize decisions',
      folders: [{ id: 'folder-1', name: 'Sales', available: true }],
      created_at: '2026-08-21T00:00:00Z', updated_at: '2026-08-21T00:00:00Z',
    }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const templates = await listSummaryTemplates()
    expect(templates[0]).toMatchObject({
      id: 'template-1', folders: [{ id: 'folder-1', name: 'Sales', available: true }],
    })
  })

  it('serializes folder IDs for create', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({ template: {
      id: 'template-1', name: 'Sales call', prompt: 'Summarize decisions', folders: [],
      created_at: '2026-08-21T00:00:00Z', updated_at: '2026-08-21T00:00:00Z',
    } }), { status: 201, headers: { 'Content-Type': 'application/json' } }))

    await createSummaryTemplate({ name: 'Sales call', prompt: 'Summarize decisions', folderIds: ['folder-1', 'folder-2'] })
    expect(JSON.parse(String(mockedFetch.mock.calls[0][1]?.body))).toEqual({
      name: 'Sales call', prompt: 'Summarize decisions', folder_ids: ['folder-1', 'folder-2'],
    })
  })

  it('preserves stable conflict codes', async () => {
    mockedFetch.mockResolvedValue(new Response(JSON.stringify({
      code: 'summary_template_folder_conflict', error: 'Already assigned',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } }))
    await expect(createSummaryTemplate({ name: 'Sales', prompt: 'Prompt', folderIds: ['folder-1'] }))
      .rejects.toMatchObject({ code: 'summary_template_folder_conflict', message: 'Already assigned' })
  })
})
