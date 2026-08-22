# Desktop server-state migration plan

## Status

Implemented on 2026-08-22.

All delivery phases below are now represented in the codebase. Notes, folders, activity, search, calendar-linked notes, persisted chat data, and remote overlay notes use the existing account-scoped TanStack Query architecture. Note writes share serialized mutation scopes and backend revision checks, and the generic resource-event bridge now covers notes, folders, activity, and chat.

Automated verification completed with backend tests and vet, desktop lint/type/tests, production renderer/main/preload builds, cache-transform tests, query-key account isolation tests, and resource-invalidation tests. The `add_note_revision` migration was applied to the Orion development project on 2026-08-22 and verified through the live schema, data, migration history, and Supabase security/performance advisors. Interactive desktop scenarios could not run because no browser backend or Windows Computer Use native helper was available. Electron compilation succeeds, but `electron-builder` cannot complete its final Windows unpack-directory rename in this environment (`EPERM`), including when given a fresh output directory.

This plan extends, rather than replaces, the implemented foundations in:

- [`server-state-query-cache-plan.md`](./server-state-query-cache-plan.md)
- [`cross-device-cache-invalidation-plan.md`](./cross-device-cache-invalidation-plan.md)

Those plans established the dashboard `QueryClient`, account-scoped query keys, session cache cleanup, and generic Redis/WebSocket invalidation. This plan migrates the remaining server-owned desktop state onto that architecture.

## Goal

Use one consistent server-state architecture throughout the desktop application so that a server-owned fact is not independently cached in contexts, components, refs, window events, and query data.

The target architecture must provide:

- One account-scoped TanStack Query cache per renderer.
- One mutation path for each domain operation.
- Automatic request deduplication, cancellation, freshness, retry, and cache cleanup.
- Patch-aware optimistic updates with rollback and canonical response merging.
- Explicit dependency invalidation for lists, details, search, activity, and counts.
- Cross-device and cross-window recovery through the existing generic resource-event bridge.
- A strict distinction between server state, unsaved drafts, navigation state, and live stream state.
- No user data persisted to browser storage merely to make the query cache durable.

## Non-goals

- Moving every `useState` or every React context into TanStack Query.
- Treating transient UI state as server state.
- Replacing the Electron authentication trust boundary.
- Storing access tokens or authenticated response data in query keys or browser storage.
- Persisting the TanStack Query cache to disk.
- Routing live audio frames, transcription deltas, pointer state, dialog state, or animation state through TanStack Query.
- Introducing a second global client-state library alongside TanStack Query.
- Sending full replacement resource data over the generic WebSocket invalidation channel.
- Guaranteeing durable resource-event delivery; API reads remain authoritative.

## Existing foundation

The following implementation is already aligned with the target architecture and should be reused:

- `desktop/src/lib/query-client.ts` owns the dashboard `QueryClient`, shared defaults, active-account guard, and account cleanup.
- `desktop/src/lib/query-keys.ts` provides account-prefixed query keys.
- `desktop/src/app/providers/ServerStateSessionBoundary.tsx` cancels and removes the previous account's cache.
- `desktop/src/app/providers/ServerStateInvalidationBridge.tsx` subscribes once to generic `resource.changed` events.
- `desktop/src/app/realtime/resource-invalidation.ts` is the exhaustive resource-to-query dependency registry.
- `desktop/src/features/calendar/useCalendarEvents.ts` and `useCalendarSettingsQuery.ts` demonstrate query-backed server state.
- Vocabulary, Billing, Extract Fields, Email Draft settings, and Summary Templates already use TanStack Query.
- Email Draft settings demonstrate mutation serialization and patch-aware optimistic/canonical merging.

Do not add feature-specific query clients, feature-specific WebSocket connections, or new handwritten request maps.

## State ownership rules

Every state value must be assigned to exactly one of these categories.

### Server state

Examples: folders, note records, note lists, attendees, saved transcripts, activity, calendar data, conversations, and persisted messages.

Rules:

- Owned by TanStack Query.
- Keyed by authenticated account and all inputs that affect the response.
- Updated through query-aware domain mutations.
- Never copied into a context-owned mirror or component cache.
- May be projected with `select`, `useMemo`, or pure selectors.

