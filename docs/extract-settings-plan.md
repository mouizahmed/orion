# Extract settings: initial setup plan

## Status

Implemented on 2026-08-20. The settings-only completion boundary below is in place: persistent multi-folder CRUD, authenticated backend ownership checks, shared TanStack Query caching, and generic cross-device invalidation. Meeting extraction and processing remain deliberately unimplemented.

## Goal

Make the Extracts settings page functional as a configuration screen:

- List the signed-in account's extract fields.
- Create, edit, and delete fields.
- Persist fields in PostgreSQL through the authenticated Go API.
- Let the user target either **All meetings** or any combination of their active folders.
- Keep cached settings synchronized across the user's devices through the existing server-state invalidation system.

This phase stores configuration only. It must not extract anything from a transcript or affect meeting processing.

## Explicitly out of scope

- Running prompts against transcripts
- Calling an AI model for extracts
- Applying fields during recording, transcription, or note generation
- Deciding which fields apply to a particular meeting at processing time
- Generating or storing extracted results
- Retrospective extraction or backfilling existing meetings
- Queues, workers, retries, usage metering, or billing for extraction
- Displaying extracted results anywhere outside this settings page

Until that later processing phase is implemented, saving an extract field changes settings only and has no effect on old or new meetings.

## Existing foundations to reuse

Do not introduce feature-specific caching, WebSocket subscriptions, or duplicate folder fetching.

- `desktop/src/features/settings/sections/extracts/ExtractFieldDialog.tsx` contains the current create-dialog UI.
- `desktop/src/features/settings/sections/extracts/ExtractsSettings.tsx` contains the Vocabulary-style Extracts card.
- `desktop/src/lib/query-keys.ts` already defines `queryKeys.extractFields(accountID)`.
- `desktop/src/app/realtime/resource-invalidation.ts` already maps `extract_fields` to that query key.
- `desktop/src/app/realtime/types.ts` already recognizes the `extract_fields` resource.
- `backend/internal/resourceevents/event.go` already defines `ResourceExtractFields`.
- `ServerStateInvalidationBridge` already handles generic `resource.changed` events.
- `DashboardNotesContext` already owns the dashboard's active folder list. The Extracts page should consume that list rather than call `listFolders()` again.

## Product decisions

### Field definition

Each field contains:

- **Name**: the user-facing label.
- **Prompt**: instructions reserved for the later extraction engine.
- **Number of insights**: `single` or `multiple`.
- **Apply to meetings in**:
  - **All meetings** is one mutually exclusive option.
  - Otherwise, the user selects one or more folder UUIDs.

Each account may create at most **100 extract fields**. Creation locks the account row and checks the current count in the same transaction so concurrent requests cannot exceed the limit. Existing fields remain editable at the limit.

The API must never use a sentinel string for **All meetings**. It uses an explicit scope object so an all-meetings scope cannot be confused with an accidentally empty folder selection.

### Folder lifecycle

- The multi-select shows **All meetings** first, followed by active folders owned by the signed-in user.
- Choosing **All meetings** clears every folder selection.
- Choosing a folder clears **All meetings**; the user may then select additional folders.
- A folder-scoped field must contain at least one folder.
- Duplicate folder IDs are rejected rather than silently stored twice.
- A user cannot save another user's folder or a soft-deleted folder.
- If one or more referenced folders are later soft-deleted, preserve every selection and return each missing target as unavailable.
- The UI must show **Folder unavailable** for each missing target. It must not reinterpret the field as **All meetings**, because that would silently broaden its future scope.
- Editing a scope containing unavailable folders requires removing or replacing those targets, or explicitly switching to **All meetings**, before saving.

### Deletion

Deleting a field is permanent configuration deletion. Require confirmation in the desktop UI before calling the API.

## Database

Add `public.account_extract_fields` through the project's Supabase migration workflow and update `supabase/schema.sql` as the canonical schema snapshot.

```sql
create table public.account_extract_fields (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  prompt text not null,
  insight_cardinality text not null default 'multiple',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_extract_fields_name_valid
    check (btrim(name) <> '' and char_length(btrim(name)) <= 100),
  constraint account_extract_fields_prompt_valid
    check (btrim(prompt) <> '' and char_length(btrim(prompt)) <= 4000),
  constraint account_extract_fields_cardinality_valid
    check (insight_cardinality in ('single', 'multiple')),
  unique (id, account_id)
);

create table public.account_extract_field_folders (
  extract_field_id uuid not null,
  account_id uuid not null,
  folder_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (extract_field_id, folder_id),
  constraint account_extract_field_folders_field_owner_fk
    foreign key (extract_field_id, account_id)
    references public.account_extract_fields(id, account_id)
    on delete cascade,
  constraint account_extract_field_folders_folder_owner_fk
    foreign key (folder_id, account_id)
    references public.folders(id, user_id)
);
```

