# Auth System Audit and Execution Plan

> Historical implementation record: this document describes the hardened Firebase/custom-OAuth architecture implemented on `main`. The `supabase-auth` branch replaces its identity and login portions with managed Supabase Auth as defined by `docs/supabase-auth-execution-plan.md`. Its lifecycle, backend-only authorization, Electron trust-boundary, WebSocket revalidation, and calendar-integration security requirements still apply.

Date: 2026-08-10

Executed and re-verified: 2026-08-11

Status: Implemented. Static verification is complete; automated tests and test CI are intentionally excluded at the owner's direction while the product remains in early development.

## Execution result

The stabilization work in this document has been applied to the application and to the live development Supabase project. The original audit language is retained below as a record of the problems that drove the refactor; it should not be read as the current implementation state.

Completed outcomes:

- Every protected HTTP request and both WebSocket endpoints resolve the same typed, active application principal after Firebase revocation checks.
- The desktop fails closed, does not trust renderer-supplied tokens, and does not show authenticated UI until the backend validates the session.
- OAuth user and provider-identity resolution is transactional. Provider ownership cannot be reassigned by an upsert conflict.
- Google may link by a verified normalized email. Microsoft is keyed by tenant and object ID and is never silently linked by email. There is no implicit Microsoft linking path.
- Ordinary logout is local. `POST /api/auth/logout-all` revokes Firebase refresh tokens and disconnects registered WebSockets.
- WebSockets use exact origin checks, periodic principal revalidation, bounded connection lifetimes, and user-wide forced disconnects.
- Electron uses sandboxed windows, exact navigation/origin rules, sender-scoped IPC, validated external OAuth URLs, and a restrictive production CSP.
- Integration callbacks are correlated to the pending Electron state. Disconnect attempts provider revocation and permanently removes the stored credentials and dependent calendar data.
- Integration token encryption supports versioned keys. Raw provider claims are no longer stored or returned. The incomplete Notion surface was removed.
- Provider calls, Firebase operations, and Redis-backed OAuth operations use request contexts and bounded timeouts. Redis rate-limiting failures fail closed.
- Startup validates OAuth, callback, Firebase, database-role, CORS, and packaged HTTPS invariants.
- `supabase/schema.sql` is the canonical destructive development baseline. It includes lifecycle, normalized-email, identity, ownership, RLS, privilege, and foreign-key-index invariants.
- The live development database was reset to that architecture: 17 application tables, zero application rows, forced RLS, revoked `anon`/`authenticated` access, and a dedicated `orion_backend` role selected by every backend connection.
- Confirmed auth dead code, duplicate token paths, stale Notion types, and all test/spec files were removed.

Verification completed without tests:

- Backend: `go build ./...` and `go vet ./...`.
- Backend dependency scan: `govulncheck ./...` reports zero reachable vulnerabilities after upgrading the required Go toolchain and affected modules.
- Desktop: `npx tsc --noEmit` and ESLint with zero warnings.
- Desktop build: Vite renderer, Electron main process, and preload bundles complete successfully in development mode. Packaged builds intentionally require real production Firebase variables.
- Web: `npx tsc --noEmit`.
- Web build and dependency scan: the Next.js production build succeeds and `npm audit --omit=dev` reports zero vulnerabilities after the framework upgrade.
- Repository: no `_test.go`, `*.test.*`, or `*.spec.*` files and no test CI workflow.
- Supabase: schema, privileges, policies, row-security flags, row counts, ownership constraints, and advisors re-inspected after application.

Two Supabase platform notices remain outside application code:

- Upgrade the managed Postgres version before storing production data.
- Leaked-password protection is irrelevant while Firebase is the only authentication provider; enable it if Supabase password authentication is introduced.

One non-auth application dependency notice remains: MDXEditor depends on `js-yaml`, whose current advisory has no patched release. It processes note-editor content rather than authentication data, so replacing the editor is tracked separately from this auth refactor. Do not accept untrusted shared MDX/frontmatter until that dependency is replaced or patched.