### Unsaved draft state

Examples: the current note body before autosave, an edited title, a dialog input, or a pending prompt.

Rules:

- Remains local to the editor/form that owns it.
- Hydrates from canonical query data when the entity identity changes.
- Tracks dirty fields explicitly.
- Must not resend unrelated fields from an old snapshot.
- Reconciles canonical responses only for fields included in the submitted patch.

### Navigation and presentation state

Examples: active dashboard view, selected note ID, selected folder ID, open dropdown, expanded sidebar folder, selected calendar event, and sort controls.

Rules:

- Remains in component state, a small UI context, or a router.
- Stores identifiers and presentation choices, not server response objects.
- A selected entity is derived from its query by ID.

### Live ephemeral state

Examples: WebSocket status, streaming chat deltas, live transcription segments, recording state, abort controllers, and upload progress.

Rules:

- Remains in a lifecycle-specific context/hook or component.
- On completion, writes canonical persisted results into or invalidates the appropriate query.
- Must not use query refetching for high-frequency stream deltas.

### Electron-owned local settings

Examples: recording storage location, local recording path, shortcuts, and native window state.

Rules:

- Remain behind typed Electron IPC.
- They may use a small IPC-specific hook when shared by multiple consumers.
- They do not belong in the account server-state cache unless the product later persists them through the backend.

## Audit results

### Repository-wide boundary

TanStack Query is currently a desktop-renderer dependency, and the meaningful migration candidates are in `desktop/src`.

- The `web` application is primarily server-rendered marketing UI plus one-shot authentication, integration, and billing callback clients. Its client state is presentation state or callback lifecycle state; the audit found no persistent client-side server-response cache that warrants introducing TanStack Query there.
- The Go backend's calendar cache, Redis integration, repository maps, WebSocket hub, and worker state are server infrastructure or durable database projections. They must not be conflated with renderer query caching or replaced by TanStack Query.
- Backend work in this plan is limited to canonical mutation responses, concurrency controls, and publishing invalidation hints for newly query-backed desktop resources.
- Reassess the web application separately if it later gains an authenticated, long-lived client dashboard with repeated reads and mutations.

### Already aligned; retain

| Area | Current owner | Decision |
|---|---|---|
| Calendar events | `useCalendarEvents` | Retain query ownership and shared event bridge. |
| Calendar accounts/visibility | `useCalendarSettingsQuery` | Retain query/mutation hooks. |
| Vocabulary | `useVocabularyQuery` | Retain optimistic query mutation. |
| Billing status | `BillingContext` backed by `useQuery` | Retain the thin context because it adds Stripe orchestration, not a second status cache. |
| Extract Fields | `useExtractFieldsQuery` | Retain. |
| Email Draft settings | `useEmailDraftSettingsQuery` | Retain and reuse its patch-aware merge pattern. |
| Summary Templates | `useSummaryTemplatesQuery` | Retain. |
| Session cache isolation | `ServerStateSessionBoundary` | Extend to every new account-prefixed key. |
| Cross-device invalidation | `ServerStateInvalidationBridge` | Extend its resource registry rather than subscribing inside features. |

### High-priority migrations

| Area | Handwritten behavior today | Target |
|---|---|---|
| Notes and folders | `DashboardNotesContext` stores folder rows, note entities, per-folder pages, cursors, loading flags, selected detail, attendees, and mutation reconciliation. | Query/infinite-query hooks plus centralized note/folder mutations. Keep only navigation/dialog state in a thin dashboard notes UI context. |
| Recent activity | `HomeView` fetches into local state and listens for `dashboard-activity-refresh`. | `useInfiniteQuery` keyed by sort, direction, and scope; note/folder mutations invalidate the activity family. |
| Dashboard search | `DashboardTopBar` owns debounce, cancellation flags, result arrays, offsets, and separate load-more state. | Query-backed debounced search; use query cancellation and infinite pagination. Keep input/open state local. |
| Notes linked to a calendar event | `CalendarView.EventDetail` owns rows, cursor, loading, merging, and refresh. | `useInfiniteQuery` keyed by calendar event ID. Note create/link/unlink mutations invalidate it. |
| Note detail and autosave | `NoteEditorView` copies detail fields locally and calls `updateNote` directly. | `useNoteQuery` plus field-specific, serialized mutations. Only title/body remain drafts; folder/event relationships use canonical mutations. |
| Note attendees | `DashboardNotesContext` keeps a second attendee map while note detail also contains attendees. | One canonical attendee query or one canonical note-detail field, updated by attendee mutations. Do not keep both. |
| Saved transcript | `NoteEditorView` uses refs and local result/loading state. | Lazy `useQuery` keyed by note ID and enabled when the transcript panel opens. |
| Meeting search/linking | `NoteEditorView` owns request timers, result cache, linked-event cache, and direct update calls. | Debounced query keyed by note ID and search term plus a canonical link-event mutation. |

