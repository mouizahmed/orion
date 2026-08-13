# Supabase Auth Operations

Orion's hosted product uses managed Supabase Auth. A future fully air-gapped product requires a separate identity deployment and enterprise IdP design; the hosted Auth dependency must not be presented as air-gapped.

## Trust boundary

- Electron main is the sole Supabase client and owns PKCE, the refresh token, refresh rotation, encrypted persistence, and backend bootstrap. Packaged builds also persist the bounded pending-login transaction so an OS cold-start deep link can finish safely.
- Renderers receive a backend-validated Orion profile and may request a current access token through sender-validated IPC. They never receive refresh tokens.
- The Go backend is the only application-data API. It validates the identity through managed Auth's user endpoint, confirms the JWT `session_id` still exists through a narrowly scoped backend-only database function, then enforces `public.users.status` and `deleted_at`.
- The backend database process authenticates directly as the dedicated `orion_backend` LOGIN role. Startup requires both `session_user` and `current_user` to equal that role; holding an owner/admin credential and relying on `SET ROLE` is intentionally rejected.
- Supabase Auth UUID is the identity and ownership key. Email and `user_metadata` are profile inputs only, never authorization inputs.
- WebSockets use the same principal service, revalidate every minute, and have a 50-minute maximum connection lifetime. Close semantics distinguish terminal authentication, blocked application accounts, forced reauthentication, and temporary service unavailability; only terminal authentication enters the refresh-or-expire path, while an outage retains the encrypted session.

## Sign-out semantics

- Local sign-out uses Supabase scope `local`: it revokes and clears the current device session while leaving other sessions active.
- Sign out everywhere calls Orion's protected global-logout endpoint. The backend revokes all Supabase sessions for the identity and immediately disconnects the user's registered sockets; Electron then clears its local encrypted session.
- Orion does not currently maintain a user-visible device or session inventory. "Sign out everywhere" is global revocation, not a per-device management screen; add device naming and session inventory later only if the product needs selective remote sign-out.
- An already-issued access JWT remains cryptographically valid until expiry after logout. Orion nevertheless rejects it on the next HTTP request by checking its `session_id` against `auth.sessions`. Registered sockets are disconnected immediately by Orion's global-logout endpoint and all other sockets are revalidated within one minute; socket lifetime is capped at 50 minutes.

## Authentication versus calendar authorization

Login requests only authentication and initial-profile scopes through Supabase Google or Azure providers and returns through Orion's minimal `/auth/callback` bridge. The bridge validates the short-lived callback, moves it into the fragment of a same-origin styled completion page, and that page immediately clears and forwards it to `orion://auth/callback`. The fragment is not sent to the server or included in Next hydration data; Electron remains the PKCE verifier and session owner.

Keep the Supabase Site URL at Orion's canonical website root. If Supabase can no longer recover a transaction-specific redirect (for example, because an OAuth state was already consumed), the root request proxy accepts only bounded Auth error fields and redirects them into the fragment of `/auth/error`. The styled page scrubs the fragment and never opens Electron automatically, so an error from an old browser tab cannot interfere with a newer pending login.

Microsoft login requests `email profile User.Read` so Entra includes a display name and returns a one-time provider access token that Electron main can use for profile import. After a successful first sign-in with no Orion avatar, Electron main fetches the signed-in user's 240px photo from Microsoft Graph, validates its type and size, and sends it to Orion's authenticated provider-avatar endpoint. Missing or inaccessible photos are non-fatal and never prevent sign-in.

The login-only Entra registration must include delegated Microsoft Graph `User.Read`. It is accepted for both personal Microsoft accounts and work/school accounts and avoids the admin-consent-only `ProfilePhoto.Read.All` permission. It grants more than photo-only access, so Orion uses the returned token for this one request and does not retain it.

Provider profile data is initialization-only. Google may seed an empty Orion avatar and Microsoft Graph may import one only while the Orion avatar is empty. A user-uploaded Orion avatar replaces the stored value for either provider, and subsequent sign-ins never overwrite that selection with provider metadata or a new Graph photo.

Supabase returns OAuth provider tokens only at the initial exchange. Orion uses the Microsoft token inside Electron main for the single Graph request, never exposes it to the renderer or backend, strips provider access and refresh tokens before encrypted session persistence, and discards the in-memory reference after the import attempt.

Calendar access is a different backend OAuth transaction using separate clients and credentials, explicit Calendar scopes, Redis-correlated single-use state, provider refresh tokens encrypted at rest, and `orion://integrations/callback` after the backend callback. A user's sign-in provider does not imply or grant calendar access.

## Lifecycle recovery

- If a valid Supabase identity has no `public.users` row, authenticated session bootstrap recreates it with the same UUID.
- A present suspended, deleted, or inactive row is blocked and is never reactivated by login.
- Normal deletion marks application lifecycle state before removing the Auth identity. Removing the Auth user cascades the profile and owned data through database foreign keys.
- Managed Auth or database unavailability is temporary `503` state. Electron retains the encrypted session, does not unlock authenticated UI until validation succeeds, and presents an explicit Retry action rather than silently signing the user out.

## Database credential setup and rotation

`supabase/schema.sql` deliberately does not contain a database password. Generate a strong unique password in a password manager and set it on `orion_backend` through an administrator-only SQL session:

```sql
alter role orion_backend with login password '<password-from-your-secret-manager>';
revoke orion_backend from postgres;
```

Store the corresponding role-specific connection URL only in the ignored backend environment file or deployment secret store. Percent-encode special password characters. Use the direct connection when available or Supabase's session pooler for persistent backend processes. Never give the backend the `postgres`, owner, `service_role`, or Supabase secret key credential.

After a credential rotation, restart the backend and confirm startup succeeds. Its role check is the acceptance gate; an administrative connection will fail even if it could issue `SET ROLE` later.

## Accepted development deferral

The Supabase advisor currently recommends a Postgres platform upgrade. The user explicitly deferred that upgrade on 2026-08-13 because this is an early-development project without real customer data. This is an accepted development risk, not a claim that the advisory is resolved. Complete the platform upgrade before production use or storing real customer data.