## Purpose

This document records the original audit and the resulting execution state of Orion's authentication and authorization system.

The current system has a good foundation:

- OAuth state is random and single-use.
- Desktop login uses PKCE.
- Authentication codes and OAuth state are atomically consumed from Redis.
- API tokens are verified using Firebase revocation checks.
- Most resource access is scoped by authenticated user ID.

However, the system is not yet production-robust. The items below should be addressed before treating the authentication implementation as complete or positioning it as enterprise-ready.

## Development assumptions

Orion is still in very early development. The current code, schema, remote migration history, and stored development data are not compatibility constraints.

Implementation should optimize for the cleanest final architecture rather than preserving the current shape:

- Breaking schema and API changes are allowed.
- Tables, constraints, policies, and development data may be replaced or reset.
- The existing remote migration chain does not need to be retained or repaired.
- There is no requirement to write a sequence of additive compatibility migrations around the current schema.
- Before staging or production use, create one reproducible canonical schema baseline so new environments can be built consistently.
- The live public tables contained zero rows when verified on 2026-08-11, so now is the preferred time for destructive simplification.

## Priority 1: Security and correctness blockers

### 1. Enforce database user status globally

The Firebase middleware validates the token but does not confirm that the corresponding database user exists, is not deleted, and has `status == active`.

Affected areas:

- `backend/internal/middleware/firebase_auth.go`
- `backend/internal/handlers/oauth.go`
- `backend/internal/handlers/transcription.go`
- `backend/internal/handlers/ws.go`
- `backend/internal/repository/user.go`
- Desktop session hydration in `desktop/src/contexts/FirebaseAuthContext.tsx`

Current consequences:

- Suspended users can continue signing in and using APIs.
- Users soft-deleted after authentication can continue using protected APIs.
- `/user/me` can return 404 while the desktop continues displaying a cached authenticated user.
- WebSocket connections do not check database user status.

Implementation direction:

- Replace the current token-only middleware with one authenticated-principal middleware.
- Verify the Firebase ID token and revocation state.
- Load the application user.
- Require `status == active` and `deleted_at IS NULL`.
- Put one typed principal in the Gin context rather than multiple string keys.
- Return a stable machine-readable error code for disabled, deleted, expired, revoked, and invalid sessions.
- Revoke Firebase refresh tokens whenever an administrator suspends or deletes an account.
- Apply the same principal validation to WebSocket authentication.

### 2. Remove Electron's fail-open authentication behavior

`desktop/electron/auth-handlers.ts` treats a backend network error as successful authentication. This lets an unverified renderer-provided token unlock main-process authenticated features while the API is unavailable.

Implementation direction:

- Fail closed during initial authentication and session restoration.
- Do not accept an arbitrary nonempty token as evidence of authentication.
- If offline operation is added later, make it a separate, explicit state backed by a previously verified principal and a bounded expiration.
- Treat 401 as authentication failure.
- Do not automatically treat every 403 as an expired session; distinguish authorization failures using stable server error codes.

### 3. Make identity creation and linking atomic

OAuth user creation, user updates, identity insertion, welcome email, avatar caching, and Firebase synchronization currently occur as separate operations.

`backend/internal/repository/auth_identity.go` also updates `user_id` when a `(provider, provider_user_id)` conflict occurs. Concurrent first-login callbacks can therefore create duplicate users and move the provider identity between them.

Implementation direction:

- Put database user creation or update and identity insertion in one transaction.
- Never update `user_id` on a provider-subject conflict.
- Treat an existing provider identity owned by another user as a hard conflict.
- Preserve the useful identity constraints already present in the live database when rebuilding the canonical schema:
  - `UNIQUE (provider, provider_user_id)`.
  - `UNIQUE (user_id, provider)` while one account per provider is the intended rule.
  - `user_auth_identities.user_id -> users.id ON DELETE CASCADE`.
