# Summary Template settings: initial setup plan

## Status

Implemented on 2026-08-21. The settings-only completion boundary below is in place: persistent multi-folder CRUD, database-enforced one-template-per-folder assignment, authenticated backend ownership checks, shared TanStack Query caching, Settings-open prefetch, and generic cross-device invalidation. Meeting summary generation and processing remain deliberately unimplemented.

## Goal

Make the **Summary Templates** settings page functional as a configuration screen:

- List the signed-in account's summary templates.
- Create, edit, and delete templates.
- Store a template name, summary prompt, and one or more assigned folders.
- Allow one summary template to be assigned to multiple folders.
- Allow each folder to be assigned to at most one summary template.
- Persist configuration through the authenticated Go API and PostgreSQL.
- Reuse the app's account-scoped TanStack Query cache and generic Redis/WebSocket invalidation system.

This phase stores configuration only. It must not generate summaries, select a template while processing a meeting, change existing summaries, or modify the current summary-generation pipeline.

## Explicitly out of scope

- Applying a template to a meeting or transcript
- Calling an AI model or generating a summary
- Changing recording, transcription, note creation, or meeting-processing behavior
- Backfilling or regenerating existing meeting summaries
- Storing generated summary output
- Applying a template to every folder or every meeting
- An **All meetings** or **All folders** option
- A **Number of insights** option
- Folder inheritance, default templates, or fallback-template behavior
- Moving a folder automatically from one template to another
- Queues, workers, retries, metering, or billing for summary generation

Until a later processing phase is implemented, saving a template changes settings only and has no effect on old or new meetings.

## Existing foundations to reuse

Do not introduce feature-specific caching, a new WebSocket connection, or duplicate folder fetching.

- `desktop/src/features/settings/sections/summary-templates/SummaryTemplatesSettings.tsx` is the current placeholder page.
- The Extract settings implementation is the reference for card layout, rows, dialogs, errors, CRUD behavior, and cache handling.
- `desktop/src/components/ui/checkbox-dropdown.tsx` already provides the portal-based multi-select needed for folder selection.
- `DashboardNotesContext` already owns the dashboard's active folder list; consume it instead of calling `listFolders()` again.
- `ServerStateInvalidationBridge` already converts generic `resource.changed` events into account-scoped TanStack Query invalidations.
- `backend/internal/resourceevents` already provides the shared best-effort publisher and resource registry.

The Summary Template implementation should follow Extract conventions but remain a separate feature module and API resource. Do not make Summary Templates depend on the Extract field data model.

## Product decisions

### Template definition

Each template contains:

- **Name**: the user-facing template label.
- **Prompt**: instructions reserved for the future summary-generation engine.
- **Apply to meetings in**: one or more active folders owned by the signed-in account.

There is no number-of-insights field and no all-meetings/all-folders scope. A template cannot be saved without at least one folder.

Each account may create at most **100 summary templates**. Creation locks the account row and checks the current count in the same transaction so concurrent requests cannot exceed the limit. Existing templates remain editable at the limit.

### Assignment cardinality

The relationship is intentionally asymmetric:

- One template may target many folders.
- One folder may belong to zero or one template.
- A folder may never belong to two templates, including under concurrent requests.

Enforce the final rule with a database unique constraint, not only frontend validation. The API should also detect conflicts and return a stable `409` response naming the conflict category.

If a create or update includes any folder already assigned to another template, reject the entire mutation atomically. Do not partially save the selection and do not silently transfer the folder. The user must first edit or delete the other template to release that folder.

When editing a template, folders already assigned to that same template remain valid and do not conflict with themselves.

### Folder lifecycle

- Show active folders owned by the current account.
- Do not show an **All meetings** or **All folders** row.
- Keep the dropdown open while selections are toggled.
- Require at least one selected folder.
- Reject duplicate folder IDs rather than silently storing duplicates.
- Reject foreign, missing, or soft-deleted folders atomically.
- Disable folders that the current list response identifies as assigned to another template, with an **Already assigned** explanation.
- The backend remains authoritative because another device can change assignments after the UI loads.
- If an assigned folder is later soft-deleted, preserve its assignment and return it as unavailable when listing the template.
- Show **Folder unavailable** for preserved unavailable assignments.
- Editing a template with an unavailable folder requires removing/replacing it before saving.
- Deleting a template deletes its assignment rows and makes its folders available to other templates.

### Deletion

Deleting a template is permanent configuration deletion. Require confirmation before calling the API. This phase does not delete folders, notes, meetings, or generated content.

