# Supabase Auth Replacement Execution Plan

Date: 2026-08-13

Status: Executed on 2026-08-13. The implementation, static/database verification, and all 13 manual development checks passed. The user explicitly deferred the development-project Postgres upgrade; it remains documented risk and becomes mandatory before real customer data or production use.

Target branch: `supabase-auth`

Execution checkpoint (2026-08-13):

- Canonical development schema rebuilt and inspected through Supabase MCP, including immediate backend-only `session_id` revalidation against managed `auth.sessions`.
- Backend, Electron main/preload/renderer, renderer auth consolidation, Firebase/custom-login removal, and documentation updates implemented.
- Final post-hardening verification reran successfully on 2026-08-13: `go build ./...`, `go vet ./...`, desktop TypeScript, zero-warning ESLint, renderer/main/preload Vite production bundles, web TypeScript and production build, `git diff --check`, repository removal/secret scans, schema/grant/RLS/function inspection, conflict-index planner inspection, and Supabase advisors. `govulncheck` was not installed, so the plan's optional existing-tool scan was skipped. Electron Builder also produced the unpacked package contents but this execution environment denied its final Windows directory rename; packaging is outside this plan's required development-bundle verification.
- Google and Azure are enabled with dedicated login clients, email/password and phone sign-in are disabled, the desktop and backend use a modern publishable key, and both Google and Azure identities have matching application profiles. The platform database upgrade advisor remains open under an explicit early-development deferral.
- The user selected an Orion web callback bridge after direct custom-protocol login left the provider page open. Development Supabase configuration now allowlists `http://localhost:3000/auth/callback`. The bridge may relay only bounded PKCE callback parameters and must never exchange the code or own a session.
- Microsoft login now requests delegated `User.Read` for a best-effort, one-time Graph photo import. Electron main strips provider tokens from new and legacy persisted sessions, and the backend initializes an avatar only when the Orion profile has none; manual uploads remain authoritative.
- The least-privilege database boundary now requires `DATABASE_URL` to authenticate directly as the `orion_backend` LOGIN role; startup verifies both `session_user` and `current_user` and no longer accepts a privileged connection followed by `SET ROLE`. The canonical schema explicitly resets `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOINHERIT`, `NOREPLICATION`, and `NOBYPASSRLS` even when the role already exists. The live role and ignored local connection were cut over on 2026-08-13. A fresh backend process passed the startup identity check and served `/api/health`; live inspection confirms those least-privilege attributes, and `postgres` no longer inherits `orion_backend`.
- The final live database reinspection found two managed Auth users, two matching application profiles, no missing or orphaned profiles, no legacy identity table, forced RLS on all 16 public tables, and no effective public-table CRUD privileges for `anon` or `authenticated`. Security advisors contain only the non-applicable leaked-password warning and the explicitly deferred Postgres platform upgrade. All performance notices are unused-index informational findings in the freshly reset development database; ownership and foreign-key indexes are intentionally retained.
- Calendar callback handling now binds the Electron transaction to the expected random state, provider, feature, and timeout, rejects duplicate or unexpected deep-link parameters, and prevents one active authorization attempt from being silently overwritten by another.
- HTTP, general WebSocket, and transcription-WebSocket authentication now share the same lifecycle distinction. Socket close handling separates terminal authentication, blocked accounts, forced reauthentication, and temporary upstream unavailability, preventing a Supabase outage from being misinterpreted as a reason to erase the encrypted desktop session.
- The least-privilege backend was restarted successfully after credential cutover. Live inspection confirms CRUD on all 16 Orion tables, no `TRUNCATE`/`REFERENCES`/`TRIGGER` table privileges, no public-client CRUD, and exclusive backend execution of the session-check function.
- Runtime verification through Electron's public IPC contract passed session restoration, consistent multi-window authenticated snapshots, zero renderer-localStorage session material, outage retention and recovery, suspended-profile blocking and recovery, missing-profile reprovisioning, and manual-avatar precedence. The reprovisioned Microsoft profile's existing photo was recovered from Orion's public avatar bucket before the manual-avatar check.
- Live web verification passed the valid PKCE relay, duplicate-parameter rejection, reused-flow error routing, private no-store behavior, and invalid integration-callback suppression.
- The callback bridge CSP now includes Next.js development-only `unsafe-eval` and HMR connection allowances so the callback client can hydrate under Turbopack. A production build and live production-header probe confirmed that production still excludes `unsafe-eval` and retains `connect-src 'none'`. This fixes the indefinite server-rendered `Loading...` state observed after completing a browser flow that had already been cancelled in Electron. Electron now also restores and focuses its signed-out window when a stale cancelled callback activates the custom protocol while continuing to reject the callback before any code exchange; a live Windows protocol invocation verified visible, restored, foreground behavior.
- The completion page now guards its automatic `orion://` navigation to one attempt per mounted page. This prevents React development effect replay from queueing a second browser protocol prompt after Orion has already opened, while leaving the explicit manual retry link reusable. TypeScript and production web builds pass, and operator verification confirmed that only one native protocol prompt is issued.
- Electron cancellation now remains authoritative while `exchangeCodeForSession` or backend application-session validation is in flight. Each callback is bound to its captured login attempt, duplicate callbacks are suppressed, guarded validation cannot publish authenticated state after cancellation, and a Supabase session that finishes being created after cancellation is immediately signed out locally with encrypted session and PKCE storage cleared even if remote revocation reports an error. Operator retesting confirmed that late completion can no longer overwrite cancellation or open the dashboard.
- A live backend route probe confirms the four removed login-only endpoints return `404`, while the replacement unauthenticated `POST /api/auth/session` correctly returns `401` without a bearer token.
- A post-resume audit on 2026-08-13 revalidated current Supabase sign-out/session documentation and the changelog, reran every required non-test build/static check, and repeated live database inspection. The project still has two Auth users (one Google and one Azure identity), two matching active application profiles, one active managed session, no multi-session user, and zero calendar integration connections. All 16 public tables still have forced RLS and backend-only policies; public clients retain no table/sequence privileges; `orion_backend` retains only the expected least-privilege attributes and CRUD grants; and the backend-only session function remains inaccessible to public client roles. The security advisors are unchanged from the accepted findings below.
- Subsequent live reinspection found active Google and Microsoft calendar integration rows. Both held non-empty version-1 encrypted access and refresh token ciphertext, had future expirations, discovered provider calendar sources, and completed calendar/event synchronization with successful sync state, bounded event windows, and no recorded errors. Operator verification then passed token refresh, disconnect, and reconnect for both providers; the final one-provider connection count is expected after the disconnect check.
- Final operator confirmation on 2026-08-13 reports every manual verification item passed, including provider denial/expiry/replay handling, two-session local and global sign-out behavior, socket revocation, supported Auth-user deletion cascade, both calendar lifecycles, and Microsoft sign-in without a profile photo. Final live inspection corroborates a managed `user_deleted` audit event, later logout activity, matching Auth/application user sets, no legacy identity table, one intentionally retained Microsoft calendar connection, and unchanged database security invariants.