An extract field with no rows in `account_extract_field_folders` means **All meetings**. One or more rows means the field is folder-scoped. The API and repository must enforce that interpretation transactionally; callers cannot submit a folder-scoped request with an empty folder list.

Also add:

- A unique index on `(account_id, lower(btrim(name)))` to prevent duplicate names case-insensitively.
- A stable-listing index on `(account_id, created_at, id)`.
- An index on `account_extract_field_folders(account_id, folder_id)` for ownership-scoped folder lookups.
- The repository's standard `updated_at` trigger, if table timestamps are trigger-managed elsewhere.
- Table grants for `orion_backend` on both tables, limited to `SELECT`, `INSERT`, `UPDATE`, and `DELETE` as required.
- RLS enabled and forced.
- Account-scoped backend policies following `account_vocabulary` and the existing backend role/session conventions.
- Revocations from `PUBLIC`, `anon`, and `authenticated`, consistent with other application-data tables.

The database constraints are the final enforcement layer even though the handler also validates requests.

## Backend implementation

### Model

Add `backend/internal/models/extract_field.go`:

```go
type ExtractField struct {
    ID                 string    `json:"id"`
    AccountID          string    `json:"account_id"`
    Name               string    `json:"name"`
    Prompt             string    `json:"prompt"`
    InsightCardinality string    `json:"insight_cardinality"`
    Scope              ExtractFieldScope `json:"scope"`
    CreatedAt          time.Time `json:"created_at"`
    UpdatedAt          time.Time `json:"updated_at"`
}

type ExtractFieldScope struct {
    Type    string               `json:"type"` // all_meetings or folders
    Folders []ExtractFieldFolder `json:"folders"`
}

type ExtractFieldFolder struct {
    ID        string  `json:"id"`
    Name      *string `json:"name"`
    Available bool    `json:"available"`
}
```

For **All meetings**, return `type: "all_meetings"` and an empty `folders` array. For folder scope, return `type: "folders"` and every selected folder, including unavailable ones.

### Repository

Add `backend/internal/repository/extract_field.go` with context-aware methods:

```go
List(ctx, accountID)
Create(ctx, accountID, input)
Update(ctx, accountID, fieldID, input)
Delete(ctx, accountID, fieldID)
```

Requirements:

- Every query and mutation is scoped by `account_id` supplied from the authenticated principal.
- Never accept `account_id` from the request body.
- List in stable `(created_at, id)` order.
- Load selected targets from the join table and left-join active folders to return each folder's name and availability.
- Create/update the field and replace its folder associations in one database transaction.
- Lock or otherwise serialize the owned field row during updates so concurrent scope changes cannot interleave.
- Distinguish not-found from internal database errors for update and delete.
- Return the canonical saved row from create and update.
- Map the unique-name violation to a repository error the handler can convert to `409`.

### Validation

The handler validates before calling the repository:

- Decode a size-limited JSON body.
- Reject unknown JSON fields and trailing JSON values.
- Trim `name` and `prompt`.
- Require a name of 1–100 Unicode characters.
- Require a prompt of 1–4,000 Unicode characters.
- Accept only `single` or `multiple`.
- Accept `scope.type` only as `all_meetings` or `folders`.
- Require `scope.folder_ids` to be empty/omitted for `all_meetings`.
- Require at least one distinct folder ID for `folders`.
- Parse every folder ID as a UUID and reject duplicates.
- Validate all folder IDs for the account in one repository query; do not perform an N+1 existence check.
- Return stable error codes for invalid input, unavailable folders, and duplicate names.

Use `422 Unprocessable Entity` for valid JSON with invalid field values, matching the repository's current validation style. Use `400 Bad Request` for malformed JSON.

### Authenticated HTTP API

Add `backend/internal/handlers/extract_fields.go`, initialize it in `backend/cmd/api/main.go`, and register:

```text
GET    /api/extract-fields
POST   /api/extract-fields
PATCH  /api/extract-fields/:fieldID
DELETE /api/extract-fields/:fieldID
```

Create/update body:

```json
{
  "name": "Pain points",
  "prompt": "What pain points does the prospect face?",
  "insight_cardinality": "multiple",
  "scope": {
    "type": "folders",
    "folder_ids": [
      "2ec5167a-8fea-4f58-99b4-f731a8282552",
      "720d0963-2a86-4715-9485-9c82992fa642"
    ]
  }
}
```

For **All meetings**, send:

```json
{
  "scope": {
    "type": "all_meetings",
    "folder_ids": []
  }
}
```