## Database design

Create both tables through the project's Supabase migration workflow, then update `supabase/schema.sql` as the canonical schema snapshot.

```sql
create table public.account_summary_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  prompt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_summary_templates_name_valid check (
    name = btrim(name) and name <> '' and length(name) <= 100
  ),
  constraint account_summary_templates_prompt_valid check (
    prompt = btrim(prompt) and prompt <> '' and length(prompt) <= 4000
  ),
  unique (id, account_id)
);

create table public.account_summary_template_folders (
  summary_template_id uuid not null,
  account_id uuid not null,
  folder_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (summary_template_id, folder_id),
  constraint account_summary_template_folders_template_owner_fk
    foreign key (summary_template_id, account_id)
    references public.account_summary_templates(id, account_id)
    on delete cascade,
  constraint account_summary_template_folders_folder_owner_fk
    foreign key (folder_id, account_id)
    references public.folders(id, user_id),
  constraint account_summary_template_folders_one_template_per_folder
    unique (account_id, folder_id)
);
```

The join-table uniqueness constraint is the concurrency-safe enforcement of one template per folder. Two simultaneous requests cannot claim the same account/folder pair; one succeeds and the other returns a conflict.

Also add:

- A unique index on `account_summary_templates(account_id, lower(name))` to prevent duplicate normalized names case-insensitively.
- A stable-listing index on `account_summary_templates(account_id, created_at, id)`.
- An index on `account_summary_template_folders(summary_template_id, account_id)` for template-scoped association loading if the primary-key order does not fully cover the query.
- An index on `account_summary_template_folders(folder_id, account_id)` if needed for ownership joins; confirm with the actual query plan and avoid redundant indexes.
- The repository's established `updated_at` behavior.
- RLS enabled and forced on both public tables.
- Revocation from `PUBLIC`, `anon`, and `authenticated`, matching the backend-only settings tables.
- Explicit minimum grants for `orion_backend`: template rows need `SELECT`, `INSERT`, `UPDATE`, and `DELETE`; assignment rows need `SELECT`, `INSERT`, and `DELETE`.
- Account-scoped backend policies following `account_extract_fields` and the current transaction-local account identity convention.

The app talks to these tables through its Go backend, not directly from the Electron renderer. Current Supabase guidance separates grants from RLS, so the migration must explicitly configure both rather than depending on table-creation defaults.

### Migration verification

Before applying the final migration:

1. Create the migration through the repository's current Supabase workflow; do not invent migration history manually.
2. Verify table definitions, constraints, grants, forced RLS, and backend policies in a transaction or disposable environment.
3. Run Supabase security/performance advisors and distinguish new findings from existing project findings.
4. Apply the migration, update `supabase/schema.sql`, and verify the live definitions match the plan.
5. Prove with concurrent inserts that one folder cannot be assigned to two templates.

No current Supabase breaking change alters this schema design. The 2026 Data API exposure change reinforces the need for explicit grants; the tables should remain inaccessible to renderer-facing `anon` and `authenticated` roles.

## Backend implementation

### Model

Add `backend/internal/models/summary_template.go`:

```go
type SummaryTemplateFolder struct {
    ID        string  `json:"id"`
    Name      *string `json:"name"`
    Available bool    `json:"available"`
}

type SummaryTemplate struct {
    ID        string                  `json:"id"`
    AccountID string                  `json:"account_id"`
    Name      string                  `json:"name"`
    Prompt    string                  `json:"prompt"`
    Folders   []SummaryTemplateFolder `json:"folders"`
    CreatedAt time.Time               `json:"created_at"`
    UpdatedAt time.Time               `json:"updated_at"`
}
```

Always serialize `folders` as an array. Persisted templates should normally contain at least one folder, while defensive list handling may still return an empty array if legacy or manually corrupted data exists.

### Repository

Add `backend/internal/repository/summary_template.go` with context-aware methods:

```text
List(ctx, accountID)
Create(ctx, accountID, input)
Update(ctx, accountID, templateID, input)
Delete(ctx, accountID, templateID)
```

Requirements:

- Scope every query by the authenticated `account_id`; never accept it from the body.
- List templates in stable `(created_at, id)` order.
- Load associations in one query, avoiding N+1 folder queries.
- Left-join active folders so soft-deleted/missing assignments return with `available: false` instead of disappearing.
- Create the template and all folder assignments in one transaction.
- Update the template and replace all folder assignments in one transaction.
- Lock the template row during update so concurrent edits to one template cannot interleave.
- Lock/validate all selected owned active folder rows in stable ID order before replacing assignments.
- Treat the assignment unique violation as `ErrSummaryTemplateFolderConflict`.
- Treat the normalized template-name unique violation as `ErrSummaryTemplateNameConflict`.
- Distinguish an unavailable folder from an already-assigned folder.
- Return the canonical saved template after create/update.
- Return not-found for a missing or foreign template without revealing ownership.
- Roll back the complete mutation if any folder is invalid or conflicting.

For a clearer desktop experience, the list endpoint should also expose assignment availability for the current folder chooser. Prefer returning `assigned_template_id`/`assigned_template_name` alongside the existing dashboard folder data only if that can be added without coupling unrelated note state. Otherwise derive disabled choices from the returned template list: every available folder found under another template is already assigned. The backend constraint remains authoritative either way.

### Validation

The handler validates before calling the repository:

- Size-limit the JSON request body.
- Reject unknown JSON fields and trailing JSON values.
- Trim `name` and `prompt`.
- Require a name of 1–100 Unicode characters.
- Require a prompt of 1–4,000 Unicode characters.
- Require `folder_ids` to contain 1–100 UUIDs.
- Trim and parse every folder ID.
- Reject duplicate IDs.
- Validate ownership and active status in one repository query.
- Return stable error codes.

Database constraints remain the final enforcement layer for direct writes and races.

### Authenticated HTTP API

Add `backend/internal/handlers/summary_templates.go`, initialize it in `backend/cmd/api/main.go`, and register under the existing authenticated API group:

```text
GET    /api/summary-templates
POST   /api/summary-templates
PATCH  /api/summary-templates/:templateID
DELETE /api/summary-templates/:templateID
```

Create/update body:

```json
{
  "name": "Sales call",
  "prompt": "Summarize the customer's goals, blockers, decisions, and next steps.",
  "folder_ids": [
    "2ec5167a-8fea-4f58-99b4-f731a8282552",
    "720d0963-2a86-4715-9485-9c82992fa642"
  ]
}
```

Responses:

```json
{ "templates": [] }
```

```json
{ "template": {} }
```

Status behavior:

- List: `200`, including an empty `templates` array.
- Create: `201`.
- Update: `200`.
- Delete: `204`.
- Malformed payload: `400 invalid_request_payload`.
- Invalid name: `422 summary_template_name_invalid`.
- Invalid prompt: `422 summary_template_prompt_invalid`.
- Empty, oversized, duplicate, or malformed folder selection: `422 summary_template_folders_invalid` or a more specific stable code.
- Missing, foreign, or inactive folder: `422 summary_template_folder_unavailable`.
- Folder owned by another template: `409 summary_template_folder_conflict`.
- Duplicate normalized name: `409 summary_template_name_conflict`.
- Account already has 100 templates: `409 summary_template_limit_reached`.
- Missing or foreign template: `404 summary_template_not_found`.
- Unauthenticated request: the existing auth middleware response.

Do not automatically unassign a conflicting template inside create/update. A transfer should be an explicit future product operation if it is ever needed.

### Cross-device invalidation

Add `resourceevents.ResourceSummaryTemplates = "summary_templates"` to the shared backend resource registry.

After a successful committed create, update, or delete, publish one best-effort event with:

- The authenticated account ID
- `ResourceSummaryTemplates`
- The changed template ID as `resource_id`

Do not publish on list, failed validation, conflicts, or rolled-back mutations. Redis/WebSocket delivery failure must not fail a committed CRUD request.

This reuses the current resource-event WebSocket connection; it does not open another connection or alter existing event behavior.

## Desktop implementation

### Feature structure

Keep the implementation under:

```text
desktop/src/features/settings/sections/summary-templates/
  SummaryTemplatesSettings.tsx
  SummaryTemplateDialog.tsx
  summary-templates-client.ts
  types.ts
  useSummaryTemplatesQuery.ts
```

Reuse shared UI primitives rather than copying them into the feature folder.

### Types and HTTP client

Use camelCase renderer types:

```ts
type SummaryTemplateFolder = {
  id: string
  name: string | null
  available: boolean
}

type SummaryTemplate = {
  id: string
  name: string
  prompt: string
  folders: SummaryTemplateFolder[]
  createdAt: string
  updatedAt: string
}

type SummaryTemplateInput = {
  name: string
  prompt: string
  folderIds: string[]
}
```

