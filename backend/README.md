# Orion Backend

Go REST and WebSocket API for Orion.

## Authentication boundary

Managed Supabase Auth owns external identity and sessions. The backend validates every bearer token with the hosted Auth service, checks that its `session_id` remains present through the backend-only `orion_internal.is_auth_session_active` function, maps `auth.users.id` to the same UUID in `public.users`, and enforces Orion lifecycle state for every protected HTTP request and WebSocket revalidation.

`POST /api/auth/session` is the only profile-provisioning path. It recreates a genuinely missing public profile for a valid Auth identity but never reactivates a suspended, deleted, or inactive profile. `POST /api/auth/logout-all` revokes all Supabase sessions and disconnects every registered socket for the user.

The backend's `DATABASE_URL` must authenticate directly as the dedicated `orion_backend` LOGIN role. Startup rejects owner/admin credentials even if they could later run `SET ROLE`. Electron's publishable Auth key does not grant application-table access; `anon` and `authenticated` have no Orion table privileges.

Google and Microsoft calendar authorization is separate from login. It uses the `*_INTEGRATION_*` credentials, integration callback, Redis state, calendar scopes, and encrypted provider-token storage.

Custom vocabulary is account-owned backend data exposed through authenticated `GET` and `PUT /api/vocabulary` endpoints. New AssemblyAI streams load it server-side and apply its terms to both audio channels; the desktop transcription handshake carries only authentication. See [`../docs/custom-vocabulary.md`](../docs/custom-vocabulary.md).

## Cross-device cache invalidation

Committed cacheable-resource changes publish an account-scoped envelope to the internal Redis channel `orion:resource-events:v1`. Every API instance validates subscribed envelopes and forwards only the versioned `resource.changed` payload to that account's sockets through its local WebSocket hub. Do not send generic invalidations directly through the hub or include resource contents in an event.

To register a cached resource, add its allowlisted enum and desktop query-key mapping, publish only after the authoritative mutation succeeds, define dependent query keys, and add validation, account-isolation, reconnect, and duplicate-event tests. Domain events that carry live state, including `calendar.sync_status`, retain their existing behavior and are not part of this invalidation contract. See [`../docs/cross-device-cache-invalidation-plan.md`](../docs/cross-device-cache-invalidation-plan.md).

Copy `.env.example` to the ignored `cmd/api/.env` for local development and supply real values without committing them. Set a strong, separately managed password on `orion_backend`, then use that role's direct or session-pooler connection string; percent-encode special password characters in the URL.

## Verification

```bash
go build ./...
go vet ./...
```