- Do not rely on those constraints to make the current upserts safe. The provider-subject conflict path still updates `user_id`, and the user-provider conflict path still replaces `provider_user_id`.
- Replace the two conflicting email indexes with one clearly defined, case-insensitive email uniqueness policy.
- Add the remaining ownership foreign keys and deletion behavior as part of the clean schema rebuild.
- Perform welcome email delivery and avatar caching only after transaction commit.
- Preserve the database constraints and retry behavior that make duplicate callbacks and simultaneous first login deterministic.

### 4. Harden the Electron renderer trust boundary

`desktop/electron/window.ts` accepts any `file://` URL as internal app navigation and uses string-prefix matching for the development server. Every Electron window also receives the same preload API, while authentication IPC does not validate the sender window.

Implementation direction:

- Allow only the exact packaged renderer entry file.
- In development, allow only the exact parsed development origin.
- Add a restrictive desktop Content Security Policy.
- Validate IPC sender window and expected view for authentication and token messages.
- Verify token updates before storing them in the main process.
- Consolidate main-process auth phase, current token, and verified principal into one coordinator.
- Parse URLs and compare exact origins in the image authorization interceptor.
- Validate provider authorization URLs before passing them to `shell.openExternal`.

### 5. Finish session invalidation behavior

The centralized authenticated fetch and 401 retry behavior are useful, but two gaps remain:

- A failure from the initial `getIdToken(false)` call does not invalidate the session.
- A cached user profile is marked authenticated before `/user/me` validates the restored server session.

Implementation direction:

- Introduce explicit states such as:
  - `initializing`
  - `validating`
  - `authenticated`
  - `anonymous`
  - `expired`
  - optionally `offline`
- Allow cached profile data to populate the display while validating, but do not let it establish authentication.
- Classify terminal Firebase token errors and invalidate immediately.
- Consolidate duplicate local sign-out, Electron notification, cached-user cleanup, and session-expiration messaging.
- Ensure session invalidation is idempotent across all windows.

### 6. Make WebSocket revocation effective

Both WebSocket endpoints authenticate only during their initial handshake. Existing connections survive logout, suspension, deletion, or refresh-token revocation.

Implementation direction:

- Restrict WebSocket origins.
- Apply the same authenticated-principal validation as HTTP.
- Add a maximum connection lifetime or periodic reauthentication.
- Disconnect all registered sockets for a user during suspension, deletion, or logout-everywhere.
- Move shared WebSocket authentication out of `transcription.go` into a dedicated auth component.
- Keep close code `4001` as the consistent invalid-auth signal.

## Priority 2: Important inconsistencies

### Logout semantics

The current logout endpoint revokes every refresh token for the user, even though the UI presents an ordinary logout. If backend revocation fails, the desktop signs out locally and silently leaves other sessions active.

Recommended behavior:

- `Sign out`: clear only the current local Firebase session.
- `Sign out all devices`: call the backend revocation endpoint and report failure accurately.
- Administrative suspension or deletion: revoke all sessions and disconnect active sockets.

### Microsoft account linking

Microsoft profiles are always treated as having an unverified email, while email-based linking is only permitted for verified Google profiles. There is no authenticated account-linking workflow even though the backend error instructs users to sign in first and link the provider.

Implementation direction:

- Define an explicit account-linking policy.
- Add an authenticated provider-link endpoint if multi-provider accounts are supported.
- Require recent authentication before linking or unlinking.
- Include Microsoft tenant identity in the provider identity key; do not rely only on the Graph user ID.
- Provide a user-facing, non-generic collision error.

### Firebase initialization and synchronization

- Firebase startup can panic when `project_id` is missing or not a string.
- `CreateOrUpdateUser` treats every creation failure as though the UID already exists.
- Firebase synchronization errors are ignored after a custom token is created.
- Custom tokens are created before Firebase user synchronization.

Implementation direction:

- Parse the service account into a typed structure and validate required fields.
- Use Firebase's typed helpers such as UID-already-exists, email-already-exists, user-not-found, revoked-token, expired-token, and disabled-user checks.
- Synchronize or validate the Firebase user before issuing the login completion token.
- Do not continue after identity or email ownership conflicts.

