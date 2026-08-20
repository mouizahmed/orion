# Desktop server-state query cache — implementation plan

> **Status:** Implemented on 2026-08-19. The phased sections below are retained as the design and verification record.

Implementation verification completed with desktop ESLint, TypeScript checking, and production Vite builds for the renderer, Electron main process, and preload. The running development server also transformed each migrated entry module successfully. Electron Builder reached packaging but the local host denied its Electron archive rename with `EPERM`, including in a clean output directory; this is an environment-level packaging condition rather than a compile failure.

## Goal

Introduce one reusable server-state system for the Orion desktop dashboard instead of adding separate caches for each settings page or API resource.

The system must provide:

- Immediate rendering from per-user memory cache
- Silent background revalidation
- In-flight request deduplication
- Resource-specific freshness policies
- Query prefetching where it improves navigation
- Consistent mutation, rollback, and invalidation behavior
- Focus and reconnect refresh
- Strict cache isolation across authenticated users
- A clear distinction between initial loading and background fetching

Use `@tanstack/react-query` as the shared implementation. It already provides query caching, background refetching, prefetching, mutation coordination, and targeted invalidation, avoiding another Orion-specific cache implementation.

Official references:

- [QueryClientProvider](https://tanstack.com/query/latest/docs/framework/react/reference/QueryClientProvider)
- [Important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [Query invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)
- [Prefetching](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching)
- [Window focus refetching](https://tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching)

## Starting state

The dashboard currently has several independent approaches:

- `BillingContext.tsx` owns a module-level `statusCache`, in-flight request map, focus refresh, and Stripe-specific polling.
- `useCalendarEvents.ts` owns a module-level snapshot, subscriber registry, in-flight request, and WebSocket lifecycle.
- `vocabulary-client.ts` owns a module-level per-user cache and in-flight request map.
- Calendar accounts and calendar visibility are fetched directly inside `DashboardSettingsPage.tsx` and visibly reload every time the section is selected.
- Account profile state comes from `AuthContext` and does not need a page-specific cache.

These implementations solve overlapping problems but have different refresh, error, invalidation, and logout behavior. The new system should replace the generic caching parts while preserving domain-specific behavior such as calendar sync events and Stripe checkout confirmation.

## Scope

Migrate these resources:

1. Vocabulary
2. Calendar accounts and visibility settings
3. Upcoming calendar events
4. Billing status

Keep these outside React Query:

- Authenticated user/session state in `AuthContext`
- Local form drafts that have not been submitted
- Recording and shortcut settings obtained through Electron IPC
- WebSocket connection state itself
- Stripe checkout/portal action state
- Calendar sync action state that is not part of an API response

## Dependency and provider foundation

### Install the query package

From `desktop`:

```powershell
npm install @tanstack/react-query
```

Commit the resulting changes to:

- `desktop/package.json`
- `desktop/package-lock.json`

Do not add cache persistence packages. Server responses should remain memory-only and should not be copied into `localStorage`, `sessionStorage`, or `electron-store`.

### Query client

Add `desktop/src/lib/query-client.ts` and export a single dashboard `QueryClient`.

Suggested defaults:

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
})
```

Resource hooks may override `staleTime`, `gcTime`, or refetch behavior where required. Avoid `staleTime: Infinity` for server-owned data because it prevents normal background freshness unless every external change is perfectly invalidated.

### Provider placement

Add `QueryClientProvider` inside `DashboardAuthRoot` and above providers/components that consume server state:

```tsx
<DashboardAuthRoot>
  <QueryClientProvider client={dashboardQueryClient}>
    <ServerStateSessionBoundary>
      <BillingProvider>
        {/* existing dashboard providers */}
      </BillingProvider>
    </ServerStateSessionBoundary>
  </QueryClientProvider>
</DashboardAuthRoot>
```

The overlay application does not need this provider until it consumes one of these dashboard queries.

## Query identity and user isolation

Add `desktop/src/lib/query-keys.ts`. Every authenticated query must begin with the account prefix so all of one user's data can be canceled and removed safely:

```ts
export const queryKeys = {
  account: (accountID: string) => ['account', accountID] as const,
  vocabulary: (accountID: string) => ['account', accountID, 'vocabulary'] as const,
  calendarSettings: (accountID: string) => ['account', accountID, 'calendar-settings'] as const,
  calendarEvents: (accountID: string) => ['account', accountID, 'calendar-events'] as const,
  billingStatus: (accountID: string) => ['account', accountID, 'billing-status'] as const,
}
```

Do not include access tokens, email addresses, prompts, or other sensitive values in query keys.

Add `desktop/src/components/ServerStateSessionBoundary.tsx`:

- Read the active user from `AuthContext`.
- Track the previous authenticated user ID.
- When the user changes or signs out, cancel queries under the previous `queryKeys.account(previousID)` prefix.
- Remove those queries after cancellation so another login cannot recover cached data from the prior account.
- Queries must still use an `enabled: Boolean(user?.id)` guard.
- Fetchers continue to rely on `authenticatedFetch`; a query key is never authorization.

## Shared query behavior

### Loading semantics

Use query state consistently:

- No cached data and first request pending: show the initial loading or skeleton state.
- Cached data present and `isFetching`: keep existing content visible; any refresh indicator must be subtle and non-blocking.
- Background refresh failure: keep cached content and show a non-destructive warning or retry action.
- Initial failure with no data: show the full error and retry state.

Never clear valid cached rows when a background request fails.

### Mutation semantics

For user-visible settings mutations:

1. Cancel relevant in-flight queries in `onMutate`.
2. Snapshot the current cached value.
3. Apply an optimistic cache update when rollback is safe.
4. Restore the snapshot in `onError`.
5. Replace optimistic data with the canonical API response in `onSuccess`.
6. Invalidate dependent queries in `onSettled` or after confirmed success.

Use stable API errors in the UI. React Query should coordinate state, not replace backend validation.

### Focus and reconnect

Use React Query's renderer-window focus and browser online events by default. Verify these events behave correctly in the Electron dashboard window.

If Electron focus behavior is unreliable, configure TanStack's `focusManager` once in `query-client.ts` using the dashboard window's `focus`, `blur`, and document visibility events. Do not add per-resource focus listeners after the shared integration is working.

## Resource plan

### 1. Vocabulary

#### Fetcher and hook

Keep pure HTTP response parsing in `desktop/src/lib/vocabulary-client.ts`, but remove:

- `vocabularyCache`
- `vocabularyRequests`
- `getCachedVocabulary`
- Cache-key parameters that exist only for the hand-written cache

Restore simple fetcher signatures:

```ts
getVocabulary(): Promise<AccountVocabulary>
putVocabulary(terms: string[]): Promise<AccountVocabulary>
```

Add `desktop/src/hooks/useVocabularyQuery.ts`:

```ts
useVocabularyQuery(accountID: string | undefined)
useUpdateVocabularyMutation(accountID: string | undefined)
```

Suggested query policy:

- Query key: `queryKeys.vocabulary(accountID)`
- `enabled`: only with an authenticated account ID
- `staleTime`: 5 minutes
- Preserve cached terms during background refresh

#### Prefetch and rendering

- When `DashboardSettingsPage` mounts, prefetch Vocabulary even if another settings section is selected.
- Do not fetch Vocabulary at dashboard application startup.
- Opening Vocabulary reads the query cache synchronously when available.
- A stale query may refresh silently, but the terms and input remain visible.

#### Autosave

Replace component-owned saving logic with `useUpdateVocabularyMutation` while preserving current behavior:

- Add on Enter and pasted newlines.
- Remove immediately from the visible list.
- Disable the input during the mutation.
- Refocus the input after settlement.
- Roll back to the previous cached terms on failure.
- Replace optimistic terms with the normalized server response on success.
- Do not show generic saved/unsaved status text.

### 2. Calendar accounts and visibility settings

#### Fetcher and types

Move the two direct requests out of `DashboardSettingsPage.tsx` into a dedicated client:

- New: `desktop/src/lib/calendar-settings-client.ts`
- New or shared types: `desktop/src/types/calendar-settings.ts`

The query function should fetch these concurrently and return one atomic snapshot:

```ts
type CalendarSettingsSnapshot = {
  connections: IntegrationConnection[]
  calendars: ConnectedCalendar[]
}
```

Requests:

- `GET /api/integrations/connections`
- `GET /api/calendar/calendars`

If either request fails, reject the combined query. Do not turn a server/network error into an authoritative empty account list.

#### Hook

Add `desktop/src/hooks/useCalendarSettingsQuery.ts`:

```ts
useCalendarSettingsQuery(accountID: string | undefined, enabled: boolean)
useCalendarVisibilityMutation(accountID: string | undefined)
```

Suggested query policy:

- Query key: `queryKeys.calendarSettings(accountID)`
- Enable only while Calendar settings is selected, or while explicitly prefetching it.
- `staleTime`: 1 minute
- Keep cached accounts/calendars on background refresh and error.

#### UI behavior

- First uncached visit may show the existing loader.
- Later visits render cached accounts and calendars immediately.
- Use `isPending` for first-load UI and not `isFetching`.
- A silent revalidation must not replace the list with a loader.
- The existing Retry action calls the query's `refetch()`.

#### Invalidations

Invalidate `calendarSettings(accountID)` after:

- Successful Google/Microsoft connection completion
- Successful account disconnection
- Calendar visibility mutation
- Calendar sync completion WebSocket event

A visibility mutation should optimistically update the selected calendar row. On success, also invalidate `calendarEvents(accountID)` because visible-calendar filtering changes the event set.

### 3. Upcoming calendar events

#### Migrate the shared snapshot

Refactor `desktop/src/hooks/useCalendarEvents.ts` to use React Query and remove its generic cache machinery:

- Module-level `snapshot`
- `subscribers`
- Module-level `inFlight`
- Manual `emit` and `setSnapshot`
- User-owned cache reset code

Retain:

- Event response normalization
- `CalendarEvent` types
- Calendar sync status presentation
- WebSocket integration
- A compatible `useCalendarEvents()` return shape where practical, minimizing changes to `DashboardCalendar.tsx`

Suggested query policy:

- Query key: `queryKeys.calendarEvents(accountID)`
- `staleTime`: 30 seconds
- `gcTime`: at least 30 minutes
- Cached events stay visible during refetch
- Initial errors can show the existing full error state
- Background errors do not erase events

#### WebSocket integration

Create one shared calendar-query event bridge mounted under the query provider, rather than one subscription per component:

- On a sync-start event, update lightweight sync state without clearing events.
- On successful sync completion, invalidate `calendarEvents(accountID)` and `calendarSettings(accountID)`.
- On WebSocket reconnect, invalidate the events query once.
- Avoid refetch loops when the backend continues to report stale or syncing state.

If sync metadata (`syncing`, `stale`, `lastSyncedAt`) remains server state returned by `/calendar/upcoming`, store it in the calendar-events query result. Only truly transient client action flags should remain separate.

#### Dashboard prefetch

After authentication and the initial dashboard render, prefetch upcoming events during an idle callback:

- Do not block authentication or first paint.
- Cancel the scheduled prefetch if the user signs out or changes before it runs.
- Use `queryClient.prefetchQuery()` with the same query key, fetcher, and stale-time policy as `useCalendarEvents()`.
- Include a short `setTimeout` fallback only when `requestIdleCallback` is unavailable.

This makes the first main Calendar navigation normally instant while avoiding a startup-critical request.

### 4. Billing status

Billing is migrated last because it already works and contains Stripe-specific behavior beyond ordinary caching.

#### Preserve the context contract

Keep `BillingProvider` and `useBilling()` so current consumers do not need a broad rewrite. Internally:

- Replace `statusCache` and `statusRequests` with `useQuery`/`queryClient.fetchQuery`.
- Query key: `queryKeys.billingStatus(accountID)`.
- Continue providing the authenticated user's plan as a non-authoritative fallback until the first billing response succeeds.
- Preserve `hasAuthoritativeStatus`, `processingReturn`, and the current action/error contract.

Suggested query policy:

- Fetch as soon as an authenticated dashboard user exists.
- `staleTime`: 30 seconds.
- Refresh stale data on window focus/reconnect.
- Do not clear the last authoritative status on background failure.

#### Stripe events and confirmation polling

Preserve the current checkout and Customer Portal return behavior:

- On `billing_state_changed`, invalidate/refetch billing status.
- For a successful checkout return, continue polling until the professional plan is confirmed or attempts are exhausted.
- For a portal return, continue polling until status differs or attempts are exhausted.
- Use `queryClient.fetchQuery()` or the query's `refetch()` for polling rather than bypassing the cache.
- Clear the pending checkout operation only after confirmation, as today.

Opening Billing settings may request a refresh, but it must render cached status immediately and must share any in-flight request.

## Account settings

Do not migrate Account settings into React Query in this phase.

`AuthContext` owns the current authenticated user, and the dashboard already depends on that state before rendering. Profile name and avatar mutations should continue updating `AuthContext` so all consumers change together. Duplicating the current user into a second query cache would introduce two sources of truth.

## Recommended file changes

| File | Change |
|---|---|
| `desktop/package.json` | Add `@tanstack/react-query` |
| `desktop/package-lock.json` | Lock installed dependency |
| `desktop/src/DashboardApp.tsx` | Mount the query provider and idle calendar prefetch |
| `desktop/src/lib/query-client.ts` | New shared `QueryClient` configuration |
| `desktop/src/lib/query-keys.ts` | New account-scoped query key factory |
| `desktop/src/components/ServerStateSessionBoundary.tsx` | New user-change/logout cache cleanup boundary |
| `desktop/src/lib/vocabulary-client.ts` | Remove bespoke cache; keep pure HTTP functions |
| `desktop/src/hooks/useVocabularyQuery.ts` | New query and mutation hooks |
| `desktop/src/lib/calendar-settings-client.ts` | New atomic settings fetcher |
| `desktop/src/types/calendar-settings.ts` | Shared calendar settings types if needed |
| `desktop/src/hooks/useCalendarSettingsQuery.ts` | New settings query and visibility mutation |
| `desktop/src/hooks/useCalendarEvents.ts` | Replace shared snapshot cache with query-backed implementation |
| `desktop/src/components/CalendarQueryEvents.tsx` | Optional shared WebSocket-to-query invalidation bridge |
| `desktop/src/contexts/BillingContext.tsx` | Replace manual cache/deduplication with query client while retaining Stripe orchestration |
| `desktop/src/components/DashboardSettingsPage.tsx` | Consume Vocabulary and Calendar settings hooks; remove direct fetch/loading state |

Names may be adjusted to existing conventions, but query ownership should remain separated by domain rather than moving all requests into one large context.

## Delivery sequence

Each phase should compile and be behaviorally complete before continuing.

### Phase 1 — Foundation

- Install TanStack Query.
- Add shared query client, keys, provider, and session boundary.
- Verify focus/reconnect behavior in Electron.
- No resource behavior changes yet.

### Phase 2 — Vocabulary

- Add Vocabulary query/mutation hooks.
- Prefetch on Settings mount.
- Replace the recently added bespoke Vocabulary cache.
- Verify autosave rollback and input refocus.

### Phase 3 — Calendar settings

- Extract accounts/visibility requests from the page.
- Add query, visibility mutation, cached rendering, and invalidations.
- Remove visible reloads on repeated Calendar settings visits.

### Phase 4 — Calendar events

- Convert the shared snapshot to a query.
- Add the shared WebSocket invalidation bridge.
- Add post-render idle prefetch.
- Verify event filtering updates after calendar visibility changes.

### Phase 5 — Billing

- Move status fetch/cache into React Query without changing the public context API.
- Preserve Stripe polling and return processing.
- Remove the billing cache and request maps.

### Phase 6 — Cleanup and documentation

- Search for remaining module-level server response caches and direct settings fetches.
- Remove obsolete cache code and duplicate focus listeners.
- Update relevant desktop documentation with the standard query pattern.

## Verification

### Static checks

From `desktop`:

```powershell
npm run lint
npx tsc --noEmit
```

Run the desktop development build and inspect renderer console/network activity.

### Session isolation

- Sign in as user A and open every migrated page.
- Sign out, then sign in as user B without restarting Orion.
- Confirm no user A Vocabulary, calendar, or billing data renders for user B, even briefly.
- Confirm prior account queries are absent from the query cache after logout.

### Vocabulary

- Open Settings: one prefetch occurs.
- Open Vocabulary: cached terms render without a loader.
- Navigate away and back: no blocking loader; stale data refreshes silently.
- Add/remove a term: optimistic state appears, canonical response replaces it, and failure rolls back.
- Input refocuses after the mutation settles.

### Calendar settings

- First uncached visit displays initial loading.
- Later visits immediately show cached accounts/calendars while a stale refresh occurs silently.
- Background request failure preserves the existing list.
- Visibility changes roll back on failure and refresh upcoming events on success.
- Connection, disconnection, and sync completion invalidate the correct queries once.

### Calendar events

- Dashboard startup is not blocked by event prefetch.
- After idle prefetch, first Calendar navigation renders events immediately.
- Without a completed prefetch, only the first uncached visit shows initial loading.
- Focus/reconnect and successful sync completion revalidate without clearing events.
- Multiple consumers share one request and one cache entry.

### Billing

- Cached/fallback plan renders immediately.
- Authoritative status refreshes at login and when stale on focus.
- Billing page opening does not create duplicate concurrent requests.
- Checkout and portal return polling still confirms webhook-driven changes.
- Background failures preserve the last authoritative status.

### Network request audit

- Repeated tab navigation does not create requests while data is fresh.
- Stale navigation may create one background request, never one per consumer.
- Mutations invalidate only their dependent resources.
- No infinite refresh loop occurs from calendar WebSocket events or billing return polling.

## Risks and mitigations

### Duplicate fetches during migration

Do not run the old effect and new query for the same resource simultaneously. Convert one resource fully per phase and remove its old fetch/cache path in the same change.

### Stale data hidden by overly long freshness windows

Use finite resource-specific `staleTime` values and invalidate immediately after known mutations or external events. Treat the proposed durations as starting values to validate against real usage.

### Cache leakage between users

Use the account-prefixed query keys, disable queries without an authenticated user, cancel old requests on identity change, and remove the previous user's account prefix before rendering new user data.

### WebSocket refresh loops

Only invalidate calendar data on meaningful transitions such as sync completion or reconnect. Do not invalidate continuously while `syncing` or `stale` remains true.

### Billing regression

Migrate Billing last and preserve its existing context API and confirmation loop. React Query replaces storage and deduplication, not Stripe workflow rules.

## Explicitly deferred

- Persisting query data to disk
- Offline mutation queues
- Syncing cache between dashboard and overlay renderer processes
- Moving authenticated user/session ownership out of `AuthContext`
- Rewriting backend response formats
- Introducing React Suspense for data loading
- Adding a query-devtools production dependency