Accepted future production configuration and deferred advisories:

- Add the exact production `https://orion.app/auth/callback` redirect when the hosted page is deployed and set the intended production Site URL.
- Microsoft login and photo import have completed successfully. Live managed-identity inspection confirms a verified email and `xms_edov = true`, and the matching application profile contains both a name and avatar. Keep the calendar Entra registration separate.
- Deferred by explicit user decision on 2026-08-13: the Supabase project database upgrade recommended by the security advisor is not an early-development completion gate. It becomes mandatory before production use or storing real customer data. The leaked-password advisor remains non-applicable while password authentication is disabled; reconsider it before enabling password sign-in.

Manual verification evidence summary:

- Passed: all items 1–13. This includes Google and Microsoft identity/profile creation, restart restoration, every callback failure mode, local and global sign-out across independent sessions, socket closure, lifecycle blocking, missing-profile reprovisioning, Auth-user deletion cascade, outage recovery, both independent calendar lifecycles, renderer token-boundary inspection, and Microsoft avatar import/manual precedence/no-photo behavior.
- The user supplied the interactive results that cannot be generated by repository or database tooling. Live Supabase/database evidence was reconciled immediately afterward and was consistent with those results.

Supersedes: the Firebase-specific authentication architecture in `docs/auth-system-audit-and-execution-plan.md`. The earlier document remains the record of the security work already completed on `main`; its authorization, lifecycle, Electron-boundary, WebSocket, and integration-hardening requirements still apply unless this plan explicitly replaces them.

## Objective

Replace Firebase Auth and Orion's custom Google/Microsoft login pipeline with managed Supabase Auth while preserving the Go backend as the only application-data API.

The result should have one identity and session authority:

```text
Google or Microsoft
        |
        v
Managed Supabase Auth
        |
        | Supabase access + refresh session
        v
Electron main process
        |
        | short-lived access token only
        v
Go API -> application profile/lifecycle -> PostgreSQL
```

Calendar authorization remains separate:

