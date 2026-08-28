# Calendar Events and Attendee System Audit

**Date:** 2026-08-22; re-reviewed 2026-08-27
**Scope:** Calendar integrations, provider synchronization, cached events, linked notes, attendee reconciliation, database security, desktop consumers, and automated tests.

## Executive summary

The audit originally found five high-severity and seven medium-severity correctness defects. All twelve findings were remediated on 2026-08-22 in the application and the dev Supabase project. The existing backend-owned calendar architecture was retained and evolved: provider events remain an ephemeral cache, while linked-note history now lives in a durable snapshot.

The application is still in development, so the canonical schema and live dev database were updated directly without adding a migration. The desktop, web, Stripe CLI, and rebuilt backend remain running as monitorable background processes for this session.

## Implementation outcome

| Area | Outcome |
| --- | --- |
| Disconnect and deletion safety | Resolved with a locally authoritative transaction, durable snapshots, and compatible `ON DELETE SET NULL` ownership constraints. |
| Note linking | Resolved with one atomic backend link/relink/unlink command and a database uniqueness invariant. |
| Synchronization | Resolved with per-connection advisory locking, per-calendar apply transactions, explicit partial failure, pagination, source reconciliation, retries, and safe token refresh. |
| Attendees | Resolved with normalized provider attendees, source-aware reconciliation, suppression records, and targeted note invalidations. |
| Retention | Resolved with explicit cleanup of events older than the active window; durable note snapshots survive cleanup. |
| Client contract | Resolved with separate organizer name/email fields and distinct empty, cached, syncing, partial, and failed states. |
| Verification | Backend and desktop suites pass; provider contract tests and live rollback-only database invariant tests pass. |

## P1 — High severity (resolved)

### 1. Disconnect can revoke the provider token and then fail locally — resolved

**Locations:**

- `backend/internal/handlers/integration_oauth.go:329`
- `backend/internal/repository/integration_connection.go:138`
- `supabase/schema.sql:551`
- `supabase/schema.sql:580`
- `supabase/schema.sql:618`

Provider credentials are revoked before the local connection is deleted. Deleting an integration cascades through `calendar_sources` and `calendar_events`, but linked notes prevent the event rows from being deleted because their foreign key has no compatible deletion behavior.

This leaves the user with an active local connection whose provider token has already been revoked.

**Recommended fix:** Resolve linked-event ownership transactionally before revocation. Detach notes, preserve an immutable event snapshot, or otherwise make the cascade valid. Revoke the provider token only after the local transition succeeds.

### 2. Cancelled linked events can permanently break synchronization — resolved

**Locations:**

- `backend/internal/repository/calendar_cache.go:390`
- `backend/internal/repository/calendar_cache.go:429`
- `supabase/schema.sql:618`

Full and incremental synchronization delete cancelled, missing, or reclassified events. A linked note prevents that deletion, causing the sync to fail before the new provider token is persisted. Every later synchronization retries the same failing deletion.

**Recommended fix:** Define an explicit linked-event deletion policy. Options include `ON DELETE SET NULL`, preserving event snapshots independently of the cache, or unlinking notes and reconciling attendees before deleting cached events.

### 3. Failed synchronization is reported as successful — resolved

**Locations:**

- `backend/internal/calendar/sync.go:162`
- `backend/internal/calendar/sync.go:281`
- `backend/internal/calendar/sync.go:228`
- `backend/internal/handlers/calendar.go:163`

Connection-level failures are logged and discarded. Individual calendar fetch failures are also swallowed. The connection is subsequently marked successful, freshness timestamps are advanced, and a waiting manual-sync request returns HTTP 200.

The cache can therefore be stale while the API reports a successful, fresh synchronization.

**Recommended fix:** Aggregate connection and calendar errors, represent partial success explicitly, and never advance freshness metadata for a failed calendar. Waiting API requests should return an error or a structured partial-success response.

### 4. Linked-note attendee reconciliation loses source semantics — resolved

**Locations:**

- `backend/internal/handlers/notes.go:664`
- `backend/internal/repository/note_attendee.go:66`
- `desktop/src/features/notes/NoteEditorView.tsx:188`