### Medium-priority migrations

| Area | Handwritten behavior today | Target |
|---|---|---|
| Chat conversations | `ChatContext` fetches and mutates a local conversation array. | Query-backed scoped conversation lists with create/rename/delete mutations. |
| Persisted chat messages | `ChatContext` fetches messages into local state and merges completed SSE messages manually. | Query-backed message history. Streaming buffers remain local and commit completed canonical messages to the query cache. |
| Remote overlay note | `CompactMeetingPanel` fetches and caches the same note independently from the dashboard. | Reuse note query/mutation options under a query provider in the overlay renderer. Preserve local pseudo-note behavior separately. |
| Calendar sync command | `DashboardTopBar` calls the endpoint and mutates calendar cache through module-level helpers. | `useCalendarSyncMutation`, using `useQueryClient`, with sync metadata updates and canonical invalidation. |
| Enhance/revert note actions | Components call command endpoints and manually replace note state. | Mutations that merge the canonical note and invalidate dependent list/search/activity queries. |

### Keep outside TanStack Query

| Area | Reason |
|---|---|
| `AuthContext` | Electron main process is the authentication authority and pushes session snapshots. Duplicating the user in query data creates two identity sources. |
| `WebSocketContext` and `wsClient` | Connection lifecycle and subscriptions are live infrastructure, not request/response server state. |
| Sidebar, dialog, picker, and editor open state | Pure UI state. |
| Dashboard mode and selected IDs | Navigation state; store IDs only. |
| Note title/body before autosave | Unsaved form state. |
| Live transcription and audio capture | High-frequency ephemeral streams. Persisted transcript results may enter the query cache after save. |
| Chat streaming text, thinking deltas, current tool execution, and abort state | High-frequency stream state. Completed persisted messages belong in query data. |
| Recording preferences and shortcuts | Electron IPC-owned local settings, explicitly outside the existing account server-state plan. |
| Stripe checkout/portal progress | Workflow state layered over the already query-backed billing status. |
| Local meeting fallback notes | Deliberately local `localStorage` data, not backend server state. |
| Component-local rename text and dialog form values | Unsaved drafts. |

## Query-key design

Extend `desktop/src/lib/query-keys.ts`. Every authenticated key must remain under `['account', accountID]`.

Suggested factories:

```ts
export const queryKeys = {
  account: (accountID: string) => ['account', accountID] as const,

  folders: (accountID: string) =>
    ['account', accountID, 'folders'] as const,

  notes: (accountID: string) =>
    ['account', accountID, 'notes'] as const,
  note: (accountID: string, noteID: string) =>
    ['account', accountID, 'notes', 'detail', noteID] as const,
  notesByFolder: (accountID: string, folderID: string | null) =>
    ['account', accountID, 'notes', 'by-folder', folderID ?? 'unfiled'] as const,
  notesByEvent: (accountID: string, eventID: string) =>
    ['account', accountID, 'notes', 'by-event', eventID] as const,
  noteTranscript: (accountID: string, noteID: string) =>
    ['account', accountID, 'notes', 'transcript', noteID] as const,
  noteAttendees: (accountID: string, noteID: string) =>
    ['account', accountID, 'notes', 'attendees', noteID] as const,

  activity: (accountID: string, filters: ActivityFilters) =>
    ['account', accountID, 'activity', filters] as const,
  search: (accountID: string, normalizedQuery: string) =>
    ['account', accountID, 'search', normalizedQuery] as const,
  calendarEventSearch: (accountID: string, noteID: string, normalizedQuery: string) =>
    ['account', accountID, 'calendar-event-search', noteID, normalizedQuery] as const,

  conversations: (accountID: string, scope: ConversationScope) =>
    ['account', accountID, 'chat', 'conversations', scope] as const,
  messages: (accountID: string, conversationID: string) =>
    ['account', accountID, 'chat', 'messages', conversationID] as const,
}
```