```text
Authenticated Orion user
        |
        v
Connect Google/Microsoft Calendar
        |
        v
Orion integration OAuth callback -> encrypted provider tokens
```

## Fixed decisions

1. Use the existing **managed Supabase project**, not a self-hosted Supabase deployment.
2. Supabase Auth owns Google and Microsoft/Azure social login, provider identities, access tokens, refresh tokens, and session records.
3. Remove Firebase completely from the desktop, backend, configuration, dependencies, and documentation.
4. Remove Orion's custom login-only provider exchange and its `/auth/start`, `/auth/cancel`, `/auth/callback`, and `/auth/complete` endpoints.
5. Keep custom Google and Microsoft OAuth only for calendar integrations. Login scopes and integration scopes must remain separate.
6. Keep application data backend-only. The desktop receives a publishable Supabase key for Auth, but `anon` and `authenticated` retain no access to Orion's application tables through the Data API.
7. Use Supabase `auth.users.id` as the canonical user UUID. `public.users.id` becomes a UUID foreign key to it.
8. Remove `public.user_auth_identities`; Supabase's `auth.identities` is the sole social-identity registry.
9. Accept Supabase's automatic linking of OAuth identities that have the same verified email. Configure Microsoft's verified-email claim correctly before enabling Azure login. Do not build a parallel Orion linking system.
10. Keep manual identity linking disabled initially. Add it later only with an explicit recent-authentication UX.
11. The Electron main process owns the Supabase session and refresh token. Renderers may request a short-lived access token through sender-validated IPC but never receive the refresh token.
12. Ordinary sign-out is explicitly local. "Sign out all devices" is explicitly global.
13. Orion remains in early development. Compatibility migrations, preservation of development users, and staged dual-auth operation are not requirements. Rebuild the canonical development schema directly.
14. Do not add automated tests, integration tests, test files, test scripts, test dependencies, or test CI. Verification is limited to builds, type checking, linting, static checks, database inspection, and manual use of the development app.

## Current-state findings

The codebase currently has four overlapping authentication layers:

- The Go backend implements Google/Microsoft login, Redis state, PKCE completion codes, Firebase user synchronization, Firebase token verification, application-principal resolution, and logout revocation.
- Electron opens the provider URL, tracks another PKCE transaction, receives a web callback through `orion://`, exchanges Orion's one-time code, and forwards a Firebase custom token to the renderer.
- The renderer splits session state across `FirebaseAuthContext`, `DesktopAuthContext`, `AuthContext`, and `auth-session.ts`.
- The Next.js site hosts an intermediate `/auth/callback` page whose only job is to reopen Electron.

The calendar integration OAuth implementation is already separate from login and should remain.

Live development project snapshot inspected on 2026-08-12:

- `auth.users`: 0 rows.
- `auth.identities`: 0 rows.
- `auth.sessions`: 0 rows.
- `public.users`: 1 legacy Firebase-backed row.
- `public.user_auth_identities`: 2 legacy rows.
- Application tables use forced RLS and a dedicated backend role; direct client table access is already revoked.

This is the preferred point for a destructive reset because Supabase Auth has not yet acquired users and the remaining public identity data is development-only.

## Target authentication flow

### Login

1. A user selects Google or Microsoft in the Electron auth window.
2. Electron main calls `supabase.auth.signInWithOAuth` with:
   - `flowType: 'pkce'` on the main-process Supabase client.
   - `skipBrowserRedirect: true`.
   - An exact environment-specific Orion web callback: `http://localhost:3000/auth/callback` in development and `https://orion.app/auth/callback` in production.
   - Only login/profile scopes; never calendar scopes or offline provider access.
3. Main validates the returned URL as HTTPS on the configured Supabase Auth host before passing it to `shell.openExternal`.
4. Supabase redirects the browser to Google or Microsoft, handles the provider callback, and redirects the PKCE auth code to Orion's minimal web callback.
5. The dynamic web callback validates and moves only bounded `code`, `error`, `error_code`, `error_description`, and `sb_flow_id` parameters into a same-origin `/auth/complete` URL fragment. The styled completion page reads and immediately removes the fragment before forwarding it to `orion://auth/callback`. Neither route initializes Supabase or exchanges the code, and URL fragments are not included in the completion-page HTTP request or Next hydration payload.
6. Electron validates the exact custom-protocol URL and sends the code to `exchangeCodeForSession`. If Supabase returns `sb_flow_id`, preserve it and pass it to the exchange.
7. The Supabase client stores the session through an Electron main-process storage adapter.
8. Main calls `POST /api/auth/session` with the Supabase access token. The backend validates the session with Supabase Auth and atomically resolves or provisions `public.users`.
9. Only after that backend check succeeds does main publish an authenticated principal to renderers.

