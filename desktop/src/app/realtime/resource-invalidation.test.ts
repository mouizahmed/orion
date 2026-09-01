import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearAccountServerState } from '@/lib/query-client'
import { queryKeys } from '@/lib/query-keys'
import {
  createResourceInvalidationBatcher,
  invalidateAccount,
  invalidateResource,
  invalidateResources,
  isResourceChangedEvent,
} from '@/app/realtime/resource-invalidation'

const validEvent = {
  version: 1,
  event_id: 'c57e5ae0-6b7b-4ddd-8357-7673d663eef8',
  resource: 'vocabulary',
  occurred_at: '2026-08-19T18:30:00Z',
}

afterEach(() => vi.useRealTimers())

describe('resource event validation', () => {
  it('accepts the versioned allowlisted contract', () => {
    expect(isResourceChangedEvent(validEvent)).toBe(true)
  })

  it.each([
    { ...validEvent, version: 2 },
    { ...validEvent, event_id: 'bad' },
    { ...validEvent, resource: 'arbitrary-query-key' },
    { ...validEvent, resource_id: 'bad' },
    { ...validEvent, occurred_at: 'not-a-date' },
    null,
  ])('rejects malformed or unsupported input', (value) => {
    expect(isResourceChangedEvent(value)).toBe(false)
  })
})

describe('resource invalidation registry', () => {
  it.each([
    ['vocabulary', ['vocabulary']],
    ['calendar_settings', ['calendar-settings', 'calendar-events']],
    ['calendar_events', ['calendar-events']],
    ['billing_status', ['billing-status']],
    ['extract_fields', ['extract-fields']],
    ['email_draft_settings', ['email-draft-settings']],
    ['summary_templates', ['summary-templates']],
  ] as const)('maps %s only to its registered account query families', async (resource, families) => {
    const client = new QueryClient()
    const accountID = 'account-a'
    const keys = [
      queryKeys.vocabulary(accountID),
      queryKeys.calendarSettings(accountID),
      queryKeys.calendarEvents(accountID),
      queryKeys.billingStatus(accountID),
      queryKeys.extractFields(accountID),
      queryKeys.emailDraftSettings(accountID),
      queryKeys.summaryTemplates(accountID),
    ]
    for (const key of keys) client.setQueryData(key, {})
    await invalidateResource(client, accountID, resource)
    for (const key of keys) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(families.includes(key[2] as never))
    }
  })

  it.each(['notes', 'folders', 'activity', 'chat'] as const)('accepts and invalidates the new %s resource family', async (resource) => {
    const client = new QueryClient()
    const accountID = 'account-a'
    client.setQueryData(queryKeys.notesByFolder(accountID, null), {})
    client.setQueryData(queryKeys.folders(accountID), {})
    client.setQueryData(queryKeys.activityFiltered(accountID, { sort: 'updated', direction: 'desc', scope: 'owned' }), {})
    client.setQueryData(queryKeys.conversationsScoped(accountID, { noteID: null, folderID: null }), {})
    await invalidateResource(client, accountID, resource)
    expect(client.getQueryCache().findAll({ queryKey: queryKeys.account(accountID) }).some((query) => query.state.isInvalidated)).toBe(true)
  })

  it('invalidates both calendar settings and dependent event data', async () => {
    const client = new QueryClient()
    const accountID = 'account-a'
    client.setQueryData(queryKeys.calendarSettings(accountID), {})
    client.setQueryData(queryKeys.calendarEvents(accountID), {})
    client.setQueryData(queryKeys.vocabulary(accountID), {})
    await invalidateResource(client, accountID, 'calendar_settings')
    expect(client.getQueryState(queryKeys.calendarSettings(accountID))?.isInvalidated).toBe(true)
    expect(client.getQueryState(queryKeys.calendarEvents(accountID))?.isInvalidated).toBe(true)
    expect(client.getQueryState(queryKeys.vocabulary(accountID))?.isInvalidated).toBe(false)
  })

  it('deduplicates overlapping query dependencies in the same batch', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await invalidateResources(client, 'account-a', ['calendar_settings', 'calendar_events'])
    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.calendarSettings('account-a') })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.calendarEvents('account-a') })
  })

  it('keeps reconnect invalidation inside the active account prefix', async () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.vocabulary('account-a'), {})
    client.setQueryData(queryKeys.vocabulary('account-b'), {})
    await invalidateAccount(client, 'account-a')
    expect(client.getQueryState(queryKeys.vocabulary('account-a'))?.isInvalidated).toBe(true)
    expect(client.getQueryState(queryKeys.vocabulary('account-b'))?.isInvalidated).toBe(false)
  })

  it('cancels and removes the signed-out account without touching another account', async () => {
    const client = new QueryClient()
    const aborted = vi.fn()
    const pending = client.fetchQuery({
      queryKey: queryKeys.vocabulary('account-a'),
      queryFn: ({ signal }) => new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => { aborted(); reject(new Error('aborted')) })
      }),
    }).catch(() => undefined)
    client.setQueryData(queryKeys.vocabulary('account-b'), {})
    await clearAccountServerState(client, 'account-a')
    await pending
    expect(aborted).toHaveBeenCalledOnce()
    expect(client.getQueryState(queryKeys.vocabulary('account-a'))).toBeUndefined()
    expect(client.getQueryState(queryKeys.vocabulary('account-b'))).toBeDefined()
  })
})

describe('resource invalidation batching', () => {
  it('coalesces duplicate resources in a short window', () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const batcher = createResourceInvalidationBatcher(flush, 100)
    batcher.add('vocabulary')
    batcher.add('vocabulary')
    batcher.add('billing_status')
    vi.advanceTimersByTime(100)
    expect(flush).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledWith(['vocabulary', 'billing_status'])
  })

  it('cancels pending work during account cleanup', () => {
    vi.useFakeTimers()
    const flush = vi.fn()
    const batcher = createResourceInvalidationBatcher(flush, 100)
    batcher.add('vocabulary')
    batcher.cancel()
    vi.runAllTimers()
    expect(flush).not.toHaveBeenCalled()
  })
})
