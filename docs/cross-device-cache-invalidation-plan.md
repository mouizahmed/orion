# Cross-device cache invalidation — reusable implementation plan

## Implementation status (2026-08-20)

Phases 1–4 and the shared registration infrastructure are implemented. The `extract_fields` contract and query key are registered so the future Extract CRUD can publish without adding another WebSocket bridge; its publisher remains intentionally deferred until that CRUD exists. Authentication/session state and existing domain events were not migrated.

Backend tests, vet, and build pass; desktop TypeScript, lint, renderer/main/preload production bundles, and NSIS packaging pass. On this Windows host Electron Builder's initial unpack-directory rename was denied by the filesystem, so packaging was verified from the successfully generated prepackaged directory instead.

## Goal

Create one reusable system that tells every active Orion client when cached server data has changed outside that client. The system should prevent each feature from inventing its own WebSocket topic, backend fan-out code, query-key mapping, or reconnect behavior.

The system must:

- Deliver account-scoped invalidation hints to all active devices and sessions.
- Work when devices are connected to different backend instances.
- Integrate directly with the shared TanStack Query cache.
- Contain no setting values, prompts, tokens, emails, or other sensitive data in client events.
- Remain correct when events are duplicated, delayed, reordered, or missed.
- Keep normal API responses and database state authoritative.
- Preserve domain-specific events that carry live UI state, such as calendar sync progress.
- Make adding a future cached resource a small, documented registration task.

## Design principle

Push invalidation is appropriate for cached resources that may change from another device, webhook, background worker, administrator, or integration callback. It is not a replacement for normal cache freshness policies.

Use three consistency classes:

| Class | Behavior | Examples |
|---|---|---|
| Immediate invalidation | Publish after every committed change | Calendar connections/visibility, billing status, access/sharing state |
| Eventual refresh | Publish when convenient; stale-time/focus refresh is sufficient fallback | Vocabulary, Extract fields, templates, preferences |
| Long-lived/static | No push event; invalidate only on known local changes or deployment | Plan catalog, static reference data |

An invalidation event means only “the cached representation may be stale.” Receiving clients refetch through the authenticated API. Events never contain the replacement state.

## Current architecture

### Backend

- `backend/internal/handlers/ws_hub.go` tracks sockets by `userID` and sends a message to every socket for that user.
- `backend/internal/handlers/ws.go` authenticates each socket through the same active-principal checks used by HTTP.
- `calendar.sync_status` is currently emitted directly through the local `WsHub`.
- The hub is process-local, so a mutation handled by backend instance A cannot currently notify a socket connected to instance B.
- Redis is already required and initialized in `backend/cmd/api/main.go` for queues, rate limits, OAuth state, and calendar locks.

### Desktop

- `desktop/src/lib/ws-client.ts` maintains one authenticated reconnecting WebSocket and dispatches typed events.
- `desktop/src/types/ws-events.ts` is the client event contract.
- TanStack Query uses account-prefixed keys from `desktop/src/lib/query-keys.ts`.
- `CalendarQueryEvents.tsx` currently contains Calendar-specific query invalidation behavior.

## Event contract

Add one server event type:

```json
{
  "type": "resource.changed",
  "data": {
    "version": 1,
    "event_id": "c57e5ae0-6b7b-4ddd-8357-7673d663eef8",
    "resource": "calendar_settings",
    "resource_id": null,
    "occurred_at": "2026-08-19T18:30:00Z"
  }
}
```

Fields:

| Field | Required | Purpose |
|---|---|---|
| `version` | Yes | Event schema version; initially `1` |
| `event_id` | Yes | Unique identifier for tracing and optional duplicate suppression |
| `resource` | Yes | Allowlisted resource name mapped to query keys |
| `resource_id` | No | Optional entity ID for targeted invalidation when a resource supports it |
| `occurred_at` | Yes | Server timestamp for diagnostics, not conflict resolution |

The internal Redis envelope additionally contains `account_id`, because subscribers need it for routing:

```json
{
  "account_id": "...",
  "event": {
    "version": 1,
    "event_id": "...",
    "resource": "calendar_settings",
    "resource_id": null,
    "occurred_at": "..."
  }
}
```

Do not forward `account_id` to the renderer. The authenticated WebSocket route already determines which account receives the event.

### Initial resource allowlist

Define the resource names once in backend and desktop types:

```text
vocabulary
calendar_settings
calendar_events
billing_status
extract_fields
```

Add future values deliberately. Unknown values must be ignored by clients and rejected by backend publisher construction.

Do not use arbitrary query-key strings supplied by HTTP clients. Only backend code chooses a resource enum after a successful authorized mutation.

## Backend event infrastructure

### Package

Add `backend/internal/resourceevents/`:

```text
resourceevents/
  event.go       # Resource enum, event/envelope structs, validation
  publisher.go   # Publish account-scoped events to Redis
  subscriber.go  # Subscribe and dispatch envelopes to the local WebSocket hub
```

Suggested API:

```go
type Resource string

const (
    ResourceVocabulary       Resource = "vocabulary"
    ResourceCalendarSettings Resource = "calendar_settings"
    ResourceCalendarEvents   Resource = "calendar_events"
    ResourceBillingStatus    Resource = "billing_status"
    ResourceExtractFields    Resource = "extract_fields"
)

type Change struct {
    Version    int       `json:"version"`
    EventID    string    `json:"event_id"`
    Resource   Resource  `json:"resource"`
    ResourceID *string   `json:"resource_id,omitempty"`
    OccurredAt time.Time `json:"occurred_at"`
}

type Publisher interface {
    PublishChanged(ctx context.Context, accountID string, resource Resource, resourceID *string) error
}
```

The publisher accepts the authenticated account ID as a Go argument. It must never take account identity from a JSON request field.

### Redis transport

Use a dedicated Redis Pub/Sub channel such as:

```text
orion:resource-events:v1
```

Flow:

```text
Committed mutation
       │
       ▼
Resource event publisher
       │ Redis Pub/Sub
       ├───────────────┬───────────────┐
       ▼               ▼               ▼
API instance A    API instance B  API instance C
local WsHub       local WsHub      local WsHub
       │               │               │
       ▼               ▼               ▼
all user sockets connected to each instance
```

Every API instance starts one subscriber and forwards valid envelopes to its local hub:

```go
hub.SendToUser(envelope.AccountID, map[string]any{
    "type": "resource.changed",
    "data": envelope.Event,
})
```

All events, including those produced by the current instance, should travel through Redis and return through its subscriber. Do not both send locally and publish to Redis, because that creates guaranteed duplicate delivery on the originating instance.

Redis Pub/Sub is intentionally ephemeral. Missing an event must not break correctness because reconnect, focus refresh, stale-time revalidation, and manual refresh still read authoritative state.

### Startup and shutdown

In `backend/cmd/api/main.go`:

1. Construct the resource event publisher with the existing Redis client.
2. Start one subscriber with the API process context.
3. Pass the local `WsHub` to the subscriber, not to every mutation handler for generic invalidation.
4. Stop the subscriber during graceful shutdown before closing Redis.

Subscriber requirements:

- Reject malformed JSON and unsupported versions/resources.
- Apply a maximum message size before unmarshalling.
- Log event ID and resource, but do not log account IDs at normal verbosity.
- Recover from subscription interruption with bounded backoff.
- Exit promptly when the process context is canceled.

### Publish failure behavior

Publish only after the database mutation has succeeded or its transaction has committed.

If Redis publication fails:

- Do not roll back or report failure for an already committed user mutation.
- Log and increment a metric.
- Let stale-time, focus, reconnect, or manual refresh recover.

This system distributes invalidation hints, not durable business events. A transactional outbox is unnecessary initially. If a future security-critical workflow requires guaranteed delivery, it should use its own durable event/outbox mechanism rather than silently changing this contract.

## Backend integration points

Inject `resourceevents.Publisher` into handlers/services that own mutations. Publish one event after each successful change.