Requirements:

- Normalize search strings before using them in keys.
- Use stable plain objects for filter/scope objects.
- Do not place whole note, folder, user, or event objects in keys.
- Do not place access tokens, emails, note contents, prompts, or transcript text in keys.
- Define family/root keys where broad invalidation is required.
- Query functions must accept and pass the TanStack `AbortSignal` to `authenticatedFetch`.

## Notes and folders target architecture

### Queries

Add domain hooks, split by responsibility rather than one large context:

```text
desktop/src/features/notes/queries/
  note-query-options.ts
  useFoldersQuery.ts
  useNoteQuery.ts
  useNotesByFolderQuery.ts
  useNotesByEventQuery.ts
  useNoteTranscriptQuery.ts
  useNoteAttendeesQuery.ts
  note-cache-transforms.ts
```

- Folders use `useQuery` because the current endpoint returns the complete active list.
- Folder contents use `useInfiniteQuery` with the existing cursor API.
- Unfiled notes use the same folder-content hook with `folderID: null`.
- Note detail uses `useQuery` and is the canonical complete note representation.
- Folder pages contain note summaries and IDs but are not writable authorities for note fields.
- Event-linked notes use `useInfiniteQuery` and reuse canonical note-summary transforms.
- Transcript loading is disabled until its panel is opened.
- Attendees must have one canonical cache location. Prefer a separate query only if attendees have an independent endpoint/lifecycle; otherwise keep them exclusively in note detail.

### Thin UI context

`DashboardNotesContext` may remain temporarily to minimize consumer churn, but its final responsibility should be limited to:

- `selectedNoteId`
- `selectedFolderId`
- create-dialog visibility
- navigation helpers

It must not own fetched folders, note entities, folder pages, cursors, attendee collections, loading flags, or API mutation implementations.

Longer term, selected IDs may move into dashboard navigation state, allowing `DashboardNotesContext` to be deleted.

### Canonical mutations

Provide one hook/action per operation:

- `useCreateFolderMutation`
- `useRenameFolderMutation`
- `useDeleteFolderMutation`
- `useCreateNoteMutation`
- `useUpdateNoteMutation`
- `useMoveNoteMutation`
- `useDeleteNoteMutation`
- `useLinkNoteEventMutation`
- `useAddNoteAttendeeMutation`
- `useRemoveNoteAttendeeMutation`
- `useEnhanceNoteMutation`
- `useRevertNoteMutation`

All UI entry points call these operations. Components must not call `notes-client.ts` or `folders-client.ts` mutation functions directly.

For a folder move, the mutation owns this complete dependency update:

1. Cancel note detail, relevant folder pages, folder list, event-linked lists, activity, and search requests that could overwrite the optimistic result.
2. Snapshot exact rollback data.
3. Update the note detail/summary folder ID.
4. Remove the note from every cached folder page in which it appears.
5. Add it once to the loaded destination page.
6. Adjust cached folder counts without going below zero.
7. Preserve the selected note ID; navigation does not change merely because its folder changed.
8. On failure, restore all snapshots.
9. On success, merge the canonical API response only into fields controlled by the mutation.
10. Invalidate dependent query families after settlement so the API remains authoritative.

Search and activity results do not need fully optimistic structural edits. Mark them stale and keep their cached rows visible during background refetch.

### Autosave and stale-write prevention

The current note editor sends title, folder, and body together whenever any draft changes. That permits an old draft snapshot to overwrite an externally changed folder or event relationship.

Replace it with field-specific patches:

- Title autosave sends `{ title }` only.
- Body autosave sends `{ noteMarkdown }` only.
- Folder selection calls `useMoveNoteMutation` immediately.
- Calendar link selection calls `useLinkNoteEventMutation` immediately.
- Attendee changes use attendee mutations.

