# Email Draft settings: initial setup plan

## Status

Implemented on 2026-08-20. The authenticated singleton settings API, live Supabase table, backend-owned defaults, partial autosaving mutations, shared TanStack Query cache, and generic cross-device invalidation are in place. Email generation and Gmail/Outlook delivery remain deliberately unimplemented.

Verification completed with live database metadata and constraint checks, Supabase security/performance advisors, backend tests/vet/build, desktop TypeScript/lint/tests, renderer/main/preload production builds, and `git diff --check`.

## Goal

Make the Email Draft settings page functional as an account-owned configuration screen:

- Load one Email Draft settings record for the signed-in account.
- Persist whether future email-draft generation is enabled.
- Persist whether generated emails should include a meeting-sharing link.
- Persist one custom draft prompt with a maximum of 1,000 characters.
- Autosave changes without adding a Save button.
- Render immediately from the existing account-scoped TanStack Query cache.
- Synchronize changes across the account's active devices through the existing Redis and WebSocket resource-invalidation path.

This phase stores configuration only. It must not generate an email, inspect a meeting, connect an email account, or write a draft to an email provider.

## Explicitly out of scope

- Gmail or Outlook OAuth/connectors
- Requesting provider permissions or storing provider tokens
- Selecting a connected email account
- Automatically creating or updating a Gmail/Outlook draft
- Generating draft content from meeting data
- Determining which meetings should produce drafts
- Queues, workers, retries, rate limits, or usage metering for draft generation
- Applying the sharing-link preference to generated content
- Backfilling drafts for existing meetings

Until a later generation phase consumes these settings, changing them affects configuration only.

## Future connector boundary

Email generation and provider delivery are separate user decisions. Do not overload **Enable email draft** to mean both.

When Gmail/Outlook support is implemented, add separate provider-delivery configuration such as:

- `auto_save_to_provider`
- `email_connection_id`

The future UI should expose a separate **Save drafts to email provider** toggle and, when necessary, a connected-account selector. Those fields should be introduced with the connector work, when multiple accounts, disconnected accounts, OAuth scopes, provider errors, and token lifecycle can be handled correctly.

For this phase, **Enable email draft** means only: preserve the user's preference to generate drafts after eligible meetings once generation exists.

## Existing foundations to reuse

Do not add another cache, WebSocket connection, or feature-specific invalidation channel.

- `desktop/src/features/settings/sections/email-drafts/EmailDraftSettings.tsx` contains the current UI.
- `desktop/src/lib/query-client.ts` owns the shared TanStack Query client and default server-state behavior.
- `desktop/src/lib/query-keys.ts` owns account-scoped query identities.
- `desktop/src/app/realtime/resource-invalidation.ts` maps backend resource names to query keys.
- `desktop/src/app/realtime/types.ts` validates resource names received by the renderer.
- `ServerStateInvalidationBridge` already consumes generic `resource.changed` messages.
- `backend/internal/resourceevents` already publishes account-scoped changes through Redis.
- The existing WebSocket subscriber already forwards those changes to every active window/device for the account.
- `ServerStateSessionBoundary` already cancels and removes the previous account's cached data on logout or account change.

Use Vocabulary as the closest singleton-settings reference, while using partial updates because this page has multiple independently editable fields.

## Product decisions

### One settings object

Each account has at most one Email Draft settings object:

- `enabled`: whether future draft generation is enabled.
- `include_sharing_link`: whether future generated content should include a meeting-sharing link.
- `draft_prompt`: the user's custom generation instructions.

There are no named templates, template IDs, template lists, or template CRUD in this phase.

### Defaults

The canonical default values live in the Go backend, not in the renderer:

- `enabled`: `true`
- `include_sharing_link`: `true`
- `draft_prompt`: the initial plain-text prompt currently defined in `EmailDraftSettings.tsx`

`GET` returns these defaults if an account has never saved Email Draft settings. It must not insert data as a side effect of a read. The first successful mutation lazily creates the row.

After the API integration is complete, remove `INITIAL_DRAFT_PROMPT` from the React component. The renderer must display the API response and must not maintain a second canonical default.

An explicitly saved empty prompt is valid and distinct from a missing database row. It means the user wants no custom prompt text. The backend should validate only the maximum length, not require non-whitespace content.

### Save behavior

- Toggle changes save immediately.
- Prompt changes save after approximately 750 ms without typing.
- Blurring the textarea flushes any pending prompt change immediately.
- Routine successful saves do not need persistent **Saved** text.
- A failed save displays an inline error and keeps the user's local prompt available for retry.
- The character counter remains local and immediate.

Partial API mutations prevent a prompt save from overwriting a newer toggle value, or vice versa. Prompt mutations for the same account should be serialized so responses cannot commit out of order.

### Cross-device conflicts

The latest successful write to the same field wins. A resource event from another device invalidates and refetches the cached server object.