### Calendar settings

Publish `calendar_settings` after:

- Integration OAuth connection completion
- Integration disconnection
- Calendar visibility update
- Any future calendar-account rename or preference update

These changes also affect which events are returned. Either:

- Publish both `calendar_settings` and `calendar_events`, or
- Define the desktop invalidation registry so `calendar_settings` invalidates both queries.

Prefer the second option to avoid duplicate events and centralize dependency mapping.

Keep `calendar.sync_status` as a separate event because it carries live progress metadata. On successful sync completion, publish `calendar_events`; the generic event replaces Calendar-specific query invalidation currently embedded in the sync-status bridge.

### Vocabulary

Publish `vocabulary` after a successful `PUT /api/vocabulary`.

The originating client already updates its cache from the canonical response. It may receive the same account event and perform one redundant background validation. Accept this initially; request deduplication limits overlap, and correctness is more valuable than adding mutation-origin tracking.

### Billing

Publish `billing_status` after a Stripe webhook transaction changes effective billing/subscription state.

Do not rely only on the Electron return event. A webhook can arrive while another device is open, and subscription state may change without a checkout return on that device.

Keep the current Stripe confirmation polling as a fallback for the initiating client.

### Extract fields

When Extract settings CRUD is implemented, publish `extract_fields` after successful create, update, or delete. No new WebSocket topic or bridge should be needed.

### Authentication and identity

Do not route session revocation, suspension, deletion, or token lifecycle through `resource.changed`.

- Keep `WsHub.DisconnectUser` for session/account revocation.
- Keep `AuthContext` and Electron main-process authentication authoritative.
- If cross-device profile changes are later required, define a separate typed identity event that triggers auth/profile revalidation rather than putting the authenticated user into the query cache.

## Desktop invalidation infrastructure

### Event type

Update `desktop/src/types/ws-events.ts`:

```ts
export type ResourceName =
  | 'vocabulary'
  | 'calendar_settings'
  | 'calendar_events'
  | 'billing_status'
  | 'extract_fields'

export type ResourceChangedEvent = {
  version: 1
  event_id: string
  resource: ResourceName
  resource_id?: string
  occurred_at: string
}

export interface ServerEventMap {
  'resource.changed': ResourceChangedEvent
  // existing domain events remain
}
```

Validate the runtime payload before invalidating anything. TypeScript types alone do not validate WebSocket JSON.

### Query invalidation registry

Add `desktop/src/lib/resource-invalidation.ts` with one exhaustive mapping from resource names to query keys:

```ts
type InvalidationContext = {
  accountID: string
  resourceID?: string
}

const invalidators: Record<ResourceName, (
  queryClient: QueryClient,
  context: InvalidationContext,
) => Promise<void>> = {
  vocabulary: async (client, { accountID }) => {
    await client.invalidateQueries({ queryKey: queryKeys.vocabulary(accountID) })
  },
  calendar_settings: async (client, { accountID }) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.calendarSettings(accountID) }),
      client.invalidateQueries({ queryKey: queryKeys.calendarEvents(accountID) }),
    ])
  },
  calendar_events: async (client, { accountID }) => {
    await client.invalidateQueries({ queryKey: queryKeys.calendarEvents(accountID) })
  },
  billing_status: async (client, { accountID }) => {
    await client.invalidateQueries({ queryKey: queryKeys.billingStatus(accountID) })
  },
  extract_fields: async (client, { accountID }) => {
    await client.invalidateQueries({ queryKey: queryKeys.extractFields(accountID) })
  },
}
```

Add `queryKeys.extractFields` when the Extract settings query is introduced. Until then, the registry can omit that resource or map it only after the query key exists; backend publication should begin with the consuming feature.

The mapping is the single place to express dependencies. Feature components must not subscribe directly to `resource.changed`.

### Shared bridge

Add `desktop/src/components/ServerStateInvalidationBridge.tsx` under `QueryClientProvider` and inside the authenticated session boundary.

Responsibilities:

1. Read the current authenticated account ID from `AuthContext`.
2. Subscribe once to `resource.changed` through `wsClient`.
3. Validate `version`, `event_id`, `resource`, optional ID, and timestamp.
4. Call the registered invalidator for the active account.
5. Ignore malformed, unknown-version, and unknown-resource events.
6. Batch duplicate resource events received in the same short window so bursts produce one query invalidation/refetch.
7. On WebSocket transition to `connected`, invalidate the current account query prefix once to recover events missed while disconnected.

Reconnect invalidation should mark queries stale. TanStack Query will refetch active observers immediately; inactive queries remain cached but stale until next use. Cached data should stay visible during these background requests.

### Duplicate and ordering behavior

Invalidation is idempotent, so duplicate and out-of-order events are safe. Do not use `occurred_at` to decide whether server data should be accepted; API responses remain authoritative.

Keep a small bounded set of recent `event_id` values only if metrics show Redis or reconnect behavior creates excessive duplicates. Do not add persistent event deduplication storage.

### Originating client

Local mutations continue to update/invalidate their own queries even though a push event will follow. This protects correctness if Redis publication fails.

Do not add origin-device suppression in the first version. Adding HTTP mutation IDs, socket IDs, and recent-origin registries would increase complexity for a minor redundant background refetch. Revisit only with measured request-volume evidence.

## Feature registration checklist

When adding a new cached resource that needs cross-device freshness:

1. Add the backend `Resource` enum value.
2. Add the desktop `ResourceName` value.
3. Add or reuse its account-scoped query key.
4. Register its invalidation function and dependent queries.
5. Publish after every successful mutation or background change.
6. Keep local mutation cache updates/rollback behavior.
7. Add reconnect, duplicate-event, and cross-account tests.
8. Document its consistency class and fallback freshness policy.

If steps 1–4 require a feature-specific WebSocket subscription, the shared abstraction is incomplete and should be extended rather than bypassed.

## Observability

Add backend metrics:

- `resource_events_published_total{resource}`
- `resource_events_publish_failures_total{resource}`
- `resource_events_received_total{resource}`
- `resource_events_invalid_total{reason}`
- `resource_events_ws_deliveries_total{resource}`

Add structured debug logging keyed by `event_id` and `resource`. Avoid user/account identifiers in routine logs.

Client diagnostics in development may record:

- Event resource and ID
- Whether the event was accepted, ignored, or batched
- Which query families were invalidated

Do not log query data or resource values.

## Security requirements

- WebSocket authentication and active-principal revalidation remain unchanged.
- Redis is an internal transport and must use the existing authenticated/TLS deployment configuration.
- Only server code can publish an account ID and allowlisted resource.
- Client-sent WebSocket messages cannot trigger `resource.changed` fan-out.
- The subscriber validates size, JSON shape, schema version, account UUID, resource enum, event UUID, and timestamp.
- Renderer events contain no account ID or resource contents.
- Query keys remain account-scoped and are removed on logout/account change.
- Receiving an event never grants access; subsequent API requests perform normal authorization.

## Delivery phases

### Phase 1 — Contract and registry

- Add backend resource enum/event validation.
- Add desktop event types and runtime validator.
- Add the desktop invalidation registry.
- Add the shared invalidation bridge without publishing events yet.

Deliverable: the system compiles, but product behavior is unchanged.

### Phase 2 — Multi-instance event bus

- Add Redis publisher/subscriber.
- Wire subscriber lifecycle in `main.go`.
- Forward subscribed envelopes through the local `WsHub`.
- Add bounded backoff, validation, metrics, and graceful shutdown.

Deliverable: a test publisher reaches all sockets across two backend instances.

### Phase 3 — Calendar proof

- Publish `calendar_settings` after connect, disconnect, and visibility changes.
- Publish `calendar_events` after completed sync.
- Keep `calendar.sync_status` for live sync metadata.
- Remove Calendar-specific generic invalidation now handled by the shared bridge.

Deliverable: disconnecting an account or hiding a calendar on device A updates device B without manual navigation or focus changes.