Serialize autosaves per note and field using TanStack mutation `scope`, or a tested autosave coordinator. A slower earlier response must not overwrite a faster later edit.

Add backend optimistic concurrency before relying on cross-device editing:

- Prefer a monotonic `revision` on notes, returned by reads and writes.
- Accept `expected_revision` or `If-Match` on mutations.
- Return `409 Conflict` or `412 Precondition Failed` for stale writes.
- Refetch canonical state and surface a non-destructive conflict message rather than silently applying last-write-wins.

`updated_at` alone is useful for display but is weaker than an explicit revision for concurrency control.

## Activity and search

### Recent activity

Add `useActivityQuery(filters)` using `useInfiniteQuery` and the existing cursor response.

- Remove the `dashboard-activity-refresh` DOM event.
- Note and folder mutations invalidate the account's activity query family.
- A manual dashboard refresh invalidates the activity key through `queryClient`, not `window.dispatchEvent`.
- Preserve cached rows during background refresh.
- Scope/sort changes select a different cache entry instead of clearing one shared array.

### Dashboard search

Keep only `searchQuery` and popover visibility in `DashboardTopBar`.

- Debounce the normalized term with a small reusable hook.
- Disable remote search for an empty term and continue deriving default suggestions from cached folders/recent notes.
- Use query cancellation through the query function's `AbortSignal`.
- Use infinite queries for pagination instead of manual offsets and merge/deduplication state.
- Because the endpoint has independent folder and note offsets, either expose two query hooks or revise the endpoint to return one opaque combined cursor. Do not conceal two independent cursors inside an unreliable single `getNextPageParam`.
- Invalidate the search family after note/folder mutations; keep prior search data visible during revalidation where appropriate.

## Calendar-linked notes and note editor resources

### Notes by event

Replace `CalendarView.EventDetail`'s linked-note array/cursor/loading state with `useNotesByEventQuery(eventID)`.

- Creating a note linked to an event seeds or invalidates the event's query.
- Linking/unlinking a note invalidates both the previous and next event keys.
- Opening an existing note reads the cached ID and navigates; it does not copy the note into calendar component state.

### Transcript

Replace `transcriptLoadedForRef`, `transcriptSegments`, and `transcriptLoading` with a lazy query.

- Key by account and note ID.
- Enable only when the transcript panel is open.
- Invalidate after saved transcript segments are committed.
- Do not place live, uncommitted transcription deltas in the query cache.

### Calendar event search and linking

- Extract event search HTTP parsing from `NoteEditorView` into the calendar API client.
- Query by account, note ID, and normalized search term.
- Use `AbortSignal` so typing cancels obsolete requests.
- Remove `linkedMeetingCache`; the linked event comes from canonical note detail.
- Make linking a canonical note mutation that updates the detail and relevant event-note queries.
- Populate attendees through the attendee mutation/cache path, not a component loop that maintains a separate attendee map.

## Chat target architecture

Do not move SSE streaming itself into ordinary queries.

Split `ChatContext` into:

### Query-owned persisted state

- Scoped conversation lists.
- Persisted messages by conversation.
- Create, rename, and delete conversation mutations.
- Canonical user and assistant messages received in the SSE `done` event.
- Persisted thinking/tool metadata returned by the messages endpoint.

### Context/local stream state

- Widget open/closed state.
- Active conversation ID.
- Abort controller.
- Whether a stream is active.
- In-progress text/thinking deltas.
- In-progress tool calls.
- Transient stream error.

On stream completion:

1. Replace the optimistic user message with the canonical returned message.
2. Append the canonical assistant message exactly once.
3. Update the conversation title/list from the canonical event or invalidate it.
4. Invalidate/refetch message history after settlement as a correctness fallback.
5. If a `note_updated` event occurs, update/invalidate the canonical note query instead of dispatching `note-updated-by-ai` on `window`.

The context may remain as a thin stream orchestrator. It must not remain the long-term cache for conversations and persisted messages.

## Overlay renderer

The overlay and dashboard are separate renderer environments and cannot safely assume a shared in-memory `QueryClient`.