Linking an existing note does not reconcile attendees on the backend. The desktop compensates by calling the manual-attendee endpoint once per event attendee. Those attendees become `source='manual'`, so later calendar synchronization will never remove them when they decline, leave the event, or the note is unlinked.

Relinking and unlinking are also not atomic with attendee reconciliation.

**Recommended fix:** Move link, relink, unlink, and attendee reconciliation into one backend transaction. Calendar-derived attendees must retain `source='calendar'`; stale calendar attendees should be removed on relink or unlink while genuine manual attendees remain.

### 5. One-note-per-event is not enforced by the database — resolved

**Locations:**

- `backend/internal/handlers/notes.go:582`
- `backend/internal/handlers/notes.go:682`
- `supabase/schema.sql:719`

The create path uses a read-before-insert check, which is vulnerable to concurrent requests. The handler expects a `notes_one_per_event_idx` database error, but that index is absent from both the checked-in schema and the live database.

**Recommended fix:** Add a partial unique index on `(user_id, calendar_event_id)` for active notes where `calendar_event_id IS NOT NULL` and `deleted_at IS NULL`, then handle that constraint deterministically.

## P2 — Medium severity (resolved)

### 6. Calendar event PII is retained indefinitely — resolved

**Locations:**

- `backend/internal/calendar/sync.go:116`
- `backend/internal/repository/calendar_cache.go:390`

Cleanup only deletes unseen events that overlap the current moving synchronization window. Once an event ages past the 30-day lower bound, it no longer overlaps future windows and is never deleted. Descriptions, locations, meeting links, and attendee data consequently remain in the database indefinitely.

**Recommended fix:** Add explicit retention cleanup outside the active window after resolving the linked-note deletion policy.

### 7. Calendar-list pagination and source removal are incomplete — resolved

**Locations:**

- `backend/internal/calendar/sync.go:368`
- `backend/internal/calendar/sync.go:599`
- `backend/internal/repository/calendar_cache.go:290`

Google and Microsoft calendar-list requests consume only the first response. Provider page tokens or next links are not followed. Calendar sources removed at the provider are never reconciled out of the cache, so stale calendars can persist and continue producing failed fetch attempts.