If the local prompt textarea is clean, synchronize it from the refreshed query result. If it is focused or has unsaved edits, do not replace its contents. Reconcile it only after the local save succeeds or the user explicitly retries/discards the failed edit.

## Database

Add `public.account_email_draft_settings` through the project's Supabase schema workflow and update `supabase/schema.sql` as the canonical schema snapshot.

```sql
create table public.account_email_draft_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  enabled boolean not null default true,
  include_sharing_link boolean not null default true,
  draft_prompt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_email_draft_settings_prompt_valid
    check (char_length(draft_prompt) <= 1000)
);
```

Update the existing schema security declarations:

- Include the table in the RLS enable/force list.
- Revoke access from `public`, `anon`, and `authenticated` through the existing blanket rules.
- Grant the dedicated `orion_backend` role only `select`, `insert`, and `update` on this table.
- Add explicit backend-role policies matching the singleton `account_vocabulary` pattern.
- Do not grant `delete`; account deletion removes the row through `on delete cascade`.

The database constraint is defense in depth. The authenticated HTTP handler must enforce the same 1,000-character limit before repository access.

## API contract

Add authenticated routes:

- `GET /api/email-draft-settings`
- `PATCH /api/email-draft-settings`

The account ID comes exclusively from the authenticated principal. Never accept `account_id` in the URL or request body.

### GET response

```json
{
  "settings": {
    "enabled": true,
    "include_sharing_link": true,
    "draft_prompt": "Rules\n- ...",
    "created_at": null,
    "updated_at": null
  }
}
```

Timestamps may be `null` when the response represents unsaved defaults. Once persisted, return the database timestamps.

### PATCH request

Accept one or more fields:

```json
{
  "draft_prompt": "Updated instructions"
}
```

or:

```json
{
  "enabled": false
}
```

Use pointer/optional request fields in Go so `false` and an empty string remain distinguishable from an omitted field.

Reject:

- An empty object
- Unknown fields
- A prompt longer than 1,000 Unicode characters
- Multiple JSON values or malformed JSON
- Requests over a small fixed body limit, such as 16 KiB

Suggested stable error codes:

- `invalid_request_payload`
- `email_draft_settings_empty_update`
- `email_draft_prompt_too_long`

Return the full canonical settings object after every successful mutation.

### Repository behavior

Create `backend/internal/repository/email_draft_settings.go` with:

- `Get(ctx, accountID)`
- `Patch(ctx, accountID, patch, defaultPrompt)`

`Get` returns a typed not-found result so the handler can supply canonical defaults without treating a missing row as an error.

`Patch` performs one atomic upsert. Omitted fields retain their stored values on conflict and use backend defaults on first insert. It must always constrain reads and writes by the authenticated `account_id`.

## Backend wiring

Create `backend/internal/handlers/email_draft_settings.go`:

- Define the backend-owned default prompt.
- Decode requests with `DisallowUnknownFields`.
- Enforce request size and exactly one JSON object.
- Validate optional fields and prompt length.
- Resolve the account ID from the authenticated principal.
- Return stable JSON errors without logging prompt contents.
- Publish a best-effort resource event only after a successful mutation.

Wire the repository and handler in `backend/cmd/api/main.go` and register the two authenticated routes.

Do not publish invalidations from `GET`. Reads must remain side-effect free.

## Shared resource invalidation

Add one resource name, `email_draft_settings`, to the existing generic system:

- `backend/internal/resourceevents/event.go`
- `desktop/src/app/realtime/types.ts`
- `desktop/src/app/realtime/resource-invalidation.ts`
- Relevant resource-event registry tests

Map it to `queryKeys.emailDraftSettings(accountID)`.

A successful `PATCH` publishes `ResourceEmailDraftSettings` with no resource ID because this is a singleton account resource. Redis publication remains best effort: a Redis outage must not turn a committed database update into an HTTP failure. The initiating renderer still receives the canonical response and updates its cache directly.

This reuses the current WebSocket connection and does not alter owner-only note behavior, calendar synchronization, billing, Vocabulary, or Extract event behavior.

## Desktop data layer

Create beside the component:

- `email-draft-settings-client.ts`
- `useEmailDraftSettingsQuery.ts`

Define a shared frontend shape:

```ts
type EmailDraftSettings = {
  enabled: boolean
  includeSharingLink: boolean
  draftPrompt: string
  createdAt?: string
  updatedAt?: string
}

type EmailDraftSettingsPatch = Partial<Pick<
  EmailDraftSettings,
  'enabled' | 'includeSharingLink' | 'draftPrompt'
>>
```

The HTTP client owns snake_case API conversion and response validation. Components should use camelCase domain values and should not call `authenticatedFetch` directly.

Add:

```ts
queryKeys.emailDraftSettings(accountID)
```

The query hook should use:

- The authenticated account ID in its query key
- `enabled: Boolean(accountID)`
- A five-minute `staleTime`, matching Vocabulary
- The shared query client's focus, reconnect, retry, and garbage-collection behavior