- Factor reusable query-client construction and account session cleanup into shared providers.
- Mount a query provider in the overlay only for resources it consumes.
- Reuse the same query keys, options, transforms, and mutation hooks.
- Keep a separate in-memory cache per renderer.
- Use backend resource events to invalidate every connected renderer.
- Do not attempt to share a mutable QueryClient object across Electron renderer processes.

For `CompactMeetingPanel`:

- Remote notes use `useNoteQuery` and the body autosave mutation.
- Local pseudo-notes keep the current local-storage adapter and never enter account query keys.
- Live transcript state remains local.
- When transcript segments are persisted, invalidate the saved transcript query once per committed batch, not per audio delta.

## Realtime resource expansion

The current resource registry does not include notes, folders, transcripts, or chat. Extend the existing generic infrastructure rather than adding feature subscriptions.

Suggested new resource names:

- `folders`
- `notes`
- `note_attendees`
- `note_transcripts`
- `chat_conversations`
- `chat_messages`

Dependency mapping examples:

| Resource | Query families to invalidate |
|---|---|
| `folders` | folders, notes-by-folder as needed, activity, search, Extract/Summary Template folder consumers if folder availability changed |
| `notes` | note detail or notes root, notes-by-folder, notes-by-event, folders/counts, activity, search |
| `note_attendees` | note attendees and/or note detail for the affected note |
| `note_transcripts` | saved transcript and transcript search for the affected note/account |
| `chat_conversations` | matching conversation-list families |
| `chat_messages` | messages for the affected conversation and its conversation-list metadata |

Use `resource_id` to narrow detail invalidation when safe, while still invalidating dependent list families. A detail-only invalidation is insufficient when a mutation changes list membership, ordering, counts, or search results.

Backend requirements:

- Add allowlisted resource enums in `backend/internal/resourceevents/event.go`.
- Inject the existing publisher into note, folder, attendee, transcript, and chat mutation handlers/services.
- Publish only after a successful commit.
- Publish once per logical/batched operation, not once per transcript segment or streaming token.
- Continue treating publication failure as non-fatal to an already committed API mutation.
- Add handler tests proving successful mutations publish and failed mutations do not.

Cross-device correctness must not depend exclusively on Pub/Sub. Stale time, focus/reconnect refetch, and manual refresh remain fallback paths.

## Shared cache-transform rules

Create tested pure helpers for cross-query transformations instead of embedding large `setQueryData` blocks in components.

Required properties:

- Idempotent insertion: an entity appears at most once in a page/list.
- Complete removal: deletion/move removes the entity from every affected loaded page.
- Stable pagination metadata unless the server response replaces it.
- Counts never become negative.
- Account guard: late callbacks cannot recreate cache data for a signed-out account.
- Patch-aware rollback: a failed older mutation does not undo a newer successful field change.
- Patch-aware canonical merge: an older response only replaces fields controlled by its request.
- Unknown/unloaded destinations remain unloaded; do not fabricate an authoritative complete page.

Keep these helpers domain-specific. Do not create a generic cache mutation DSL.

## API and backend adjustments

Before or during migration:

- Add `AbortSignal` support to desktop API clients.
- Ensure mutation responses return canonical affected resources.
- Ensure folder responses/counts can be refreshed without fetching every note.
- Add explicit note revision/concurrency support.
- Preserve cursor pagination for notes, activity, event-linked notes, and messages where applicable.
- Consider adding pagination to folders only after measured need; the current complete folder list is acceptable initially.
- Ensure chat message completion returns canonical message IDs and metadata.
- Make server-side AI note updates publish the same `notes` resource event as ordinary note mutations.

## Delivery phases

Each phase must compile, pass tests, and leave no mixed writable ownership for the resource it migrates.

### Phase 0 — Contract and safeguards

- Add the new query-key families.
- Add query-option factories and pure cache-transform tests.
- Add a contributor checklist defining state categories and mutation rules.
- Add `AbortSignal` parameters through the affected API clients.
- Do not change UI behavior yet.

### Phase 1 — Read-only notes and folders