### OAuth and external request behavior

- Provider calls use `oauth2.NoContext` and have no explicit timeout.
- Login requests ask for offline access even though login-provider tokens are discarded.
- OAuth callback and redirect configuration is not comprehensively validated during startup.
- Production Electron configuration accepts an HTTP backend override.
- Shared-IP rate limits can block an office behind one NAT.
- One-time codes appear in callback URLs and browser history.

Implementation direction:

- Propagate request contexts and add bounded HTTP timeouts.
- Remove offline access and forced consent from login-only provider scopes.
- Keep offline access only for integrations that require refresh tokens.
- Validate required OAuth credentials and exact HTTPS callback URLs at startup.
- Require HTTPS backend URLs in packaged builds.
- Use rate limiting that accounts for shared enterprise networks.
- Set callback pages to `no-store` with a strict referrer policy and remove query parameters immediately after reading them.

### Authorization consistency

Most note, folder, transcript, calendar, attachment, share, attendee, and conversation operations correctly scope ownership by user ID.

Remaining cleanup:

- Conversation creation accepts arbitrary note and folder IDs without confirming ownership.
- `StopRecording` stops a user-owned session before checking that the note ID in the route matches it.
- Standardize not-found versus forbidden behavior so record existence is not leaked.
- Prefer repository methods that include user ID even when a handler has already performed an ownership check.

### Integration OAuth and token lifecycle

- Integration disconnect only marks a row disconnected.
- Provider authorization is not revoked.
- Encrypted access and refresh tokens remain stored after disconnect.
- Integration callback deep links are not correlated with a pending Electron transaction.
- Notion is accepted by desktop types but rejected by the backend.
- Encrypted tokens have no key version, making rotation difficult.

Implementation direction:

- Attempt provider-side revocation during disconnect.
- Clear encrypted access and refresh tokens after disconnect.
- Track pending integration state in Electron and correlate the callback.
- Remove Notion types until implemented, or implement it end to end.
- Add encryption key identifiers and a rotation or re-encryption strategy.
- Consider authenticated encryption associated data that binds ciphertext to the connection and provider.

### Configuration inconsistencies

- Default CORS configuration uses `orion.com`, while the app otherwise uses `orion.app`.
- `Access-Control-Allow-Origin` is incorrectly listed as an allowed request header.
- `AllowCredentials` may be unnecessary because API authentication uses bearer tokens rather than cookies.
- The backend requires a local `.env` file even in production.
- Firebase client and backend service-account project IDs are not cross-validated.

## Live Supabase database review

The Supabase project was inspected through the project-scoped MCP server on 2026-08-11 and then reset to the canonical development schema described in `supabase/schema.sql`.

### Confirmed good foundations

- All 17 application tables in `public` have RLS enabled and forced.
- `user_auth_identities` already enforces unique provider subjects and one identity per user/provider.
- The identity foreign key cascades on hard user deletion.
- No public functions, `SECURITY DEFINER` functions, or auth-table triggers were found.
- The live public tables contained zero rows before and after the reset.

### Database access model must be explicit

The backend currently connects directly to Postgres through `DATABASE_URL`; the application does not use a Supabase client for ordinary data access.

Before execution:

- `anon` and `authenticated` have broad table privileges on all 16 public tables.
- Ten tables have RLS enabled but no policies, so Data API access fails closed for those tables.
- The remaining six tables have a small, inconsistent policy set.
- Existing policies use `auth.jwt() ->> 'app_user_id'`, but Orion does not currently issue that Firebase claim.
- Some policies target `public` while others target `authenticated`.
- No table uses `FORCE ROW LEVEL SECURITY`.

Implemented current architecture: application data is backend-only.

- `anon` and `authenticated` have no application schema, table, or sequence privileges.
- Historical implementation used `SET ROLE orion_backend` on every physical database connection. The Supabase Auth replacement supersedes this with direct authentication as the `orion_backend` LOGIN role so the process no longer holds an owner credential.
- Treat handler and repository authorization as the primary enforcement boundary.
- Forced RLS and complete backend-role policies provide defense in depth without exposing the Data API to clients.