PKCE remains required even though Supabase manages most of the flow. The web bridge and any hosting logs can observe the short-lived authorization code, but cannot exchange it without the verifier retained in Electron main. The callback route must use `no-store`, `no-referrer`, no analytics, restrictive content security, and immediate history scrubbing.

### Session restoration and refresh

1. Electron starts in `initializing`, then `validating`; cached profile data must not unlock authenticated UI.
2. Main restores the encrypted Supabase session and asks the backend to validate/provision the application principal.
3. Main owns automatic refresh and serializes refresh operations so multiple windows cannot race the same rotating refresh token.
4. A renderer requests an access token through IPC when constructing HTTP or WebSocket authentication.
5. A 401 causes one forced refresh and one retry. A second 401 invalidates the local session.
6. A Supabase/network outage returns a service-unavailable state and must not be misclassified as logout.
7. Suspended, deleted, and inactive Orion profiles remain blocked even when the Supabase session itself is valid.

### Sign-out and revocation

- **Sign out:** call Supabase sign-out with `scope: 'local'`, clear encrypted local session state, close the current app's sockets, and notify every Electron window.
- **Sign out all devices:** use the current authenticated token to perform global Supabase sign-out, disconnect every socket registered to the Orion user, then clear local state. Never rely on Supabase JS's default scope; pass `global` explicitly.
- Supabase access JWTs can remain cryptographically valid until `exp` after session revocation. The backend's authoritative Auth check and periodic WebSocket revalidation must reject a removed session rather than accepting signature validity alone.
- Application suspension/deletion remains enforced from `public.users` on every protected request and every periodic socket validation.

## Phase 1: Configure managed Supabase Auth

Perform this configuration before deleting the existing login path so the new path can be exercised as soon as it is wired.

### Supabase project

- Enable Google and Azure providers.
- Disable unused email/password, phone, and anonymous sign-in methods for the initial release.
- Set the production Site URL to Orion's real web origin when available; do not leave `localhost` as the production default.
- Add exact redirect allow-list entries:
  - `http://localhost:3000/auth/callback` for local development.
  - `https://orion.app/auth/callback` when the production callback is deployed.
- Do not use a broad wildcard for either callback.
- Keep manual identity linking disabled initially.
- Record that verified-email automatic linking is the chosen behavior.
- Keep the normal one-hour access-token lifetime initially. Revisit time-boxed sessions, inactivity limits, and single-session policy with the enterprise identity work.
- Use the modern publishable key (`sb_publishable_...`) in clients. Never expose a secret or service-role key to Electron, Vite, Next.js, or a renderer.

### Google configuration

- Configure a login-only OAuth client for Supabase Auth.
- Set its authorized provider callback to:
  - `https://njzmleaestfbhdamyitd.supabase.co/auth/v1/callback`
- Request only `openid`, email, and profile for sign-in.
- Do not request Calendar access, offline access, or forced consent during login.
- Keep or create a different OAuth client for the backend calendar integration callback.

### Microsoft configuration

- Configure a login-only Microsoft Entra app for Supabase Auth.
- Set its redirect URI to:
  - `https://njzmleaestfbhdamyitd.supabase.co/auth/v1/callback`
- Select the intended account audience deliberately; use Supabase's Azure tenant setting rather than relying on an accidental Entra default.
- Ensure a valid email is returned.
- Request the identity-only `profile` scope as well as `email` so Microsoft includes the display-name claim. This is not Microsoft Graph calendar authorization.
- Configure the optional `xms_edov` claim so Supabase can distinguish verified Microsoft email domains before automatic linking.
- Microsoft profile photos are imported separately and best-effort: request delegated `User.Read`, use the one-time Supabase provider token in Electron main to fetch `/me/photos/240x240/$value`, validate and upload it through the backend, then discard it. Never persist or expose provider tokens.
- Treat provider avatars as initialization-only. Manual Orion avatar uploads take precedence for every sign-in provider and must not be overwritten during later session bootstrap.
- Keep or create a separate Entra app registration for calendar access and offline refresh tokens.

### Configuration checkpoint

Before continuing, confirm manually in Supabase that both providers generate a Supabase authorization URL and that the final application redirect is the exact environment-specific Orion web callback.

## Phase 2: Rebuild the canonical development schema

Edit `supabase/schema.sql` as the source of truth and rebuild the development schema. Do not create compatibility layers for the Firebase-shaped schema.