- Add folders, note-detail, and notes-by-folder queries.
- Adapt `DashboardNotesContext` consumers through a compatibility facade.
- Migrate sidebar, My Notes, search defaults, and note viewer reads.
- Keep existing mutations temporarily, but make query data the only read authority.
- Remove context-owned fetched arrays/pages once all consumers read queries.

### Phase 2 — Canonical note/folder mutations

- Add folder CRUD and note CRUD/move mutations.
- Separate title/body autosave from folder/event relationship changes.
- Update all UI entry points to use the same mutations.
- Add optimistic rollback and canonical merge tests.
- Remove direct component calls to note/folder mutation clients.
- Remove temporary folder synchronization effects and page-relocation compatibility code.

### Phase 3 — Note dependencies

- Migrate attendees, transcripts, notes-by-event, event search/linking, enhance, and revert.
- Remove `linkedMeetingCache`, transcript load refs, and attendee maps.
- Replace AI/custom DOM events with query cache updates/invalidation.
- Add note/folder resource events and registry mappings.

### Phase 4 — Activity and global search

- Migrate Recent Activity to an infinite query.
- Remove `dashboard-activity-refresh`.
- Migrate global search and pagination.
- Centralize dashboard refresh as query-family invalidation plus the calendar sync mutation.

### Phase 5 — Chat

- Migrate conversation lists and persisted messages.
- Retain a thin streaming context.
- Add cache-aware SSE settlement and note invalidation.
- Add chat resource events if cross-device chat freshness is required.

### Phase 6 — Overlay adoption

- Mount shared server-state providers in the overlay renderer.
- Reuse remote note query/mutation hooks in `CompactMeetingPanel`.
- Preserve local fallback notes and live stream state.
- Verify dashboard and overlay converge through backend invalidation events.

### Phase 7 — Cleanup and enforcement

- Delete obsolete server-state fields/actions from `DashboardNotesContext` and `ChatContext`.
- Remove feature-specific DOM refresh events and manual server-result refs.
- Search for component-level request effects and classify every remaining instance.
- Document the query/mutation pattern in contributor guidance.
- Add lint/review rules where practical: components should import domain hooks, not mutation clients.

## Recommended file changes

| File/area | Change |
|---|---|
| `desktop/src/lib/query-keys.ts` | Add notes, folders, activity, search, transcript, attendee, and chat families. |
| `desktop/src/lib/query-client.ts` | Factor reusable client construction if the overlay adds a provider; retain account cleanup. |
| `desktop/src/features/notes/queries/*` | Add query options, hooks, mutations, and tested cache transforms. |
| `desktop/src/features/notes/DashboardNotesContext.tsx` | Reduce to navigation/dialog state, then consider removal. |
| `desktop/src/features/notes/NoteEditorView.tsx` | Consume note queries/mutations; retain only true drafts and UI state. |
| `desktop/src/features/home/HomeView.tsx` | Replace local activity fetch/event with query data. |
| `desktop/src/features/dashboard/DashboardTopBar.tsx` | Replace manual search/cache/refresh orchestration with hooks. |
| `desktop/src/features/calendar/CalendarView.tsx` | Replace linked-note local cache with an infinite query. |
| `desktop/src/features/chat/ChatContext.tsx` | Retain stream/UI orchestration; remove persistent response caches. |
| `desktop/src/features/overlay/CompactMeetingPanel.tsx` | Reuse remote note queries/mutations. |
| `desktop/src/app/realtime/types.ts` | Add typed resource names. |
| `desktop/src/app/realtime/resource-invalidation.ts` | Register dependency invalidations for new resources. |
| `backend/internal/resourceevents/event.go` | Add backend resource enums. |
| Backend note/folder/chat handlers | Publish best-effort changes after commit. |

## Verification strategy

### Pure cache-transform tests

- Moving a note removes it from unfiled and inserts it once into a loaded folder.
- Moving between two folders never duplicates the note.
- Repeating the same optimistic transform is idempotent.
- Moving into an unloaded destination does not mark that destination complete.
- Folder counts update and roll back correctly.
- Deleting a note removes it from every loaded page and detail cache.
- An older failed patch does not roll back a newer successful field value.
- An older canonical response does not overwrite a newer draft/mutation field.

### Query-hook tests