Add client functions using `authenticatedFetch` and `API_BASE_URL`:

```text
listSummaryTemplates(signal?)
createSummaryTemplate(input)
updateSummaryTemplate(id, input)
deleteSummaryTemplate(id)
```

The client maps API snake_case to renderer camelCase in one place and converts stable backend errors into useful UI messages.

### Shared query cache

Add:

```ts
queryKeys.summaryTemplates(accountID)
```

Add TanStack Query hooks following `useExtractFieldsQuery.ts`:

```text
useSummaryTemplatesQuery(accountID)
useCreateSummaryTemplateMutation(accountID)
useUpdateSummaryTemplateMutation(accountID)
useDeleteSummaryTemplateMutation(accountID)
```

Behavior:

- Every key is account-prefixed and enabled only for an authenticated account.
- Use the shared finite stale-time convention, currently five minutes for comparable settings.
- Start the query when Settings opens so the Summary Templates section is normally instant when clicked.
- Keep cached rows visible during background refetches.
- Insert/replace/remove the canonical API response after local mutations for immediate feedback.
- Guard cache writes with `isActiveServerStateAccount(accountID)`.
- Do not create a module cache, separate context, feature WebSocket, or feature focus listener.
- Existing account switch/sign-out cache isolation applies unchanged.

Register `summary_templates` in:

- `desktop/src/app/realtime/types.ts`
- `desktop/src/app/realtime/resource-invalidation.ts`
- the resource invalidation registry tests

Map it to `queryKeys.summaryTemplates(accountID)`. Cross-device changes then use the same Redis-to-WebSocket bridge and reconnect/focus fallback as Vocabulary, Extracts, and Email Draft.

### Folder selection

Consume `folders`, `isLoading`, and `loadError` from `DashboardNotesContext`; do not fetch folders again.

Reuse `CheckboxDropdown` with active folders only:

- Do not pass an `exclusiveValue`.
- Do not render an **All meetings** option.
- Show folder icons and checks matching Extracts.
- Show `Select folders`, one folder name, or `N folders` in the trigger.
- Require at least one selection before enabling Create/Save.
- Keep the dropdown open while toggling multiple folders.
- Disable folders assigned to another template. Extend the shared dropdown option shape with a backward-compatible `disabled`/description capability if necessary rather than implementing a second dropdown.
- Preserve unavailable assignments in edit mode, visually mark them, and require removal before saving.
- If the initial folder list fails, show a retry/error state and prevent saving a new template because no valid folder can be verified.

When editing, calculate conflicts from the cached template list by excluding the template currently being edited. This improves the UX but does not replace backend conflict enforcement.

### Summary Templates card

Replace the placeholder with the same Vocabulary/Extracts settings-card structure:

- Header row: **Templates** and the live `N / 100 templates` count.
- Description and **Add new template** button in the same compartment, matching the final Extracts layout.
- Saved templates rendered as rows below the add button, not chips or tags.

States:

- Initial load with no cache: loading row.
- Initial failure with no cache: inline error and Retry.
- Cached data plus background fetch: keep the list visible.
- Empty list: concise empty state while keeping **Add new template** available.
- Populated list: one row per template.

Each row shows:

- Template name
- Prompt truncated in the list and fully available in edit mode
- One folder name or `N folders`
- Any **Folder unavailable** state
- Edit and Delete actions matching Extracts

### Create/edit dialog

Build `SummaryTemplateDialog` from the existing Extract dialog structure and shared components. It contains only:

1. **Name** input
2. **Prompt** non-resizable textarea
3. **Apply to meetings in** multi-folder dropdown
4. Cancel and Create/Save actions

Requirements:

- Use the same dialog for create and edit.
- Prefill name, prompt, and selected folders in edit mode.
- New templates begin with no folders selected.
- Do not include **Number of insights**, **All meetings**, or **All folders**.
- Disable Create/Save until trimmed name and prompt are valid and at least one available folder is selected.
- Disable controls while submitting.
- Close only after the mutation returns and the canonical result is placed in cache.
- Preserve the draft and show the API error inline on failure.
- For a folder conflict, keep the dialog open, identify that a selected folder is already assigned, refetch templates, and let the user revise the selection.
- Reset state only after success or explicit cancellation.
- Reuse `Dialog`, `Input`, `Label`, `Button`, `CheckboxDropdown`, portal layering, and the app scrollbar styling.

### Delete flow

