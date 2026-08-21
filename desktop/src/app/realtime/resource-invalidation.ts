import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { queryKeys } from '@/lib/query-keys'
import type { ResourceChangedEvent, ResourceName } from '@/app/realtime/types'

const resources = new Set<ResourceName>([
  'vocabulary',
  'calendar_settings',
  'calendar_events',
  'billing_status',
  'extract_fields',
  'email_draft_settings',
  'summary_templates',
])

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isResourceChangedEvent(value: unknown): value is ResourceChangedEvent {
  if (!isRecord(value)) return false
  if (value.version !== 1) return false
  if (typeof value.event_id !== 'string' || !uuidPattern.test(value.event_id)) return false
  if (typeof value.resource !== 'string' || !resources.has(value.resource as ResourceName)) return false
  if (value.resource_id !== undefined && (typeof value.resource_id !== 'string' || !uuidPattern.test(value.resource_id))) return false
  if (typeof value.occurred_at !== 'string' || !Number.isFinite(Date.parse(value.occurred_at))) return false
  return true
}

export function resourceQueryKeys(accountID: string, resource: ResourceName): readonly QueryKey[] {
  switch (resource) {
    case 'vocabulary':
      return [queryKeys.vocabulary(accountID)]
    case 'calendar_settings':
      return [queryKeys.calendarSettings(accountID), queryKeys.calendarEvents(accountID)]
    case 'calendar_events':
      return [queryKeys.calendarEvents(accountID)]
    case 'billing_status':
      return [queryKeys.billingStatus(accountID)]
    case 'extract_fields':
      return [queryKeys.extractFields(accountID)]
    case 'email_draft_settings':
      return [queryKeys.emailDraftSettings(accountID)]
    case 'summary_templates':
      return [queryKeys.summaryTemplates(accountID)]
  }
}

export function invalidateResource(queryClient: QueryClient, accountID: string, resource: ResourceName) {
  return invalidateResources(queryClient, accountID, [resource])
}

export function invalidateResources(queryClient: QueryClient, accountID: string, resourcesToInvalidate: ResourceName[]) {
  const uniqueKeys = new Map<string, QueryKey>()
  for (const resource of resourcesToInvalidate) {
    for (const queryKey of resourceQueryKeys(accountID, resource)) {
      uniqueKeys.set(JSON.stringify(queryKey), queryKey)
    }
  }
  return Promise.all([...uniqueKeys.values()].map((queryKey) => (
    queryClient.invalidateQueries({ queryKey })
  )))
}

export function invalidateAccount(queryClient: QueryClient, accountID: string) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.account(accountID) })
}

export function createResourceInvalidationBatcher(
  flush: (resources: ResourceName[]) => void,
  delay = 100,
) {
  const pending = new Set<ResourceName>()
  let timer: ReturnType<typeof setTimeout> | null = null

  return {
    add(resource: ResourceName) {
      pending.add(resource)
      if (timer !== null) return
      timer = setTimeout(() => {
        timer = null
        const batch = [...pending]
        pending.clear()
        flush(batch)
      }, delay)
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pending.clear()
    },
  }
}