If direct client access is intentionally added later:

- Configure Supabase third-party authentication for the Firebase project.
- Ensure Firebase tokens receive the required `role: authenticated` claim.
- Prefer the verified Firebase `sub` claim, which should equal Orion's application user ID, instead of inventing an unused `app_user_id` claim.
- Add complete ownership policies for every exposed table and every allowed command.
- Use both `USING` and `WITH CHECK` for updates.
- Restrict accepted Firebase issuer and audience where applicable.
- Test the policies with anon, authenticated, wrong-user, suspended-user, and deleted-user cases before exposing the Data API.

### User lifecycle invariants are missing

The live `users` table allows `status` and `email_verified` to be null. Nothing ensures that `status = 'deleted'` agrees with `deleted_at`, and the current repository soft delete only sets `deleted_at`.

The rebuilt schema and repository should:

- Make `status` and `email_verified` non-null.
- Enforce that deleted status and deletion timestamp agree.
- Update `status`, `deleted_at`, and `updated_at` together.
- Revoke Firebase refresh tokens and close active sockets as part of the application-level suspension or deletion workflow.

### Email uniqueness is internally contradictory

The live database has both a permanent case-sensitive `UNIQUE (email)` constraint and a partial case-insensitive unique index for non-deleted users. After soft deletion, the exact spelling remains unavailable while a differently cased spelling may be accepted.

Choose one policy and encode only that policy:

- Recommended: normalize email explicitly and enforce one case-insensitive unique identity. If deleted accounts should release an email, anonymize or clear the retained email as part of deletion and preserve the security/audit tombstone separately.
- Alternative: allow reuse after deletion with a single partial case-insensitive unique index and remove the permanent case-sensitive constraint.

Do not keep both current indexes.

### Ownership integrity needs database support

Several tables carry both a user ID and a reference to another user-owned resource without guaranteeing that both belong to the same user.

Confirmed examples:

- `conversations.user_id` has no foreign key to `users`.
- Calendar sources, preferences, and sync state can pair a `user_id` with an integration connection owned by another user.
- Notes can reference another user's folder or calendar event.
- Conversations can reference another user's note or folder.
- Attachments and recording sessions can pair one user's ID with another user's note.

During the schema reset, add composite ownership keys and foreign keys where a child stores both `user_id` and a parent ID. This prevents cross-user relationships even if a handler check is missed.

### Remote schema history is not a constraint

The earlier remote project reported 18 migration-history entries while the repository had no schema source. That history was intentionally treated as disposable development state.

`supabase/schema.sql` is now the clean source of truth. It is intentionally destructive and may be applied to rebuild a development environment; compatibility migrations are not required at this stage.

### Supabase advisor results

- PostgreSQL `15.8.1.111` has outstanding security patches; upgrade before production data is stored.
- Supabase leaked-password protection is disabled. This is not relevant while Firebase is the only user-authentication system, but must be revisited if Supabase password authentication is enabled.
- Existing `auth.jwt()` policies trigger RLS initialization-plan warnings. If retained, wrap stable claim lookup with `SELECT` as recommended by Supabase.
- Unused-index findings are not meaningful yet because the database contains no rows or production workload. Reassess indexes after the final access patterns exist.

## Consolidation and simplification

### Backend

Create a small set of focused components:

1. `AuthPrincipalService`
   - Firebase verification.
   - Revocation classification.
   - Database user loading and status enforcement.
   - Stable auth error codes.

2. `OAuthTransactionStore`
   - Typed login and integration state.
   - Central TTL constants.
   - Atomic consume operations.
   - Input length and format validation.

3. `IdentityService`
   - Transactional user resolution and identity linking.
   - Explicit collision policy.
   - Post-commit side effects.

4. Shared OAuth provider configuration
   - Reuse client credentials, endpoints, timeout-enabled HTTP clients, and URL validation.
   - Keep login scopes separate from integration scopes.

