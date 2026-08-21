# Legacy note sharing and collaboration removal plan

## Status

Implemented on 2026-08-21. Runtime note-sharing and collaborative-editing scaffolding was removed from the backend and desktop, the empty live `note_shares` table was dropped through migration `20260821211855_remove_legacy_note_sharing`, the canonical schema was updated, and stale collaboration documentation was removed or corrected. Replacement note sharing was not implemented.

Live database preflight recorded zero `note_shares` rows and no status-grouped rows. Dependency inspection found only objects owned by the table itself, so the migration safely used `DROP TABLE public.note_shares` without `CASCADE`.

Verification completed with backend tests, Go vet/build, desktop TypeScript, zero-warning lint, 35 desktop tests, renderer/main/preload production builds, live schema and migration inspection, Supabase security/performance advisors, repository-wide absence checks, and `git diff --check`. The advisors reported no finding introduced by this removal; remaining project-level warnings and informational notices are unrelated to note sharing.

## Goal

Return Orion's note system to one clear, truthful model:

- Notes are private and accessible only to their owner.
- Note attendees are meeting metadata and never grant access.
- The existing application WebSocket continues to handle authentication, generic resource invalidation, and active domain events such as calendar synchronization.
- No note-sharing, collaborator-role, live-editing, presence, room, or patch API remains in runtime code or active implementation documentation.
- A future view-only sharing system may be designed in a separate phase after this cleanup is complete.

This removal must eliminate the incomplete subsystem end to end rather than merely hiding its UI.

## Why this cleanup is required

The repository currently contains a partially implemented sharing design that can create `pending` share records and send invitation emails, but it never grants recipients access. Normal note reads and writes remain owner-only. The renderer also declares unused collaboration events, while the backend WebSocket discards client application messages and has no note rooms, presence tracking, patch processing, or conflict handling.

Leaving this scaffolding creates several problems:

- An invitation email can claim that a recipient has access when they do not.
- The database and API advertise `viewer` and `editor` permissions that are never enforced.
- The desktop type uses `active`, while the database uses `accepted` and `revoked`.
- Future sharing work could accidentally build on an incomplete and contradictory model.
- Unused collaboration event types imply capabilities the WebSocket does not support.

## Product decisions

### Owner-only notes remain the current contract

After this work, every note list, detail, update, delete, transcript, attachment, recording, attendee, and note-linked AI operation must continue to require the owning user. This pass must not broaden note access.

### Attendees remain

Keep the active `note_attendees` system and its calendar synchronization. An attendee is a person associated with a meeting, not a viewer, editor, collaborator, or authorization principal.

The cleanup must not remove or change:

- `note_attendees`
- manual attendee management
- calendar-derived attendee synchronization
- attendee display in the note editor
- attendee matching to an Orion user for display metadata

### The shared WebSocket remains

Keep the existing authenticated WebSocket, connection lifecycle, account/user isolation, generic `resource.changed` invalidation, calendar synchronization events, and every active subscriber. Remove only unused note-collaboration protocol declarations.

Do not open a new WebSocket and do not redesign the current WebSocket in this pass.

### Existing share data is legacy and will be deleted

Dropping `note_shares` will permanently remove any existing rows. Before applying the migration, record the row count and grouped status counts in the execution notes so the destructive effect is known. No compatibility export, conversion, or backfill is required because the records do not currently grant functional access.

If the production count is unexpectedly nonzero, confirm that no external or unpublished client depends on the endpoints before proceeding. This is a deployment safety check, not a reason to retain the subsystem indefinitely.

### Future sharing is a separate phase

Do not preserve placeholder tables, roles, statuses, event types, API methods, context state, or email templates for possible reuse. The later view-only sharing phase should start from an explicit product and security design based on requirements at that time.

The future phase may consider secure, revocable, view-only access, but this plan must not implement or pre-design its schema, invitation lifecycle, token model, URLs, caching, UI, or permissions.

## Removal inventory

### Database

Remove:

- `public.note_shares`
- `note_shares_note_email_key`
- `note_shares_note_owner_idx`
- `note_shares_shared_by_idx`
- `note_shares_user_idx`
- the table's RLS configuration and `backend_only` policy by dropping the table
- `note_shares` from canonical schema loops that enable RLS, create backend policies, grant backend privileges, or revoke client privileges

Because the indexes, foreign keys, RLS policy, and grants belong to the table, the live migration should use a direct `DROP TABLE public.note_shares` after the preflight count. Do not use `CASCADE` unless dependency inspection proves an unexpected dependent object must also be deliberately removed. The migration should fail visibly on an unknown dependency.

Update `supabase/schema.sql` so a clean environment no longer creates or configures `note_shares`.

### Backend

Delete:

- `backend/internal/handlers/note_shares.go`
- `backend/internal/repository/note_share.go`
- `models.NoteShare` from `backend/internal/models/note.go`
- `email.Service.SendNoteShareInvite`
- `noteShareInviteTemplate`

Remove from `backend/cmd/api/main.go`:

- note-share repository construction
- note-share handler construction
- `GET /api/notes/:noteID/shares`
- `POST /api/notes/:noteID/shares`
- `PATCH /api/notes/:noteID/shares/:email`
- `DELETE /api/notes/:noteID/shares/:email`
- obsolete comments and imports left by those registrations

Do not add replacement endpoints, redirects, `410 Gone` handlers, feature flags, or compatibility aliases unless evidence reveals a released external client. The current desktop has no UI consumer, so complete removal is the default.

### Desktop

Remove from `desktop/src/features/notes/types.ts`:

- `NoteShare`
- `viewer`/`editor` share-role unions associated with it
- legacy share statuses

Remove from `desktop/src/features/notes/api/notes-client.ts`:

- `ApiNoteShare`
- the share response mapper
- `listNoteShares`
- `createNoteShare`
- `updateNoteShare`
- `deleteNoteShare`
- imports used only by sharing

Remove from `desktop/src/features/notes/DashboardNotesContext.tsx`:

- share imports
- `SharesEntry`
- `noteSharesByNoteId`
- `loadSharesForNote`
- `createShare`
- `updateShare`
- `removeShare`
- all provider values, memo dependencies, and state updates used only by sharing

Confirm that `desktop/src/features/notes/api/search-client.ts` contains no actual sharing behavior. Its appearance in broad searches is currently caused by ordinary note mapping fields; do not edit unrelated mapping code.

### Live editing and presence declarations

Remove from `desktop/src/app/realtime/types.ts`:

- server event `note.updated`
- server event `note.presence`
- client event `note.join`
- client event `note.leave`
- client event `note.patch`
- `PresenceUser`

If removing the note events makes `ClientEventMap` empty, simplify or remove the generic client-event typing and `send` surface only if repository-wide usage confirms nothing uses it. Do not weaken typing for active WebSocket behavior merely to avoid an empty map.

Do not remove the local behavior where AI-driven changes refresh the owner's editor. That is ordinary single-user state synchronization, not collaborative live editing.

### Documentation

Delete `docs/note-sharing-plan.md`. It is explicitly historical, describes an unimplemented permission system, and should not remain as an apparent implementation reference.

Update `docs/context-files-plan.md` to remove or rewrite assumptions about:

- note and folder collaborators
- owner/editor/viewer matrices
- inherited folder sharing
- collaborator access to context files
- event visibility rules framed around collaborators
- attendee-to-collaborator invitation behavior

The context-files plan should describe owner-only behavior for its current phase. Sharing integration belongs in a future sharing document once that system exists.

Keep `docs/private-enterprise-strategy.md` as the authoritative product-direction document. It may retain a concise statement that secure view-only sharing is a later capability and that collaborative editing remains deferred. Ensure it does not claim that sharing is currently implemented.

Update any operational or feature plan that claims note collaboration events currently exist or will remain unaffected. References that merely say a change does not alter note collaboration should be rewritten to say that it does not alter owner-only note behavior or the shared WebSocket, as appropriate.

## Execution phases

### Phase 1: preflight and dependency audit

1. Search the complete repository for every database, Go, TypeScript, route, email, test, and documentation reference listed above.
2. Inspect database dependencies on `public.note_shares`, including foreign keys, views, functions, triggers, policies, and grants.
3. Record live total and status-grouped row counts.
4. Confirm from runtime telemetry or available access logs that no released client calls the four share endpoints. If such telemetry does not exist, document that limitation and rely on the absence of a desktop consumer plus product status.
5. Capture the current owner-only note authorization checks as the security baseline.

Exit condition: the exact destructive scope is known and no unidentified runtime dependency remains.

### Phase 2: remove runtime application code

1. Remove backend routes, wiring, handler, repository, model, and invitation email code.
2. Remove desktop share types, API methods, context state, and provider surface.
3. Remove unused note-collaboration and presence event declarations.
4. Run formatting and compile-focused verification immediately so dangling imports and types are found before the database change.

Exit condition: neither backend nor desktop contains a callable note-sharing or collaborative-editing path.

### Phase 3: remove database state

1. Apply a named forward-only database migration that drops `public.note_shares` without `CASCADE`.
2. Update the canonical schema to omit the table, indexes, RLS/policy-loop membership, grants, and revocations.
3. Verify the live table and associated indexes/policies no longer exist.
4. Run database security and performance advisors and investigate any new finding caused by this migration.