The mutation hook should:

1. Reject mutation attempts without an active account.
2. Cancel the relevant in-flight query.
3. Snapshot the previous cached object.
4. Optimistically merge the partial patch.
5. Roll back on failure if the same account is still active.
6. Replace the cache with the canonical API response on success.
7. Serialize mutations for the same account, using TanStack Query v5 mutation scope or an equivalent feature-local queue.

Do not create module-level caches, request maps, custom focus listeners, localStorage persistence, or another context provider.

## Desktop component integration

Update `EmailDraftSettings` to accept the authenticated account ID, use the query/mutation hooks, and render these states consistently with Vocabulary and Extracts:

- Initial load with no cached data: compact loading state.
- Cached data plus background fetch: preserve all visible controls and text.
- Initial error: error and Retry action.
- Background error: keep cached values and show a non-destructive retry message.
- Mutation error: preserve the user's intended value and provide Retry.

Replace the currently hard-coded toggle values with query data and mutation handlers.

Keep the prompt in local component state while editing. Track whether it is dirty so query refreshes cannot overwrite active work. Debounce only the prompt mutation; toggles remain immediate.

Update `SettingsView` to call `useEmailDraftSettingsQuery(user?.id)` while Settings is open, matching the existing Vocabulary and Extract prefetch behavior. Opening the Email Draft section should therefore read cached data immediately in the common case.

## Validation and tests

### Backend

- Defaults are returned when no row exists.
- `GET` does not insert a row or publish an event.
- A partial patch preserves omitted fields.
- `false` and an empty prompt are persisted rather than treated as omitted.
- Exactly 1,000 Unicode characters are accepted; 1,001 are rejected.
- Unknown, empty, oversized, malformed, and multi-value payloads are rejected.
- The account ID always comes from authentication.
- A successful mutation publishes `email_draft_settings` for the correct account.
- A repository or validation failure does not publish an event.
- Redis publication failure does not fail a committed update.

### Desktop

- Client parsing converts API fields correctly and surfaces stable errors.
- Query keys isolate two different accounts.
- Optimistic toggle updates roll back on failure.
- Canonical mutation responses replace optimistic cache state.
- Debounced prompt edits are saved and blur flushes pending work.
- A cross-device invalidation maps only to the active account's Email Draft query.
- An incoming refetch does not overwrite a dirty prompt.
- Logout/account switching removes the previous account's cached settings through the existing session boundary.

### Verification commands

Run at minimum:

```powershell
cd backend
go test ./...

cd ../desktop
npx tsc --noEmit
npm run lint
npm test
npx vite build
```

Also run `git diff --check` from the repository root.

## Phased delivery

### Phase 1: Persistence and authenticated API

1. Add the table, constraints, grants, and policies.
2. Add repository types and atomic singleton patching.
3. Add handler validation and authenticated routes.
4. Add backend tests.

### Phase 2: Shared cache and cross-device synchronization

1. Add the account-scoped query key.
2. Register `email_draft_settings` in backend and renderer resource registries.
3. Publish after successful mutations.
4. Add invalidation tests.

### Phase 3: Functional desktop page

1. Add the API client and query/mutation hooks.
2. Move the default prompt from React to the backend.
3. Bind both toggles to server state.
4. Add debounced prompt autosave, blur flushing, rollback, and errors.
5. Prefetch while Settings is open.
6. Add frontend tests and run full verification.

### Later phase: generation and provider delivery

Implement email generation as a separate consumer of this configuration. Implement Gmail/Outlook delivery after connector authorization exists, with its own auto-save preference and selected connection. Neither later phase should require changing the meaning of the fields created here.

## Acceptance criteria

- Reopening Email Draft shows the account's last saved values.
- A new account receives the backend-owned defaults without creating a row on read.
- Both toggles persist immediately.
- Prompt changes autosave without a Save button and cannot exceed 1,000 characters on either client or server.
- Errors are visible and do not silently discard the user's prompt.
- Cached data makes repeat navigation immediate and refreshes according to the shared query policy.
- A change on one device invalidates and refreshes the same account's other devices through the existing WebSocket.
- Signing out or switching accounts cannot reveal the previous account's settings.
- No new cache implementation, WebSocket, provider connector, generation worker, or meeting-processing logic is introduced.

## Main risks and mitigations

- **Autosave response ordering:** serialize same-account mutations and use partial patches.
- **Refetch overwrites active typing:** maintain a dirty local buffer and defer query-to-input synchronization.
- **Frontend/backend length mismatch:** validate the same 1,000-character contract in both layers, with the backend authoritative.
- **Default drift:** keep the canonical default in the backend and remove the renderer copy after integration.
- **Redis outage:** update the initiating cache from the API response; publish invalidation best effort.
- **Premature connector coupling:** do not add provider delivery fields until Gmail/Outlook integration is designed.