### Desktop and Electron

Use one session coordinator rather than distributing state among:

- `FirebaseAuthContext`
- `DesktopAuthContext`
- `auth-session.ts`
- `auth-handlers.ts`
- `ipc-handlers.ts`
- direct `window.electronAPI` calls

The coordinator should own:

- Explicit session status.
- The currently verified user.
- Token retrieval and refresh.
- Authenticated fetch behavior.
- Main-process state propagation.
- Idempotent invalidation.
- Sign-out versus sign-out-all-devices semantics.
- Multi-window session-expiration messages.

## Dead or removable code

Confirmed cleanup candidates:

### Backend

- `firebaseApp` global.
- `firebaseAuth` global.
- Unused `FirebaseClient.VerifyIDToken`.
- Ignored `customClaims` argument to `CreateCustomToken`.
- Unused provider `Config()` interface method.
- Unused OAuth `renderSuccessPage` and `renderErrorPage`.
- Duplicate Firebase context keys.
- Unused `GetFirebaseUserIDFromContext`.
- `LoginOAuthState.IP`.
- `LoginOAuthState.UserAgent`.
- `LoginOAuthState.CreatedAt`.
- `OneTimeCode.Code`.
- `OneTimeCode.CreatedAt`, if Redis TTL remains authoritative.
- `OneTimeCode.Used`, because atomic deletion already enforces consumption.
- Most provider/user data stored in the one-time code.
- `CreateIntegrationConnectionRequest`.
- `IntegrationProviderNotion` until Notion is implemented.
- Ignored `platform` parameter in `getIntegrationCallbackURL`.
- The unreachable PKCE branch after platform normalization.

### Desktop and web

- `authPersistenceReady = Promise.resolve()`.
- Unused `onAuthStateChanged` export.
- Public context `setUser` API.
- Unused `firebaseUser` argument to `fetchBackendUser`.
- Duplicate cached-user clearing.
- Stored OAuth transaction `provider`, if no provider-specific validation is added.
- Unused `AuthResult.token`.
- Callback event `timestamp`, unless it is used for replay filtering.
- Completion response fields ignored by Electron.
- Notion integration types until supported.
- Direct `window.electronAPI` auth calls that bypass the desktop API abstraction.

## Data minimization

Raw OAuth provider claims are stored indefinitely in `user_auth_identities.raw_claims` and are included in the login completion payload even though no active consumer was found.

For Orion's privacy-focused direction:

- Do not store raw provider payloads by default.
- Store only the provider subject, normalized email where needed, verification status, display name, avatar reference, tenant ID where applicable, and timestamps.
- Do not return provider data from `/auth/complete`.
- Prefer storing only the app user ID and minimal completion metadata in Redis.
- Mint the Firebase custom token at successful `/auth/complete` after PKCE verification rather than storing it inside Redis.
- Reduce PII in authentication logs, especially email addresses, names, and provider response bodies.

## Verification policy during early development

The owner has explicitly chosen not to keep automated tests or test CI in the codebase at this stage. All existing test/spec files and the auth test workflow were removed. This is a conscious scope decision, not a claim that the behavior has automated coverage.

Current verification is limited to compiler, type-checker, linter, static-analysis, schema, and live-database inspection. Reconsider automated behavior and security regression coverage before production, external security review, or onboarding real customer data.

## Enterprise capabilities not yet present

These should follow stabilization of the current single-user authentication system:

- Organizations and tenant membership.
- Tenant-scoped roles and permissions.
- SAML or enterprise OIDC SSO.
- Domain verification and domain ownership policy.
- SCIM provisioning and deprovisioning.
- MFA or recent-authentication rules for sensitive operations.
- Session and device inventory.
- Per-device revocation.
- Administrative all-device revocation.
- Immutable security audit events.
- Administrative suspension and deletion workflows.
- Consent and policy version recording.
- Account deletion, export, and retention workflows.
- Secret and encryption-key rotation.
- Tested account recovery and provider-linking procedures.