Exit condition: live and clean-install schemas agree that no note-sharing permission storage exists.

### Phase 4: remove stale documentation

1. Delete the historical note-sharing plan.
2. Make the context-files plan owner-only.
3. Correct incidental documentation references to note collaboration.
4. Retain only the high-level future view-only direction in the product strategy and in the final section of this document.

Exit condition: no active plan suggests editor roles, collaborators, presence, or live note editing exists today.

### Phase 5: full verification and handoff

Run the repository's existing verification suites in proportion to the affected surfaces:

- Go formatting
- backend tests
- backend vet/static analysis
- backend build
- desktop TypeScript check
- desktop lint
- desktop tests
- renderer production build
- Electron main/preload production build
- schema validation and live metadata inspection
- database security and performance advisors
- `git diff --check`

Perform targeted manual verification:

- Owners can list, open, edit, autosave, move, and delete their notes.
- Non-owners cannot retrieve or mutate another user's note through existing note endpoints.
- Manual attendees can be added and removed.
- Calendar attendees still synchronize into linked notes.
- Attendees do not affect authorization.
- Generic cross-device cache invalidation still works through the existing WebSocket.
- Calendar live synchronization still works.
- No note-share request is emitted by the desktop.
- The API returns `404` for the removed share routes rather than exposing a partial handler.
- No note-sharing email can be sent.

Exit condition: all automated checks pass, manual owner-only behavior is intact, and repository-wide searches find no unintended sharing or collaboration remnants.

## Required repository-wide absence checks

After implementation, searches should return no runtime-code matches for:

- `note_shares`
- `NoteShare`
- `SendNoteShareInvite`
- `noteShareInviteTemplate`
- `/shares` under note routes
- `note.updated`
- `note.presence`
- `note.join`
- `note.leave`
- `note.patch`
- `PresenceUser`
- note-specific `viewer` or `editor` authorization
- note or folder collaborator permission matrices

Expected exceptions:

- this completed removal record may name deleted concepts for audit history
- `private-enterprise-strategy.md` may mention deferred collaboration and future view-only sharing
- unrelated uses of words such as `editor`, `presence`, or provider OAuth permissions must not be removed

## Security invariants

- Every note operation remains scoped to the authenticated owner.
- The renderer never receives direct database privileges.
- Removing `note_shares` must not broaden RLS or backend grants on any other table.
- Attendee identity matching must not become an authorization path.
- The generic WebSocket remains authenticated, account/user isolated, periodically revalidated, and bounded by its existing lifetime controls.
- No compatibility fallback may infer access from email address, calendar attendance, folder membership, or cached client state.

## Risks and mitigations

### Existing legacy rows are destroyed

Mitigation: record counts and inspect dependencies before the migration. The records have no functioning acceptance/access path, so they should not be migrated into a future design.

### An unpublished client may call the API

Mitigation: check available logs and release history. If a real consumer is found, inventory it explicitly before removal; do not silently preserve unsafe behavior.

### Sharing removal accidentally damages attendees

Mitigation: keep attendee code and schema out of the deletion set, add targeted attendee regression coverage, and manually verify both manual and calendar-sourced attendees.

### WebSocket cleanup removes active invalidation behavior

Mitigation: remove only the five unused note event names and `PresenceUser`; retain and verify `resource.changed`, `calendar.sync_status`, authentication events, the hub, and all active bridges.

### Documentation becomes ambiguous about future direction

Mitigation: distinguish three facts consistently: notes are owner-only now, legacy sharing has been removed, and view-only sharing is a possible next phase but is not implemented.

## Rollout and rollback

This can be delivered as one coordinated application-and-schema release because the current desktop has no sharing UI consumer. Apply runtime removal and the table drop within the same deployment window.

Rollback means reverting the application commit and applying a new forward migration that recreates the old table only if an unexpected operational dependency is discovered. Deleted rows will not be recoverable without a database backup. Do not keep dormant runtime code solely to make rollback easier.

## Completion criteria

This plan is complete only when:

- the `note_shares` table and related database objects are absent
- all note-share API routes and backend implementation are absent
- all desktop note-share state and client methods are absent
- unused note live-editing and presence event declarations are absent
- active attendees and active WebSocket behavior still work
- note authorization remains owner-only
- stale collaborator/editor documentation is removed or corrected
- automated and targeted manual verification passes
- the final implementation record includes the live pre-removal row counts and migration identifier

## Later phase: view-only note sharing

After this cleanup ships, create a new plan for view-only note sharing when the product is ready to implement it. That plan must be based on current requirements and a fresh threat model. It should not assume compatibility with the deleted roles, statuses, endpoints, email copy, context state, or WebSocket event names.

The later phase is deliberately not part of this plan and must not be partially implemented during this cleanup.