Response contracts:

```json
{ "fields": [] }
```

```json
{ "field": {} }
```

Status behavior:

- List: `200`, including an empty `fields` array.
- Create: `201`.
- Update: `200`.
- Delete: `204`.
- Malformed payload: `400 invalid_request_payload`.
- Invalid field values: `422 invalid_extract_field` or a more specific stable code.
- Any missing, foreign, or inactive folder: `422 extract_field_folder_unavailable`; reject the whole mutation atomically.
- Duplicate normalized name: `409 extract_field_name_conflict`.
- Account already has 100 fields: `409 extract_field_limit_reached`.
- Missing or foreign field ID: `404 extract_field_not_found` without revealing ownership.
- Unauthenticated request: the existing auth middleware response.

### Cross-device invalidation

After a successful committed create, update, or delete, call the existing best-effort resource publisher with:

- Account ID from the authenticated principal
- `resourceevents.ResourceExtractFields`
- The changed field ID as `resource_id`

Do not publish on GET or on failed/rolled-back mutations. Redis or WebSocket delivery failure must not turn a committed CRUD operation into an API failure; local mutation cache updates provide immediate feedback, and normal stale/focus/reconnect revalidation remains the fallback.

## Desktop implementation

### Types and HTTP client

Add:

- `desktop/src/features/settings/sections/extracts/types.ts`
- `desktop/src/features/settings/sections/extracts/extract-fields-client.ts`

Renderer types should use camelCase:

```ts
type ExtractField = {
  id: string
  name: string
  prompt: string
  insightCardinality: 'single' | 'multiple'
  scope:
    | { type: 'allMeetings'; folders: [] }
    | { type: 'folders'; folders: ExtractFieldFolder[] }
  createdAt: string
  updatedAt: string
}

type ExtractFieldFolder = {
  id: string
  name: string | null
  available: boolean
}

type ExtractFieldInput = {
  name: string
  prompt: string
  insightCardinality: 'single' | 'multiple'
  scope:
    | { type: 'allMeetings' }
    | { type: 'folders'; folderIds: string[] }
}
```

The client must:

- Use `authenticatedFetch` and `API_BASE_URL`.
- Accept an `AbortSignal` for list requests.
- Map API snake_case to renderer camelCase in one place.
- Map the desktop camelCase scope union to the API's explicit snake_case scope object.
- Parse stable API errors into useful user-facing messages.

Expose:

```ts
listExtractFields(signal?): Promise<ExtractField[]>
createExtractField(input): Promise<ExtractField>
updateExtractField(id, input): Promise<ExtractField>
deleteExtractField(id): Promise<void>
```

### Shared query hooks

Add `desktop/src/features/settings/sections/extracts/useExtractFieldsQuery.ts` using TanStack Query and the existing account-scoped key:

```ts
useExtractFieldsQuery(accountID)
useCreateExtractFieldMutation(accountID)
useUpdateExtractFieldMutation(accountID)
useDeleteExtractFieldMutation(accountID)
```

Behavior:

- Query key: `queryKeys.extractFields(accountID)`.
- Query enabled only for an authenticated account.
- Use a finite stale time, suggested five minutes.
- Because `DashboardSettingsPage` mounts when Settings opens, start the Extract fields query then, like Vocabulary, so clicking Extracts is normally instant.
- Keep cached rows visible during background refetches.
- Do not add a module-level cache or a feature-specific focus listener.
- On create, insert the canonical API response into the cached list.
- On update, replace the matching cached row with the canonical API response.
- On delete, remove the row after the API confirms success.
- Guard cache writes with the active-account check already used by other mutation hooks.
- Invalidate/revalidate after mutations where needed, while preserving immediate local feedback.

Cross-device changes require no Extract-specific WebSocket component because the resource registry and shared invalidation bridge are already prepared.

### Folder options

Read `folders`, `isLoading`, and `loadError` from `DashboardNotesContext`.

- Do not issue a second folder request from the Extracts page.
- Render a multi-select dropdown with **All meetings** first.
- Append active folders in the order supplied by the dashboard context.
- Keep the menu open while folder checkboxes are toggled so multiple selections are efficient.
- Selecting **All meetings** clears selected folder IDs; selecting any folder exits the all-meetings state.
- The trigger shows **All meetings**, one folder name, or `N folders` when multiple folders are selected.
- Disable folder-specific selection while the initial folder list is loading, while keeping **All meetings** available.
- If folder loading fails, show a non-blocking message and allow **All meetings** to remain selectable.
- The backend remains authoritative and rejects stale folder selections.