### User identity changes

- Change `public.users.id` from `text` to `uuid`.
- Make it `references auth.users(id) on delete cascade`.
- Change every application `user_id`, owner ID, and ownership composite key from `text` to `uuid`.
- Remove `public.user_auth_identities` and all associated constraints, indexes, models, and repository code.
- Keep `public.users` as the application profile and lifecycle record:
  - plan and quotas;
  - `active`, `suspended`, or `deleted` status;
  - profile name and avatar;
  - contact-email snapshot and verification state;
  - timestamps and soft-deletion state.
- Treat UUID as identity. Do not use email for authorization or account ownership.
- Avoid making application email the identity key. Enterprise SSO can produce accounts that must be distinguished by UUID even when email values collide.
- Remove the current unique normalized-email index. Add only a non-unique normalized-email lookup index if sharing or contact lookup still needs one.
- A missing public profile may be recreated only through the authenticated session-bootstrap path. A present suspended or deleted profile must never be reactivated by login.

### Provisioning strategy

Do not add a public `SECURITY DEFINER` auth trigger.

Instead, make `POST /api/auth/session` idempotently provision the profile after validating the Supabase user:

- Insert `public.users` with the exact `auth.users.id` when missing.
- Derive initial name/avatar/email only from authenticated provider data and use it only as profile information, never authorization metadata.
- Do not overwrite a user's chosen display name or avatar on every login.
- Update a verified contact-email snapshot when appropriate.
- Send Orion's welcome email only after a newly created profile transaction commits.
- Return the existing active profile on repeated bootstrap calls.
- Reject suspended, deleted, or otherwise inactive rows.

This handles the earlier failure scenario cleanly:

- If `public.users` is accidentally cleared but the Supabase Auth user remains, the next authenticated bootstrap recreates the public profile.
- If the Auth user is deleted, the foreign key cascades the public profile and its dependent application data.
- Normal account deletion must use soft deletion/status first so a surviving Auth session cannot recreate the profile.

### Access model

- Keep `anon` and `authenticated` without application table or sequence privileges.
- Keep `orion_backend` as the only application-data role.
- Preserve forced RLS and backend-role policies as defense in depth.
- Do not add `auth.uid()` client policies while the Data API is not an application data path.
- Do not grant the desktop access merely because it now possesses a Supabase JWT.
- Leave the managed `auth` schema under Supabase's ownership; the canonical Orion schema should not drop, recreate, or mutate Supabase Auth tables directly.

### Development reset

- Reinspect row counts immediately before execution.
- Remove the legacy Firebase-backed public user and identity rows as part of the reset.
- Preserve no Firebase identifiers.
- Re-run schema, grants, RLS, ownership-constraint, and advisor inspection after rebuilding.
- The current Postgres security-upgrade advisor is explicitly deferred during early development and must be completed before production use or real customer data is stored.
- Leaked-password protection is not applicable while password login is disabled; reconsider it before enabling passwords.

## Phase 3: Replace backend authentication

### Supabase Auth client

Replace `FirebaseClient` with a small timeout-bound Supabase Auth verifier.

It should:

- Accept one bearer access token.
- Ask the managed Supabase Auth user endpoint to validate the user using `SUPABASE_URL` and the publishable key, then verify the token's `session_id` still exists through a narrowly scoped backend-only function over `auth.sessions` so logout takes effect before JWT expiry.
- Never use a desktop-supplied user ID, email, role, plan, status, or organization claim as authorization.
- Treat `user_metadata` as display/profile input only.
- Map invalid, expired, revoked, missing-user, provider-disabled, transport, and upstream failures into stable Orion error codes.
- Use bounded request contexts and an HTTP client timeout.
- Avoid logging access tokens, refresh tokens, authorization codes, provider payloads, or full upstream responses.

Use authoritative Auth validation for protected requests initially. If latency later requires caching, add only a short bounded validation cache keyed by token/session ID and preserve explicit invalidation for lifecycle changes.

### Principal service and middleware

- Rename Firebase-specific types, fields, files, comments, and error codes to provider-neutral Supabase/session terminology.
- Keep one typed principal in Gin context.
- Resolve the Supabase UUID to `public.users.id`.
- Enforce `status = active` and `deleted_at is null` for every protected HTTP request.
- Use stable status behavior:
  - 401 for missing, invalid, expired, or revoked authentication;
  - 403 for a valid identity whose Orion account is suspended, deleted, or inactive;
  - 503 for Supabase Auth or database unavailability.