- Confirm deletion in the established dialog style.
- Disable repeated actions while pending.
- Keep the row visible until the API confirms deletion.
- Remove the row from cache after success.
- On failure, retain the row and show an inline error.
- After success, folder choices released by deletion become selectable immediately because the cached template list no longer claims them.

## Delivery sequence

### Phase 1: Database

1. Create and verify the Supabase migration.
2. Add the two tables, ownership FKs, validation checks, and one-template-per-folder unique constraint.
3. Add explicit grants, forced RLS, and backend account policies.
4. Update `supabase/schema.sql` and run advisors.

### Phase 2: Backend CRUD

1. Add models and repository.
2. Add transactional folder validation/assignment replacement.
3. Add strict request decoding, validation, stable errors, handlers, and routes.
4. Register and publish `summary_templates` resource events.

### Phase 3: Desktop data layer

1. Add types and API client.
2. Add the account-scoped query key, query, and mutation hooks.
3. Register shared realtime invalidation.
4. Start prefetching on Settings open.

### Phase 4: Functional UI

1. Convert the placeholder page to the Extract-style settings card.
2. Reuse dashboard folders and the shared checkbox dropdown.
3. Add create/edit dialog and row rendering.
4. Add confirmed deletion and conflict/unavailable-folder states.

### Phase 5: Documentation and verification

1. Update backend and desktop resource documentation.
2. Document that this is settings-only and not consumed by meeting processing.
3. Run all database, backend, renderer, cache, and cross-device checks below.

## Verification

### Database and backend

- `go test ./...`, `go vet ./...`, and `go build ./...` pass from `backend`.
- Unauthenticated requests are rejected.
- An account can list, create, update, and delete only its own templates.
- A template can save one folder or multiple folders.
- A template cannot save zero folders.
- Two templates cannot claim the same folder, including under concurrent requests.
- A failed conflict leaves both templates and every prior assignment unchanged.
- Updating a template can retain its own folders without a false conflict.
- Deleting a template releases all of its folder assignments.
- Foreign, missing, and soft-deleted folders are rejected on mutation.
- Previously assigned soft-deleted folders list as unavailable rather than disappearing.
- Empty list responses serialize as `[]`, not `null`.
- Blank/oversized values, malformed UUIDs, duplicate folder IDs, duplicate names, and folder conflicts return the documented status/code.
- Direct invalid database writes fail the appropriate check, FK, or unique constraint.
- RLS and grants prevent `anon`, `authenticated`, or another account from accessing rows.
- Successful mutations publish one `summary_templates` invalidation; reads and failed mutations publish none.

### Desktop

- `npm test`, `npm run lint`, and `npx tsc --noEmit` pass from `desktop`.
- The query begins when Settings opens and cached content appears immediately when the section is clicked.
- The folder dropdown has no all-meetings/all-folders option.
- One or multiple folders can be selected efficiently.
- Folders assigned to another template are visibly disabled.
- Create/Save requires a valid name, prompt, and at least one available folder.
- Create, edit, delete, cancel, pending, retry, empty, and error states behave correctly.
- A server-side conflict keeps the dialog open, refreshes assignments, and does not lose user input.
- Unavailable existing assignments are shown and cannot be resaved until resolved.
- Switching accounts or signing out cannot expose the previous account's cached templates.
- A change on another device invalidates and refreshes this account's template query through the existing WebSocket.
- Reconnect/focus refetch recovers a missed invalidation.

## Risks and mitigations

- **Race between two folder assignments:** enforce `unique (account_id, folder_id)` and map the database violation to `409`.
- **Silent folder transfer:** reject conflicts; never auto-reassign in CRUD.
- **Partial template updates:** validate and replace assignments in one transaction.
- **Stale desktop availability:** disable known conflicts for UX, but keep backend/database authoritative and refetch after `409`.
- **Soft-deleted folders broadening scope:** preserve unavailable assignments and never reinterpret an empty/invalid selection as all meetings.
- **Duplicate folder fetching:** consume `DashboardNotesContext`.
- **Feature-specific cache drift:** use shared query keys, account guards, resource registry, and current WebSocket bridge.
- **Premature processing behavior:** keep all summary-generation integration explicitly out of scope and document the settings-only boundary in code and README files.

## Completion boundary

This plan is complete when Summary Templates provides secure, persistent, account-isolated, cross-device-synchronized CRUD configuration with multi-folder assignment and database-enforced one-template-per-folder exclusivity.

No meeting or transcript processing code should read or execute these templates in this pass.