## Implemented auth architecture

### Login and principal resolution

1. The desktop opens a validated Google or Microsoft authorization URL and stores a PKCE transaction.
2. The backend atomically consumes OAuth state, exchanges the provider code with a bounded request, and normalizes the minimum provider identity.
3. A serializable database transaction resolves or creates the Orion user and immutable provider identity. Google verified-email linking is allowed; Microsoft email linking is not.
4. The backend synchronizes the Firebase user, then issues a one-time completion code. The desktop proves PKCE possession when consuming it and signs into Firebase with the resulting custom token.
5. The renderer sends the Firebase ID token to the main process. The main process accepts it only after `/api/user/me` verifies revocation and resolves an active, non-deleted Orion user.
6. Every protected HTTP request repeats that principal resolution. WebSockets use the same resolver at connection time and periodically while connected.

### Trust boundaries

- Firebase proves external session identity; Orion's database controls application existence and lifecycle status.
- The Electron renderer is untrusted. The main process owns the verified token and principal, validates IPC senders, and performs integration requests itself.
- Browsers and desktop clients never receive application-table access. The Go backend is the only application data path.
- On the Supabase Auth branch, PostgreSQL connections authenticate directly as `orion_backend`; forced RLS and ownership-aware repository queries constrain that role.
- Redis contains short-lived, single-use OAuth state and completion material, not a durable user session registry.
- Integration credentials are encrypted using a versioned keyring and are hard-deleted on disconnect.

### Session and revocation semantics

- Local sign-out clears the current Firebase and desktop state only.
- Sign out everywhere revokes all Firebase refresh tokens and closes every registered socket for the user.
- Revoked, expired, disabled, missing, suspended, deleted, and inactive principals receive stable auth error codes.
- A 401 triggers one bounded token refresh and retry. A terminal failure clears all local auth state idempotently.
- Sockets revalidate within one minute and have a 50-minute maximum lifetime, bounding stale access even if an out-of-band lifecycle change does not emit a local event.

## Auth incident procedures

### Suspected user-session compromise

1. Set the application user to suspended using an authorized administrative database path.
2. Revoke the user's Firebase refresh tokens.
3. Disconnect all active sockets for that user; the periodic principal check is the fallback.
4. Review provider, Firebase, backend, and database logs using immutable identifiers rather than copying PII into incident notes.
5. Restore the user to active only after account recovery and identity ownership are verified.

### OAuth client secret or Firebase credential exposure

1. Rotate or revoke the credential at the provider immediately.
2. Update the deployment secret store; do not place replacement credentials in repository files.
3. Restart all backend instances so validated configuration and clients use the replacement.
4. For Firebase signing/admin compromise, revoke affected sessions and review issued-token activity.
5. Verify login, callback, and logout behavior through the approved non-test static/manual verification policy before reopening access.

### Integration encryption-key exposure

1. Add a new key and version to `ENCRYPTION_KEYS`, select it with `ENCRYPTION_KEY_VERSION`, and redeploy so all new writes use it.
2. Reconnect or re-encrypt remaining integrations before removing the compromised version.
3. Revoke provider grants for connections whose ciphertext may have been exposed.
4. Remove the old key only after no stored row references its version.

### Database or authorization exposure

1. Revoke client-facing application-table privileges and verify `anon` and `authenticated` remain without access.
2. Rotate database credentials and confirm connections select `orion_backend` rather than an owner or bypass-RLS role.
3. Suspend affected accounts and revoke Firebase sessions when user scope is uncertain.
4. Rebuild the development database from `supabase/schema.sql` if integrity cannot be established. This destructive option is valid only while the environment contains no production/customer data.
5. Run schema, grants, policies, forced-RLS, ownership-constraint, row-count, and advisor inspection before restoring service.

## Proposed implementation phases

### Phase 1: Immediate safety fixes