- Preserve the distinction in the desktop so a temporary 503 does not erase a valid local session.

### Routes

Add:

- `POST /api/auth/session`: authenticated Supabase bootstrap/validation and public-profile provisioning.

Keep but reimplement:

- `POST /api/auth/logout-all`: global Supabase session revocation plus user-wide WebSocket disconnect.
- `/api/user/me` profile routes.

Delete:

- `GET /auth/start`.
- `POST /auth/cancel`.
- `GET /auth/callback`.
- `POST /auth/complete`.

### WebSockets

- Authenticate WebSocket handshakes with the same Supabase principal service.
- Continue periodic session and application-user revalidation.
- Preserve the bounded socket lifetime and user-wide forced disconnect support.
- Use distinct close behavior for unauthenticated versus application-disabled principals where useful, without leaking sensitive account details.
- Ensure refreshed access tokens are used when the renderer reconnects.

### Backend configuration

Add and validate:

- `SUPABASE_URL`.
- `SUPABASE_PUBLISHABLE_KEY`.

Remove:

- `FIREBASE_PROJECT_ID`.
- `FIREBASE_SERVICE_ACCOUNT_KEY`.
- Firebase initialization and production validation.
- Login-only `FRONTEND_CALLBACK_URL` and provider redirect configuration.

Separate integration credentials from former login credentials:

- `GOOGLE_INTEGRATION_CLIENT_ID`.
- `GOOGLE_INTEGRATION_CLIENT_SECRET`.
- `GOOGLE_INTEGRATION_REDIRECT_URL`.
- `MICROSOFT_INTEGRATION_CLIENT_ID`.
- `MICROSOFT_INTEGRATION_CLIENT_SECRET`.
- `MICROSOFT_INTEGRATION_REDIRECT_URL`.

Validate every integration callback and production URL exactly as before.

## Phase 4: Make Electron main the session owner

Rewrite the main-process auth coordinator rather than layering Supabase onto the Firebase coordinator.

### Supabase client

- Add a pinned `@supabase/supabase-js` dependency and commit the lockfile update.
- Create exactly one main-process Supabase client configured for PKCE, persistent sessions, refresh, and no browser URL auto-detection.
- Do not instantiate a second session-owning Supabase client in a renderer.
- Validate the configured project URL and publishable-key presence at startup.

### Secure persistence

- Implement Supabase's async storage interface in the Electron main process.
- Encrypt the serialized session before writing it through `electron-store`, using Electron `safeStorage` when OS encryption is available.
- In packaged builds, fail closed if secure persistence is unavailable rather than silently saving refresh tokens as plaintext.
- Development may use an explicit memory-only session fallback; it should not quietly weaken packaged behavior.
- Never send, log, or place a refresh token in IPC, a URL, localStorage, a crash message, or an error string.
- Serialize refresh and storage writes to respect Supabase's rotating one-use refresh-token model.

### Auth coordinator state

Use one main-process state machine:

- `initializing`
- `validating`
- `anonymous`
- `oauth-pending`
- `authenticated`
- `service-unavailable`
- `blocked`

It owns:

- the Supabase client session;
- the validated Orion user profile;
- the active provider login attempt and timeout;
- login cancellation;
- refresh serialization;
- local and global sign-out;
- profile revalidation;
- multi-window state broadcasts.

### IPC contract

Replace Firebase-shaped IPC with a small provider-neutral contract:

- Begin Google login.
- Begin Microsoft login.
- Cancel the active login.
- Get the current validated auth snapshot.
- Get a current access token, optionally forcing refresh.
- Sign out locally.
- Sign out all devices.
- Subscribe to auth-state changes.

Requirements:

- Validate sender window and view for every auth IPC call.
- Reject concurrent login attempts instead of overwriting the active PKCE verifier.
- Never accept a renderer-provided token as a new authenticated session.
- Never publish authenticated state until backend bootstrap succeeds.
- Keep access-token return values out of event payloads where they are not required.

### Protocol handling

