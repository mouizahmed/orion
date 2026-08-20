# Orion Desktop

Electron, React, and Vite client for Orion.

## Authentication

The Electron main process owns the sole Supabase Auth client, PKCE flow, refresh token, encrypted session storage, and bounded pending-login transaction. This allows packaged cold-start deep links to finish without exposing verifier material. Renderer code consumes validated application-user snapshots and requests access tokens over sender-validated IPC. Do not add Supabase clients, refresh-token persistence, or direct provider OAuth handling to renderers.

Local development requires `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `AUTH_CALLBACK_URL=http://localhost:3000/auth/callback` in `.env.local`. Use a modern `sb_publishable_...` key. Never place secret or service-role keys in desktop configuration. Production must use the deployed HTTPS Orion callback and an exact matching Supabase redirect allow-list entry.

Calendar authorization remains separate and starts through the authenticated Orion backend.

The Vocabulary settings page persists provider-neutral terms through the authenticated backend. Terms are sent neither through the transcription handshake nor directly to AssemblyAI by the desktop, and saved changes apply when the next recording starts. See [`../docs/custom-vocabulary.md`](../docs/custom-vocabulary.md).

## Server state

Authenticated dashboard API data uses the shared TanStack Query client in `src/lib/query-client.ts`. Query keys must start with `['account', accountID]` through the factories in `src/lib/query-keys.ts`; the session boundary cancels and removes that prefix when the authenticated user changes or signs out.

Use query hooks for cacheable backend resources, background revalidation, prefetching, and mutation rollback. Keep authentication/current-user ownership in `AuthContext`, unsaved form state in React component state, and Electron-owned settings in their IPC contexts. The shared `ServerStateInvalidationBridge` validates `resource.changed` messages and maps them through `src/lib/resource-invalidation.ts`; feature components must not add their own generic invalidation subscriptions. Existing domain events such as `calendar.sync_status` continue to carry live UI metadata separately.

Originating-client mutation behavior belongs in the resource query hook, not page components. Calendar connect, disconnect, OAuth completion, visibility optimism/rollback, and dependent invalidation are owned by `src/hooks/useCalendarSettingsQuery.ts`; the page invokes those mutations without manipulating query keys.

Current query-managed resources are Vocabulary, Extract fields, calendar accounts/visibility, upcoming calendar events, and Billing status. Every query key remains account-prefixed, and reconnect invalidates that account prefix to recover changes missed while offline. See [`../docs/server-state-query-cache-plan.md`](../docs/server-state-query-cache-plan.md) and [`../docs/cross-device-cache-invalidation-plan.md`](../docs/cross-device-cache-invalidation-plan.md) for lifecycle and verification details.

## Development

```bash
npm install
npm run dev
npm run lint
npm test
```