- Add active database-user enforcement to HTTP and WebSockets.
- Remove Electron fail-open verification.
- Harden renderer navigation and IPC sender checks.
- Fix initial token-fetch invalidation.
- Prevent cached profile data from establishing authentication.
- Introduce stable auth error codes.
- Choose and lock the database access model; recommended: backend-only with Data API table access disabled or revoked.
- Make user status, deletion state, and email uniqueness internally consistent.

### Phase 2: Identity and schema integrity

- Reset or reshape the development schema freely rather than preserving the current remote history.
- Establish one clean reproducible schema baseline after the design settles.
- Make user and identity resolution transactional.
- Prevent provider identity reassignment.
- Define and implement provider-linking policy.
- Correct Firebase user creation and error classification.
- Add composite ownership constraints that prevent cross-user resource relationships.
- Keep collision handling explicit and database-enforced; automated tests are deferred by owner decision.

### Phase 3: Session consolidation

- Introduce the explicit desktop auth state machine.
- Consolidate renderer and main-process auth ownership.
- Remove redundant state notifications and token refresh paths.
- Split local sign-out from all-device revocation.
- Add WebSocket connection expiration and forced disconnect.

### Phase 4: OAuth and integration hardening

- Add request contexts and timeouts.
- Validate all configuration and redirect URLs at startup.
- Reduce login provider scopes.
- Correlate integration callbacks.
- Revoke and erase integration tokens on disconnect.
- Add encryption key versioning.
- Minimize stored provider claims and authentication logs.

### Phase 5: Cleanup and verification

- Remove confirmed dead code.
- Normalize error response contracts.
- Run compiler, type, lint, static, schema, and live-database checks; tests and test CI are intentionally deferred.
- Keep schema reproducibility validation manual while the destructive early-development baseline is allowed.
- Document the auth architecture and incident procedures.

### Phase 6: Enterprise identity layer

- Add organizations and authorization roles.
- Add enterprise SSO, domain verification, and SCIM.
- Add device/session administration and security audit logs.

## Decisions required before implementation

Recommended defaults are included below.

1. Logout behavior
   - Recommended: ordinary logout is local; provide a separate logout-all-devices action.

2. Account linking
   - Recommended: never silently link Microsoft by email. Require an authenticated, recent-session linking flow.

3. User status
   - Recommended: only `active` users may authenticate or use APIs; suspension and deletion immediately revoke sessions and sockets.

4. Offline behavior
   - Recommended: fail closed for authentication now. Design an explicit bounded offline mode separately if local-only operation becomes a product requirement.

5. Notion integration
   - Recommended: remove the exposed type until implemented end to end.

6. Raw provider claims
   - Recommended: stop storing and returning them unless a documented feature requires specific fields.

7. Revocation performance
   - Recommended: retain server-side revocation checks initially for correctness, measure the latency, then design a bounded cache or session registry if needed.

8. Database access model
   - Recommended: backend-only for now. Revoke or disable direct Data API access to application tables and use a least-privileged backend database role.

9. Deleted-account email reuse
   - Recommended: keep one normalized case-insensitive identity rule. If reuse is allowed, anonymize the deleted account's email and retain audit data separately rather than depending on contradictory indexes.

## Definition of done

The current auth refactor should be considered complete when:

- Every HTTP and WebSocket request resolves one active application principal.
- Suspended, deleted, revoked, and missing users are rejected consistently.
- Electron never trusts an unverified renderer token.
- Identity linking is transactional and cannot transfer provider ownership.
- Session restoration does not display authenticated UI before server validation.
- Local logout and all-device logout have distinct, reliable semantics.
- Existing WebSockets are terminated on relevant revocation events.
- Integration disconnect removes usable credentials.
- OAuth configuration fails safely at startup when invalid.
- Dead code and duplicate session state have been removed.
- The database has one reproducible canonical schema; the current development migration history does not need to be retained.
- User lifecycle, normalized email identity, and cross-resource ownership invariants are enforced by that schema.
- The Data API and backend database role match the explicitly chosen access model.
- Compiler, type, lint, static, schema, and live-database verification passes. Automated tests and test CI remain explicitly deferred by owner decision.