- Account ID is present in every authenticated key.
- Queries stay disabled without an account or required entity ID.
- Obsolete searches and note selections abort their requests.
- Infinite queries use the server cursor/offset exactly once.
- Cached data remains visible during background refresh and background failure.
- Logout cancels requests and late callbacks cannot recreate the previous account cache.

### Component scenarios

- Move an open note from the sidebar; the editor picker updates immediately.
- Move an open note from the editor; the sidebar removes the old row and shows one destination row.
- Open the same note in dashboard and overlay; changes converge after mutation/invalidation.
- Change title/body while a folder move occurs; the autosave does not restore the old folder.
- Rapid title edits resolve in the order of the latest submitted value.
- Create/delete/rename folders from every entry point; sidebar, My Notes, settings folder selectors, search, and counts converge.
- Add/remove attendees from multiple views without duplicate chips.
- Link/unlink a calendar event; Calendar event details and the note editor converge.
- AI note updates appear through the canonical note cache without a custom DOM event.
- Recent Activity and search refresh without clearing cached content.
- Chat stream completion produces one user and one assistant message after refetch.

### Cross-device and reconnect scenarios

- Device A moves/renames/deletes a note; device B updates active detail and lists.
- Device A changes a folder; device B refreshes folder selectors and folder lists.
- Device B misses events while offline; reconnect invalidation recovers canonical state.
- A resource event for account A never invalidates or populates account B's cache.
- Redis publication failure does not fail an already committed mutation; focus/manual refresh recovers.

### Static and build checks

Backend:

```powershell
go test ./...
go vet ./...
```

Desktop:

```powershell
npm run lint
npx tsc --noEmit
npm test -- --run
npm run build
```

## Migration acceptance criteria

The migration is complete when:

- No component or general-purpose context owns a second writable cache of server responses.
- All authenticated query keys are account-prefixed and removed on account change/logout.
- Components import domain query/mutation hooks for server operations.
- A note's folder, event link, attendees, and persisted content each have one canonical write path.
- `dashboard-activity-refresh` and `note-updated-by-ai` are removed.
- Notes, folders, activity, search, transcripts, attendees, and persistent chat data use query-backed reads.
- Cross-device invalidation is registered centrally for newly migrated resources.
- Direct API clients remain pure transport/parsing modules without React state or caches.
- Auth, UI state, local IPC settings, streaming state, and unsaved drafts remain outside the server-state cache.
- Optimistic update, rollback, stale response, logout isolation, and cross-device scenarios are covered by tests.

## Risks and mitigations

### Broad migration creates two authorities temporarily

Migrate one resource family at a time and remove its old writable state in the same phase. Compatibility facades may adapt return shapes, but must not mirror query data into `useState`.

### Optimistic updates touch many query families

Centralize tested domain transforms. Optimistically update only immediate, deterministic views; invalidate search/activity and other expensive projections.

### Debounced saves race with relationship mutations

Use field-specific PATCH requests, mutation scopes, abort/cancel behavior where safe, and backend revisions. Never submit folder/event IDs as incidental fields in a body/title autosave.

### Realtime event storms

Publish at logical transaction boundaries, retain the existing client batcher, and invalidate query families rather than issuing imperative refetches per component.

### Overlay and dashboard caches diverge

Treat each renderer cache as disposable and independent. Converge through canonical API responses plus backend resource events and reconnect invalidation.

### TanStack Query is mistaken for a database

The API/database remain authoritative. Query data is an in-memory projection with finite stale time, background revalidation, and explicit invalidation.

## Contributor checklist after migration

Before adding a new async state path:

1. Is the value owned by the backend, Electron main process, a live stream, or the current component?
2. If backend-owned, is there an account-scoped query key and pure API fetcher?
3. Is the operation represented by one domain mutation hook?
4. Which detail, list, count, activity, and search queries depend on it?
5. Can the optimistic transform be rolled back without overwriting a newer mutation?
6. Does the canonical response merge only the submitted fields?
7. Does another device or background worker modify it? If so, register a generic resource invalidation.
8. Does logout cancel and remove it under the account prefix?
9. Are unsaved drafts and live deltas kept outside query data?
10. Are cache transforms and race scenarios tested?