The existing Radix `Select` primitive is single-value and must not be forced into multi-select behavior. Add a small reusable checkbox-dropdown primitive using the existing `DropdownPopover`, `DropdownItem`, and dropdown surface styling so this control follows the established design system and can be reused later.

### Fields card

Keep the current Vocabulary-style card and show the query result as `N / 100 fields`.

States:

- Initial load with no cache: show a loading row inside the card.
- Initial error with no cache: show the error and Retry action.
- Cached data plus background fetch: keep the list visible.
- Empty list: show a short empty state and **Add new field**.
- Populated list: render one settings row per field, followed by **Add new field**.

Each row shows:

- Name
- Prompt, truncated in the list but available in full when editing
- `Single` or `Multiple`
- `All meetings`, the selected folder names/count, and any `Folder unavailable` targets
- Edit and Delete actions

Use rows, not tags or chips.

### Create/edit dialog

Evolve the existing `ExtractFieldDialog` instead of creating another dialog.

- Add `mode`, `initialField`, `onSubmit`, and mutation-state props.
- Use the same dialog for create and edit.
- Prefill all values in edit mode.
- Default new fields to `multiple` and **All meetings**.
- Populate the meeting-scope multi-select with **All meetings** followed by active folders.
- Allow one or more folders to be selected together and show a check beside each selected folder.
- Keep **All meetings** mutually exclusive with folder selections.
- In edit mode, preserve unavailable targets in the draft until the user explicitly removes/replaces them or switches to **All meetings**.
- Disable Create/Save until name and prompt are non-empty and all values are valid.
- Disable every control while submitting to prevent duplicate requests.
- On success, close only after the cache receives the canonical returned field.
- On failure, keep the dialog and draft open and show the API error inline.
- Reset the draft after successful submission or explicit cancellation, not after a failed request.
- Preserve the established shared `Dialog`, `Input`, `Select`, `Label`, and `Button` primitives and current control shapes.

### Delete flow

- Ask for confirmation using the project's dialog style.
- Disable repeated delete actions while the request is pending.
- Keep the row visible until the server confirms deletion.
- On failure, retain the row and show an error.

## Delivery sequence

### Phase 1: Persistence

1. Apply the database migration.
2. Update `supabase/schema.sql`.
3. Verify both tables, transactional associations, composite ownership constraints, grants, and RLS.

### Phase 2: Backend CRUD

1. Add model and repository.
2. Add request decoding and validation.
3. Add authenticated handlers and routes.
4. Publish `extract_fields` after successful mutations.
5. Verify ownership and stable error behavior.

### Phase 3: Desktop data layer

1. Add types and HTTP client.
2. Add account-scoped query and mutations.
3. Reuse the existing cache invalidation registration.
4. Reuse `DashboardNotesContext` for folders.

### Phase 4: Functional settings UI

1. Replace the hard-coded field count and empty UI with query states.
2. Render saved fields as rows.
3. Wire create and edit into the existing dialog.
4. Add confirmed deletion.
5. Handle unavailable folders and API errors.

## Verification

### Database and backend

- `go test ./...`, `go vet ./...`, and `go build ./...` pass from `backend`.
- Unauthenticated requests are rejected.
- A user can list, create, update, and delete their own fields.
- A user cannot read or mutate another account's fields.
- A user can save one folder or multiple folders in a single field.
- A user cannot select another user's folder or a soft-deleted folder.
- `scope.type: all_meetings` round-trips as **All meetings** with no join rows.
- Folder scope rejects an empty folder list and duplicate folder IDs.
- A failed folder association leaves both the field and all prior associations unchanged.
- Empty lists serialize as `[]`, not `null`.
- Blank/oversized values, invalid cardinality, malformed UUIDs, and duplicate names return the documented status and code.
- Database constraints reject invalid direct writes.
- Successful mutations publish one `extract_fields` invalidation; reads and failed mutations publish none.

### Desktop

- `npm test`, `npm run lint`, and `npx tsc --noEmit` pass from `desktop`.
- The field query starts on Settings open and cached Extracts content renders immediately on section click.
- The multi-select shows **All meetings** first and then the current active folders.
- Selecting several folders persists every selection and restores them in edit mode.
- **All meetings** and folder selections cannot be active simultaneously.
- Create, edit, delete, cancel, retry, and validation states work.
- Saved settings survive navigation and application restart.
- Background refresh does not clear visible rows.
- A soft-deleted referenced folder displays as **Folder unavailable**.
- Mutating on device A causes device B to invalidate and refetch through the existing WebSocket bridge.
- Signing out or switching accounts cannot reveal the previous account's cached extract fields.

## Completion boundary

This plan is complete when the Extracts settings page provides secure, persistent, synchronized CRUD configuration. It deliberately stops before any meeting-processing code reads or executes these fields.
