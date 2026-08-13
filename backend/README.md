# Orion Backend

Go REST and WebSocket API for Orion.

## Authentication boundary

Managed Supabase Auth owns external identity and sessions. The backend validates every bearer token with the hosted Auth service, checks that its `session_id` remains present through the backend-only `orion_internal.is_auth_session_active` function, maps `auth.users.id` to the same UUID in `public.users`, and enforces Orion lifecycle state for every protected HTTP request and WebSocket revalidation.

`POST /api/auth/session` is the only profile-provisioning path. It recreates a genuinely missing public profile for a valid Auth identity but never reactivates a suspended, deleted, or inactive profile. `POST /api/auth/logout-all` revokes all Supabase sessions and disconnects every registered socket for the user.

The backend's `DATABASE_URL` must authenticate directly as the dedicated `orion_backend` LOGIN role. Startup rejects owner/admin credentials even if they could later run `SET ROLE`. Electron's publishable Auth key does not grant application-table access; `anon` and `authenticated` have no Orion table privileges.

Google and Microsoft calendar authorization is separate from login. It uses the `*_INTEGRATION_*` credentials, integration callback, Redis state, calendar scopes, and encrypted provider-token storage.

Copy `.env.example` to the ignored `cmd/api/.env` for local development and supply real values without committing them. Set a strong, separately managed password on `orion_backend`, then use that role's direct or session-pooler connection string; percent-encode special password characters in the URL.

## Verification

```bash
go build ./...
go vet ./...
```