- Configure Supabase login to return to the exact environment-specific Orion web `/auth/callback` route.
- Keep the web route as a minimal relay: allowlist and bound callback parameters (including Supabase's `error_code` on failure), return a private no-store redirect to the same-origin completion page using a fragment, scrub the fragment immediately, apply no-referrer/noindex protections, and never instantiate a Supabase client or exchange the code there.
- Relay to the exact `orion://auth/callback` route.
- Validate scheme, host/path, expected parameters, size limits, and the presence of an active transaction.
- Exchange the short-lived Supabase auth code only once.
- Clear callback parameters and pending material on success, cancellation, timeout, or failure.
- Continue keeping integration callbacks distinct at `orion://integrations/callback`.
- Preserve single-instance and cold-start handling without the current fixed-delay workaround where possible; queue the initial protocol URL until the auth coordinator is ready.

## Phase 5: Consolidate renderer authentication

Turn `desktop/src/contexts/AuthContext.tsx` into the single renderer-facing auth context.

It should expose:

- validated Orion user;
- explicit session status;
- `isAuthenticated` and `isLoading` derived from that status;
- Google/Microsoft login actions;
- cancellation;
- local and all-device sign-out;
- profile update/avatar actions;
- access-token retrieval for API and WebSocket clients.

Remove:

- `FirebaseAuthContext`.
- the current separate `DesktopAuthContext` layer.
- Firebase custom-token sign-in.
- direct Firebase `currentUser` and `getIdToken` access throughout components and hooks.
- renderer-to-main `notifyStateChanged`; main is now authoritative.

Refactor `auth-session.ts` to:

- request access tokens from the main process;
- attach `Authorization: Bearer` consistently;
- retry once after a forced Supabase refresh on 401;
- invalidate only on terminal auth failure;
- retain the existing idempotent multi-window cleanup and session-expired messaging;
- preserve user-created local meeting drafts unless product policy explicitly says sign-out should delete them.

Update all current direct Firebase consumers, including API clients, WebSocket context, transcription, calendar hooks, settings, top bar, workspace, attendees, and notes components.

## Phase 6: Remove the custom login and Firebase surface

Expected deletion or replacement candidates include:

### Backend

- `backend/internal/auth/firebase.go`.
- `backend/internal/auth/code.go`.
- Login-only auth types and provider registry.
- `backend/internal/handlers/oauth.go`, replaced by the much smaller session handler.
- `backend/internal/repository/auth_identity.go`.
- `backend/internal/models/auth_identity.go` if no integration type still depends on it.
- Firebase middleware naming and Firebase-specific principal errors.
- The Firebase Admin dependency and transitive modules after `go mod tidy`.

The integration handler currently imports the Google endpoint from the login-provider package. Move that endpoint into the integration package before deleting the provider package.

### Desktop

- `desktop/src/config/firebase.ts`.
- `desktop/src/contexts/FirebaseAuthContext.tsx`.
- `desktop/src/contexts/DesktopAuthContext.tsx` after folding its actions into `AuthContext`.
- Firebase build constants from `desktop/vite.config.ts`.
- Firebase dependency and lockfile entries.
- `firebaseToken` IPC and protocol payload types.
- Any comment, cache key, type, or error message that treats Firebase as the identity authority.

### Web

- Keep a minimal dynamic `web/app/auth/callback/route.ts` bridge solely to validate the PKCE callback and redirect it into the fragment of a styled `/auth/complete` React page. The fragment is never sent with the completion-page request, avoiding the query reflection that occurs when the sensitive callback itself is an App Router page.
- Keep callback-specific cache, referrer, indexing, framing, and content-security headers in `web/next.config.ts`.
- Keep `web/app/integrations/callback/page.tsx` and the shared open-app UI needed by calendar connections.
- Remove auth callback helpers only when they are no longer shared by integrations.

### Repository-wide proof of removal

At the end, repository search should find no runtime Firebase imports, dependencies, environment variables, custom tokens, Firebase user synchronization, or login-only Orion OAuth endpoints.

## Phase 7: Preserve and clarify calendar integrations

Do not replace the existing calendar integration flow with Supabase login provider tokens.

Reasons:

- Login should request only the minimum authentication and initial-profile scopes.
- Supabase does not persist or refresh third-party provider tokens for Orion.
- Calendar access requires separate consent, offline access, encrypted storage, refresh handling, disconnect, and revocation semantics.
- Users may sign in with one provider and connect a different calendar account.

Execution work:

- Rename provider credentials so login and integration configuration cannot be confused.
- Keep Redis integration state single-use and correlated with the pending Electron transaction.
- Keep access and refresh tokens encrypted and versioned.
- Keep disconnect hard-deleting credentials and dependent cached calendar data.
- Keep Google grant revocation and Microsoft's best available disconnect behavior.
- Confirm calendar reconnection and token refresh still use only the integration OAuth clients.

## Phase 8: Documentation and operational cleanup

- Update `CLAUDE.md`, root/backend/desktop/web READMEs, and environment examples from Firebase Auth to Supabase Auth.
- Mark this plan executed only after every completion criterion passes.
- Amend the older auth audit so its "implemented architecture" does not appear to describe the Supabase branch after merge.
- Document that hosted Orion uses managed Supabase Auth while a future fully air-gapped edition needs a separate identity deployment/enterprise IdP design.
- Document the split between authentication and calendar authorization.
- Document local versus global sign-out and the maximum stale-access window.
- Do not document or copy provider secrets, Supabase secrets, tokens, or local `.env` values.

## Verification policy

No test code or test infrastructure will be added.

### Static and build verification

- Backend: `go build ./...`.
- Backend: `go vet ./...`.
- Backend: run the existing vulnerability scan if the tool is already available.
- Desktop: TypeScript compilation with no emit.
- Desktop: ESLint with zero warnings.
- Desktop: development renderer/main/preload build.
- Web: TypeScript compilation.
- Web: production build.
- Repository search: no Firebase runtime surface or deleted endpoint references.
- Database: inspect schema, UUID foreign keys, grants, forced RLS, policies, row counts, and Supabase advisors.

### Manual development verification

These are operator checks, not automated tests or files added to the repository:

1. Fresh Google login creates one `auth.users` row and one matching `public.users` UUID.
2. Fresh Microsoft login does the same and records the expected verified-email behavior.
3. Restarting Electron restores and validates the session without briefly showing authenticated UI first.
4. Cancelling login, denying provider consent, using an expired callback, replaying a callback, and malformed/duplicate web callback parameters fail safely.
5. Local sign-out leaves another device/session active.
6. Global sign-out blocks refresh elsewhere and closes active Orion sockets within the configured validation bound.
7. A suspended or soft-deleted public profile remains blocked despite a valid Supabase identity.
8. Deleting only the development `public.users` row while retaining `auth.users` causes session bootstrap to recreate the profile; dependent development data is expected to cascade.
9. Deleting the Supabase Auth user cascades the application profile and dependent data.
10. A Supabase/network outage is shown as temporary unavailability rather than silently logging the user out.
11. Google Calendar and Microsoft Calendar connection, refresh, sync, reconnect, and disconnect still work independently of the sign-in provider.
12. Renderer inspection confirms no refresh token is present in localStorage, IPC events, logs, or callback URLs.
13. A Microsoft account with a profile photo imports it only when the Orion avatar is empty; a manual Orion avatar upload replaces it and survives later Microsoft and Google sign-ins. A Microsoft account without a photo still signs in successfully.

## Definition of done

- Google and Microsoft login are handled by managed Supabase Auth.
- The desktop completes Supabase PKCE through Orion's minimal web-to-deep-link callback while Electron remains the sole verifier and session owner.
- Electron main securely owns refresh tokens and renderer-visible auth state is derived from a backend-validated principal.
- Firebase and the custom login OAuth exchange are completely absent from runtime code and dependencies.
- Supabase Auth UUID is the single identity key across Auth, public profiles, backend principals, ownership foreign keys, and WebSockets.
- `public.user_auth_identities` no longer exists.
- A missing public profile can be safely reprovisioned from a valid Supabase identity without reactivating suspended/deleted accounts.
- Backend-only application data access, forced RLS, ownership constraints, and the least-privileged database role remain intact.
- Login scopes contain no calendar permissions; calendar OAuth remains separate and functional.
- Local and global sign-out have explicit, correct behavior.
- Builds, static checks, schema inspection, advisors, and the manual verification list pass.
- No automated tests, test files, test dependencies, test scripts, or test CI have been added.

## Execution guidance for the future goal

Execute this as one auth replacement, not as a long-lived Firebase/Supabase dual-stack migration. The branch may be temporarily broken between phases, but the final implementation must not retain fallback Firebase behavior.

Recommended goal order:

1. Configure Supabase providers and redirect allow list.
2. Rebuild the schema around `auth.users.id`.
3. Implement backend Supabase principal resolution and bootstrap.
4. Implement the Electron main-process Supabase coordinator and deep link.
5. Consolidate renderer auth and token use.
6. Remove custom login/Firebase code and dependencies.
7. Reconfirm calendar integration separation.
8. Update documentation and complete static/database/manual verification.

Relevant Supabase documentation:

- [Social login](https://supabase.com/docs/guides/auth/social-login)
- [Google login](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Azure/Microsoft login](https://supabase.com/docs/guides/auth/social-login/auth-azure)
- [PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Redirect URLs and deep links](https://supabase.com/docs/guides/auth/redirect-urls)
- [Identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [User sessions](https://supabase.com/docs/guides/auth/sessions)
- [Signing out](https://supabase.com/docs/guides/auth/signout)