**Recommended fix:** Fully consume provider pagination, then reconcile the authoritative source list transactionally. See the [Google CalendarList API](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list) and [Microsoft list calendars API](https://learn.microsoft.com/en-us/graph/api/user-list-calendars?view=graph-rest-1.0).

### 8. Synchronization locks permit overlapping scopes — resolved

**Location:** `backend/internal/calendar/sync.go:178`

The Redis lock key includes `all`, `events`, or `calendars`. Different scopes for the same connection can therefore overlap, racing token refreshes, cache writes, delta-token updates, and synchronization status.

If Redis is unavailable, lock errors are logged and synchronization proceeds without another local or database guard.

**Recommended fix:** Lock per user and connection, coalesce requested scopes, and add a database advisory lock or process-local singleflight fallback.

### 9. Attendee changes do not invalidate note caches — resolved

**Locations:**

- `backend/internal/calendar/sync.go:171`
- `backend/internal/handlers/calendar.go:475`

Calendar synchronization mutates `note_attendees`, but publishes only calendar resource changes. Cached note details on the same or another device may retain stale attendees.

**Recommended fix:** Return changed note IDs from attendee reconciliation and publish targeted note invalidations, or publish a general notes invalidation whenever attendee rows change.

### 10. Provider attendee semantics are discarded — resolved

**Locations:**

- `backend/internal/calendar/sync.go:70`
- `backend/internal/calendar/sync.go:104`

The normalized attendee model retains only name and email. Provider response status, attendee type, optionality, self identity, organizer identity, and resource status are discarded. Declined attendees and resource mailboxes can therefore become note attendees.

**Recommended fix:** Preserve the relevant provider fields and define explicit product rules for accepted, tentative, declined, optional, organizer, self, and resource attendees.

### 11. Calendar failures are rendered as empty calendars — resolved

**Locations:**

- `desktop/src/features/calendar/api/calendar-events-client.ts:101`
- `desktop/src/features/calendar/CalendarView.tsx:324`

The desktop drops the backend's `last_error` field, and the calendar view ignores query errors. An API or synchronization failure can be presented as “No upcoming meetings.”

**Recommended fix:** Preserve synchronization errors in the client snapshot and render failure, stale-cache, syncing, and genuinely empty states separately.

### 12. Organizer name is exposed as an email field — resolved

**Locations:**

- `backend/internal/calendar/sync.go:587`
- `backend/internal/calendar/sync.go:760`
- `backend/internal/models/note.go:47`

The cache stores the organizer display name before the email address, while linked-note responses expose the value as `organizer_email`.

**Recommended fix:** Store organizer name and email in separate columns or a structured object, and migrate the API contract accordingly.

## Implemented remediation map

1. `DisconnectLocal` now preserves or refreshes `note_calendar_links`, removes calendar-derived attendees, detaches live references, and deletes the local connection in one transaction. Provider revocation happens afterward as best-effort cleanup.
2. The note-to-event ownership foreign key uses subset `ON DELETE SET NULL (calendar_event_id)`. `note_calendar_links` retains the immutable meeting snapshot when cached events disappear.
3. Sync errors are aggregated. Complete, partial, and failed states are persisted and returned distinctly; failed calendars do not commit their cursor or freshness transition.
4. `PUT /notes/:noteID/calendar-link` owns link, relink, unlink, snapshot creation, revision checks, attendee reconciliation, and publication. The desktop no longer loops over the manual-attendee endpoint.
5. `notes_one_per_event_idx` now enforces one active note per event, and repository/handler paths map the violation to a deterministic conflict.
6. `DeleteEventsBefore` explicitly removes cached events older than the active window. Linked notes keep their snapshots while live references and calendar attendees are detached.
7. Google page tokens and Microsoft `@odata.nextLink` values are fully consumed. The complete source list is reconciled transactionally and provider-removed sources are deleted.
8. Syncs acquire a PostgreSQL advisory lock keyed only by user and connection, independent of requested scope.
9. Repository sync operations return affected note IDs. Handlers publish targeted note resource events after commits, including disconnect and attendee changes.
10. `calendar_event_attendees` stores response status, attendee type, optional, organizer, self, resource, and provider identifiers. Declined, organizer, self, and resource rows are ineligible for note attendee reconciliation. Manual attendee removals are durable through `note_attendee_suppressions`.
11. Calendar responses and the desktop snapshot preserve `last_error`, `partial`, and `stale`. The desktop keeps stale data available without adding cached-data banners, and shows an unavailable/retry state only when a failure leaves no meetings to display.
12. Organizer display name and email now have separate database columns, backend fields, and desktop fields. The legacy ambiguous column was removed from dev after the rebuilt backend started successfully.

Additional hardening includes bounded provider retries, `Retry-After` handling, pre-expiry token refresh, one safe authorization refresh/retry, per-calendar transactional event/cursor apply, normalized attendee snapshot compatibility, and in-process operational counters for sync duration/outcome, per-calendar failures, refreshes, applied events, affected notes, and retention.

## Security posture

External Supabase roles are revoked from application tables. Fifteen calendar,
connector, link, suppression, and attendee tables have forced row-level security
that compares each row's tenant-owner column with a transaction-local,
UUID-validated tenant. The
narrow `orion_internal.current_tenant_user_id()` helper is executable only by
`orion_backend`, and an unset tenant fails closed. Composite ownership foreign
keys additionally prevent cross-account note/event references. A post-DDL
advisor run found uncovered composite foreign keys on new tables; matching
column-order indexes were added to the hosted project and canonical schema.

The remaining Supabase security advisor items are platform-wide and outside this calendar implementation: leaked-password protection is disabled, the project PostgreSQL version has security patches available, and two usage-accounting tables intentionally have RLS without client policies. Address these before production launch.

## Test and verification results

- `go test ./...` passes, including new Google/Microsoft provider pagination fixtures, attendee-semantic rules, anchored-window behavior, typed partial failures, and targeted cross-device note invalidation behavior.
- Desktop Vitest passes: 10 files and 53 tests.
- Desktop ESLint passes with zero warnings.
- Desktop `tsc --noEmit` passes.
- The rebuilt backend responds successfully at `/api/health` on port 8080.
- A live rollback-only database test proved one-note-per-event uniqueness, event-delete detachment, normalized-attendee cascade, and durable snapshot preservation.
- A second rollback-only database test deleted the connected dev integration and proved that its linked note and snapshot survived; the transaction was rolled back, so the real connection was restored unchanged.
- A third rollback-only database test proved that a note owned by another user cannot reference the event.
- The final schema inspection confirmed forced RLS, backend-only policies, the partial unique index, the composite subset `SET NULL` foreign key, and covering indexes for all new composite foreign keys.
- Supabase security and performance advisors were rerun after the final DDL. No calendar-specific security warning or unindexed calendar foreign key remains.

The repository’s transaction-heavy paths are primarily guarded by the live rollback invariant suite rather than a disposable local Postgres test container. Before production, automate those same SQL invariants in CI against an isolated Supabase/Postgres instance and add provider sandbox end-to-end tests for delta-token expiry, throttling, and revocation failure.

## 2026-08-27 calendar and future-connector re-review

The second review covered the current Go backend, desktop calendar consumers,
canonical schema, connector architecture, and hosted Supabase project. Every
actionable repository and database finding below has been implemented. Two
managed-project settings remain explicitly tracked because neither the
Supabase database API nor the available browser surface can change them.

| Finding | Severity | Disposition |
| --- | --- | --- |
| Forced OAuth refresh reused the still-valid access token | High | Resolved. Refresh now constructs a refresh-token-only source, so a provider `401` cannot silently reuse the rejected token. A regression test verifies the token endpoint is called. |
| Provider response bodies and refresh errors could reach logs or persisted sync errors | High | Resolved. Provider API failures now retain only status and a bounded safe code; OAuth failures are redacted. Regression tests inject secret-bearing bodies and assert that they never escape. |
| The backend database role had permissive `USING (true)` policies | High | Resolved in code, canonical SQL, and hosted Supabase. Calendar, connector, link-snapshot, attendee, and suppression operations bind a UUID-validated tenant to each transaction. Fifteen tables use fail-closed tenant RLS through a narrowly granted stable helper; no permissive legacy policy remains on them. |
| `ListByNote` read `note_attendees` without binding the tenant, so fail-closed RLS returned an empty list | High | Resolved. The repository accepts the authenticated owner and starts a read-only tenant transaction. Attendee and suppression RLS now derives ownership through the parent note, so no duplicate owner column or caller-supplied ownership filter is needed. Both note endpoints propagate repository failures instead of rendering an empty attendee list. |
| `note_attendees.user_id` mixed tenant ownership with optional matched-attendee identity | High | Resolved. Attendee identity matching was removed entirely. `note_attendees` and its suppression table derive tenant ownership through `note_id`; calendar-provider display names are persisted, and attendee avatars are deterministic initials only. |
| One connection-wide sync status conflated calendar-list and event outcomes | Medium | Resolved. Status, start time, last success, and last error are stored independently for calendar-list and event sync scopes, with historical state backfilled in place. |
| Stale GET requests could create duplicate goroutines and block on advisory locks | Medium | Resolved. Stale reads enqueue one idempotent durable job per 15-second bucket; active sync metadata suppresses redundant triggers, and the database lock uses non-blocking `pg_try_advisory_lock`. |
| Home dashboard treated a failed event load as an empty schedule | Medium | Resolved without persistent status banners. If no meetings are available, Home shows an unavailable state and retry; otherwise the last available meetings remain visible silently during stale, partial, or failed refreshes. |
| Future connectors had no durable capability, job, webhook inbox, subscription, outbox, or delivery-attempt contract | High | Resolved at the shared control-plane layer. Six normalized tables, ownership foreign keys, exact indexes, idempotency keys, leases, bounded attempts, `SKIP LOCKED` claims, payload hashing, outbox enqueue, and immutable delivery attempts are implemented. Raw inbound webhook payloads are not retained. |
| Background calendar synchronization was process-local and lost on restart | High | Resolved. Non-waiting refreshes now enqueue durable `calendar.sync` jobs. A database-backed worker discovers due tenants through a narrow security-definer function, claims work under tenant RLS, retries with bounded backoff, dead-letters invalid work, and publishes resource invalidations after processing. The explicit `wait=true` diagnostic path remains synchronous. |
| Existing connections had no explicit capability record and provider identity was calendar-only | Medium | Resolved. Every Google/Microsoft connection is backfilled to `calendar.read`; connection updates maintain that capability. The installation provider constraint now accepts future nonblank providers while calendar handlers remain explicitly Google/Microsoft-only. |
| Queue and RLS query shapes initially lacked tenant-leading and composite-FK indexes | Medium | Resolved after the post-DDL advisor pass. Tenant due-work indexes and exact covering indexes were added. Tenant resolution uses a stable helper through scalar init-plan subqueries. |
| Terminal connector-control records had no bounded retention | Medium | Resolved. An hourly worker invokes a backend-only, batched cleanup that removes succeeded/dead jobs, processed/rejected webhook receipts, and delivered/dead outbox records after 30 days. Pending/retry records are never selected, and delivery attempts cascade with their terminal outbox event. |
| Supabase leaked-password protection is disabled | Platform | Open managed setting. Enable **Auth > Sign In / Providers > Password security > Leaked password protection** before production, following [Supabase password security](https://supabase.com/docs/guides/auth/password-security). The connected database API cannot mutate Auth configuration, and no signed-in browser was available in this run. |
| Hosted Postgres `supabase-postgres-15.8.1.111` has security patches available | Platform | Open managed operation. Schedule the Supabase infrastructure upgrade from project settings after reviewing the downtime, backup, compatibility, and extension caveats in [Supabase upgrading](https://supabase.com/docs/guides/platform/upgrading). This is not a SQL migration and was not forced without a dashboard control surface. |

### Hosted database evidence

- Applied migrations `20260827000000_harden_calendar_and_connector_control_plane`,
  `20260827000001_add_integration_job_coordinator`, and
  `20260827000002_optimize_connector_rls_and_foreign_keys`,
  `20260827000003_harden_integration_job_coordinator`,
  `20260827000004_add_connector_control_plane_retention`, and
  `20260827000005_complete_connector_tenant_isolation`, followed by
  `20260827000006_fix_note_attendee_tenant_ownership` and
  `20260827000007_index_note_attendee_ownership_fk`.
- The attendee identity migrations were applied to hosted Orion through the
  Supabase MCP as remote migrations `20260828044816_persist_calendar_attendee_names`
  and `20260828044835_remove_attendee_identity_contract`. Post-apply checks
  confirmed zero legacy identity columns, both validated parent-note foreign
  keys, parent-note tenant RLS, three retained attendee rows, and no retained
  legacy creator rows.
- The attendee identity removal is an expand/contract deployment, not a rolling
  migration. Stop and drain all API and worker processes first, apply
  `20260828041911_persist_calendar_attendee_names`, then apply
  `20260828043400_remove_attendee_identity_contract`, and only then deploy/start
  the new binary. Old processes require and write the columns removed by the
  contract migration.
- A rollback-only probe using the real `orion_backend` database role verified
  that the owning tenant sees all three retained attendees, wrong and unset
  tenants see none, owner attendee and suppression writes pass, and a
  cross-tenant attendee write is denied.
- Hosted verification returned six new control-plane tables, fifteen tenant
  policies, zero permissive policies on scoped tables, six split sync-state
  columns, zero legacy sync-state columns, zero missing `calendar.read`
  capabilities, and executable access to only the narrow worker coordinator.
- The final policy definitions use
  `(select orion_internal.current_tenant_user_id())`; the stable helper reads
  the transaction-local setting once per statement. An unset setting matches
  no tenant row, and application code validates UUID form before starting the
  transaction.
- A rollback-only hosted test temporarily granted the restricted role to the
  migration session, switched to `orion_backend`, proved that an unset tenant
  sees zero connection rows, proved that a bound tenant sees exactly its own
  rows and no foreign rows, then rolled back. A follow-up check confirmed
  `postgres` did not retain membership in `orion_backend`.
- A second rollback-only restricted-role test proved job deduplication,
  non-bypassable retry backoff, terminal-job requeue, webhook receipt
  deduplication, leased outbox delivery, and immutable successful delivery
  history. It left no verification rows or role grants behind.
- A third rollback-only restricted-role test proved that 30-day cleanup removes
  only terminal jobs, receipts, and outbox events, preserves every nonterminal
  record, and cascades the deleted outbox event's delivery attempts.
- A focused attendee rollback probe against the then-current `00007` schema
  proved its owner-bound policy behavior. That historical probe predates the
  local migration that removes attendee-to-user matching and derives tenant
  access through the parent note.
- A live durable `calendar.sync` job completed successfully against Microsoft;
  its event scope and `calendar.read` capability both recorded success. The
  rebuilt backend then started with the retention-enabled worker and served an
  authenticated `/api/calendar/upcoming` request successfully.
- Security advisors report only the two managed settings above plus the two
  intentionally policy-free usage-accounting tables that are accessible only
  through their existing narrow security-definer function.
- The connector/calendar foreign-key advisor findings were cleared. Newly
  created indexes are naturally reported as unused until production traffic
  exercises them and are not removal candidates.

### Re-review verification gates

- `go test ./...` passes, including forced-refresh, redaction, tenant-ID,
  durable-job construction/backoff, repository helper, handler, and existing
  calendar-provider tests.
- Desktop Vitest (10 files, 53 tests), ESLint, `tsc --noEmit`, and the
  development-mode Vite/Electron build pass. Production build configuration
  correctly requires deployment callback, API, and Supabase values.
- Backend targeted race tests, `go vet ./...`, and `go build ./cmd/api` pass.
- Canonical schema and the eight additive hosted migrations contain the same
  split state, control-plane objects, indexes, grants, coordinator function,
  and tenant-policy contract.

## Recommended architecture

The calendar implementation should be evolved rather than replaced. Provider OAuth, token custody, synchronization, and API access should remain owned by the Go backend. The main change is to separate the ephemeral provider cache from durable note context and make synchronization and attendee reconciliation transactional.

### 1. Treat calendar events as an ephemeral provider cache

`calendar_events` should represent the latest known provider state, not durable note history.

- Track event lifecycle explicitly, such as active, cancelled, or deleted.
- Apply event upserts, removals, and the next sync token in one short database transaction per calendar.
- Perform provider HTTP requests before opening the database transaction.
- Retain only the event window required by the product and purge expired rows explicitly.
- Never allow removal of a cached event to delete or block a note.

### 2. Separate notes from live cache rows

Notes should not depend on a live `calendar_events` row continuing to exist.

- Make the live event reference nullable and compatible with event removal, normally through `ON DELETE SET NULL`.
- Preserve an immutable meeting snapshot for each linked note. The snapshot should include the provider identifiers, title, start and end times, all-day state, organizer, meeting link, event link, calendar name, and relevant location data.
- The snapshot may live in a dedicated `note_calendar_links` table or another explicitly modeled durable structure.
- Enforce one active note per event with a partial unique index on `(user_id, calendar_event_id)` where the event ID is present and the note is not deleted.
- A cancelled event or disconnected provider may clear the live reference while leaving the historical snapshot available to the note.

### 3. Make note-event linking a backend-owned workflow

Link, relink, and unlink operations should be dedicated backend commands rather than generic note patches followed by desktop-side attendee calls.

Each operation should atomically:

1. Validate note and event ownership.
2. Enforce the one-active-note-per-event invariant.
3. Update the live event reference.
4. Create or refresh the durable meeting snapshot.
5. Reconcile calendar-sourced note attendees.
6. Remove stale calendar-sourced attendees on relink or unlink.
7. Commit before publishing note and calendar resource invalidations.

The desktop should issue one link, relink, or unlink request and must not loop over attendees using the manual-attendee endpoint.

### 4. Normalize attendee data and ownership

Because attendees are part of note behavior, provider attendee data should preferably be normalized into a `calendar_event_attendees` child table instead of being queried from an unconstrained JSON array.

Relevant fields include:

- Event and account ownership identifiers.
- Normalized email and display name.
- Provider response status.
- Required or optional status.
- Person or resource type.
- Organizer and self indicators.
- Provider-specific identifier when available.

`note_attendees` should continue to distinguish `manual` and `calendar` origins. Reconciliation may update or remove only calendar-sourced rows; manual rows survive provider changes and unlinking.

The product should explicitly decide what happens when a user manually removes a calendar-sourced attendee. If that removal must survive future syncs, store a suppression record rather than silently changing the attendee to manual or repeatedly re-adding it.

### 5. Introduce a transactional synchronization boundary

Each provider adapter should return a structured result rather than writing incrementally while fetching:

- Upserted events.
- Cancelled or deleted provider event IDs.
- The next sync or delta token.
- Whether the operation was a full or incremental sync.
- Provider warnings and partial failures.

The repository should apply that result atomically per calendar. The next token and freshness timestamp must advance only when the corresponding event changes commit successfully.

Synchronization orchestration should also:

- Use one lock per user and connection, independent of requested scope.
- Coalesce calendar-list and event-sync requests when possible.
- Avoid starting another background sync while the connection is already syncing.
- Fully consume page tokens and next links.
- Reconcile provider-removed calendars after a complete calendar-list fetch.
- Retry throttling and transient provider failures with bounded backoff.
- Refresh access tokens shortly before expiry and retry an authorization failure once when safe.
- Represent complete, partial, and failed outcomes separately.

### 6. Make disconnection locally authoritative

Disconnection should complete the local transition before attempting provider cleanup.

1. Load and retain the decrypted provider token in memory.
2. Transactionally detach live event references, preserve note snapshots, reconcile calendar attendees, and remove the local connection and cache.
3. Commit the local disconnection.
4. Attempt provider-token revocation as best-effort cleanup.
5. Publish calendar and affected-note invalidations.

A provider revocation failure should be recorded for operational follow-up but must not restore or block the local connection. Conversely, the provider token must not be revoked before confirming that the local transition can succeed.

### 7. Preserve the existing security boundary

Provider tokens should remain encrypted at rest and accessible only to the backend. The desktop and web applications should continue to receive normalized calendar data through authenticated Orion APIs rather than calling Google or Microsoft directly.

Repository operations involved in synchronization and linking should require an explicit account ID. If the backend-only RLS model remains, ownership predicates and cross-account rejection tests are mandatory because `orion_backend` policies do not provide per-account isolation.

### 8. Improve client state and observability

The desktop should distinguish:

- A genuinely empty calendar.
- Cached but stale data.
- Active synchronization.
- Partial provider failure.
- Complete API failure.
- A connection that requires authorization again.

Resource events should be emitted only after successful commits. Calendar syncs that change note attendees or linked-event snapshots must invalidate affected note details across devices.

### Phased implementation plan

All five phases below were completed in the dev environment on 2026-08-22. Production-only follow-up is limited to CI/provider sandbox expansion and the platform security items called out above.

#### Phase 1 — Immediate safety (complete)

- Resolve linked-event foreign-key and deletion behavior.
- Correct disconnect ordering.
- Stop reporting failed and partial synchronization as successful.
- Add the one-active-note-per-event unique index.
- Add regression tests for these invariants.

#### Phase 2 — Transactional note linking (complete)

- Add backend link, relink, and unlink operations.
- Add durable meeting snapshots.
- Move attendee reconciliation out of the desktop.
- Publish targeted note invalidations after commit.

#### Phase 3 — Synchronization hardening (complete)

- Add per-connection locking and per-calendar transactional apply operations.
- Add complete pagination and calendar-source reconciliation.
- Add bounded retries, safer token refresh, and partial-result reporting.

#### Phase 4 — Attendee and retention model (complete)

- Normalize provider attendee records and response semantics.
- Define suppression behavior for manually removed calendar attendees.
- Add explicit event and attendee retention cleanup.
- Add performance indexes based on the final access patterns.

#### Phase 5 — Client and operational coverage (complete)

- Render empty, stale, syncing, partial-error, and reconnect states separately.
- Add provider contract fixtures for Google and Microsoft.
- Add cross-device cache-invalidation tests.
- Add metrics for sync duration, per-calendar failure, token refresh, event counts, attendee changes, and retention cleanup.

## Recommended remediation order

Completed in this order on 2026-08-22:

1. Fix linked-event deletion and disconnect ordering.
2. Stop reporting failed or partial synchronization as successful.
3. Move note-event linking and attendee reconciliation into an atomic backend workflow.
4. Add the one-active-note-per-event database constraint.
5. Add integration tests for those four invariants.
6. Implement retention, pagination, source reconciliation, and sync locking.
7. Improve attendee normalization, cache invalidation, and desktop error states.