### Phase 4 — Vocabulary and Billing

- Publish `vocabulary` after save.
- Publish `billing_status` after committed webhook reconciliation.
- Preserve local optimistic updates and Stripe confirmation polling.

Deliverable: remote changes revalidate all active devices without feature-specific subscriptions.

### Phase 5 — Extracts and future resources

- Register and publish `extract_fields` alongside initial Extract settings CRUD.
- Add the feature registration checklist to contributor documentation.

### Phase 6 — Cleanup and hardening

- Search for feature components subscribing to generic change topics.
- Consolidate those mappings into the registry.
- Verify reconnect recovery and cache isolation.
- Review metrics for event/refetch storms before adding origin suppression.

## Verification

### Backend unit tests

- Valid resource changes serialize to the version-1 contract.
- Unsupported resource/version and malformed account/event IDs are rejected.
- Publisher never accepts an empty account ID.
- Subscriber ignores oversized or malformed messages without stopping.
- Publish failure is logged/recorded without changing a successful mutation response.

### Backend integration tests

- Start two hubs/subscribers with the same Redis instance.
- Register user sockets on both instances.
- Publish from instance A and verify sockets on A and B each receive one event.
- Verify another user's sockets receive nothing.
- Stop/restart a subscriber and verify it resumes receiving new events.
- Confirm missed Pub/Sub events are not replayed, by design.

### Desktop tests

- Each allowlisted resource maps to the expected account-scoped query keys.
- `calendar_settings` invalidates both settings and events.
- Unknown/malformed events invalidate nothing.
- Duplicate events result in at most one refetch per batched resource window.
- Logout during event handling cannot recreate the previous account's query cache.
- Reconnect marks the current account queries stale without clearing displayed data.

### Cross-device scenarios

- Disconnect a calendar account on device A; device B removes it after receiving the event.
- Change calendar visibility on A; B refreshes settings and upcoming events.
- Save Vocabulary on A; B refreshes cached terms while keeping existing content visible.
- Process a Stripe webhook; all active devices refresh billing status.
- Disconnect B from the network, make changes on A, then reconnect B; B recovers through prefix invalidation even though Pub/Sub did not replay missed events.

### Security scenarios

- Attempt to send a client-originated `resource.changed` message; the backend ignores it.
- Publish an event for account A; account B receives nothing.
- Sign out while an invalidation refetch is in flight; the request is canceled and old account queries are removed.
- Inspect WebSocket frames and confirm no resource values or account IDs are exposed.

### Static and build checks

Backend:

```powershell
go test ./...
go vet ./...
```

Desktop:

```powershell
npm run lint
npx tsc --noEmit
npm run build
```

## Risks and mitigations

### Event storms

Multiple mutations or sync rows may emit repeated events. Publish at logical mutation boundaries, batch client invalidations briefly, and rely on TanStack Query request deduplication.

### Multi-instance duplicate delivery

Route every event through Redis exactly once and never combine direct local send with Redis publication. Treat accidental duplicates as harmless.

### Missed events

Redis Pub/Sub does not replay. Invalidation events are hints; WebSocket reconnect invalidates the account prefix, and normal stale-time/focus/manual refresh remains active.

### Mutation succeeded but publish failed

Do not fail an already committed request. Record the failure and rely on fallback revalidation. Consider an outbox only if a future workflow requires durable business-event delivery.

### Cross-account leakage

Account identity is supplied internally by the authenticated backend, routing occurs before renderer delivery, query keys are account-prefixed, and logout cancels/removes the old prefix.

### Redundant originating-device refetch

Accept it initially. Local cache updates protect against publication failure, and push invalidation guarantees other devices update. Optimize only after measuring meaningful overhead.

## Explicitly deferred

- Durable event replay or transactional outbox
- Sending replacement resource state over WebSockets
- Cross-process cache sharing between Electron renderers
- Origin-device/mutation-ID suppression
- Moving authentication or profile state into TanStack Query
- Replacing domain events that carry live state, such as transcription or calendar sync progress
- Generic client-controlled event publication
