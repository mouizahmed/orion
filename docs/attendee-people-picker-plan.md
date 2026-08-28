# Attendee People picker plan

## Status

Planned. This document covers selecting existing People while editing a note's attendees. It does not implement automatic attendee collection.

## Goal

Extend the note attendee dropdown so a user can quickly add someone already saved in **People**, while preserving manual entry for a new email address.

The picker must:

- Show only People who are not already attendees of the current note.
- Match attendees and People by normalized email address, case-insensitively.
- Search by name or email.
- Remain responsive with hundreds of People.
- Add the selected Person through the existing note-attendee API and cache mutation.
- Keep the current manual **Name (optional)** and required **Email address** entry path.

## Product behavior

### Dropdown structure

When the attendee dropdown opens:

1. Keep the manual name and email inputs at the top.
2. Add a **People** section between the inputs and the current attendee list.
3. Show up to 20 matching People at once rather than rendering the entire People list.
4. Keep the existing attendees section and removal controls below it.

Each People result shows:

- Avatar initials
- Name when present
- Email address

Selecting a result adds that Person as an attendee using their saved name and email. Disable repeat selection while that request is pending.

### Excluding existing attendees

Build a set from the current note attendees:

```ts
const attendeeEmails = new Set(
  attendees.map((attendee) => attendee.email.trim().toLowerCase()),
)
```

Exclude any Person whose normalized email is already in that set. This rule applies before search ranking and result limiting, so available People are not displaced by hidden duplicates.

The backend's existing duplicate-email conflict remains authoritative for stale data, races, and changes from another device. If it returns `attendee already exists`, refresh the note and show the existing duplicate message.

### Search and empty states

- Search names and emails case-insensitively.
- Trim the query before matching.
- With an empty query, show the first 20 available People in the existing stable People order.
- Prefer prefix matches over substring matches when a query is present.
- Show **No matching people** when the query has no available matches.
- Show **All people have been added** when People exist but every Person is already an attendee.
- Do not hide or disable manual email entry in any empty state.
- If People fails to load, keep manual entry and the attendee list functional; show only a small retry/error state in the People section.

## Scale decision

### Initial implementation: cached client-side filtering

Reuse the existing account-scoped `usePeople(accountID)` TanStack Query data. The People page and attendee picker should share `queryKeys.people(accountID)` rather than fetch and cache the same resource separately.

Filtering a few hundred small Person records in memory is inexpensive. The important UI constraint is to render no more than 20 results, so the dropdown does not become tall or create hundreds of DOM rows.

Use a deferred or debounced search value only if profiling shows typing causes visible work. At the expected size of hundreds, a memoized filter is sufficient and avoids artificial input delay.

### Future threshold: server-side search

Move the picker to server-side search and cursor pagination when account lists routinely reach several thousand People, list payload size becomes material, or measurements show the shared full-list query is slow.

That later API should use a shape such as:

```text
GET /api/people?q=<search>&limit=20&cursor=<opaque-cursor>
```

Requirements for that phase:

- Scope the query to the authenticated user in the repository and database transaction.
- Enforce a small maximum limit.
- Use deterministic cursor ordering with a unique tie-breaker such as `(lower(name), id)`.
- Return an opaque next cursor rather than using unbounded offsets.
- Measure the actual query with `EXPLAIN (ANALYZE, BUFFERS)` before adding indexes.
- Add an account-scoped search index only when the measured query needs it; do not add speculative indexes in the initial picker change.
- Continue filtering against the current note attendees in the client because that list is already present and small. The add endpoint still enforces uniqueness.

The current `people_user_name_idx` and normalized unique email index should remain unchanged for the initial cached implementation. Any future contains-search design must be reviewed separately because a normal B-tree index does not accelerate arbitrary `%term%` matching.

## Desktop implementation

### Data reuse

In `desktop/src/features/notes/NoteAttendeesDropdown.tsx`:

- Call `usePeople(user?.id ?? '')` only while an authenticated account is available.
- Reuse its shared query key and cached data.
- Do not introduce component-local network caching or another People endpoint client.
- Keep cached results visible during a background refetch.

Extract pure helpers for testability:

```text
normalizeEmail(email)
availablePeople(people, attendees)
filterAndRankPeople(people, query, limit)
```

### Selection mutation

Use the existing `useAddNoteAttendeeMutation` with:

```ts
{
  noteID: note.id,
  email: person.email,
  name: person.name || undefined,
}
```

On success, the existing mutation places the canonical attendee in the note cache. The Person then disappears from the available results automatically because their email is now present in `note.attendees`.

On failure:

- Keep the dropdown open.
- Re-enable the result.
- Show **That email is already an attendee** for a duplicate conflict.
- Show **Could not add attendee** for other failures.
- Let the existing mutation refetch reconcile stale note data.

Track the pending email rather than disabling every result, unless the underlying mutation is intentionally serialized. This gives clear feedback on the selected row and prevents double-clicks.

### Accessibility and keyboard behavior

- Treat People results as buttons/options with an accessible label containing name and email.
- Support arrow-key navigation through visible results and Enter to select.
- Preserve Escape-to-close behavior.
- Keep focus predictable after a Person is added.
- Ensure the People result list has its own bounded scroll area if needed.
- Do not rely on hover alone to communicate selection or pending state.

## Backend and database impact

No backend endpoint, database migration, RLS policy, or new index is required for the initial implementation. It reuses:

- `GET /api/people` for the authenticated account's People list.
- `POST /api/notes/:noteID/attendees` for selection.
- The unique normalized attendee email constraint and existing `409` behavior.
- Existing account-scoped TanStack Query and realtime invalidation for People.

Automatic attendee collection into People remains a separate feature. Adding a Person from this picker to a note must not create, rename, or update a People record.

## Delivery sequence

1. Add pure normalized-email exclusion and search/ranking helpers.
2. Load People through the existing shared query in the attendee dropdown.
3. Add the bounded People results section and its loading, error, empty, and all-added states.
4. Connect selection to the existing add-attendee mutation with per-row pending feedback.
5. Add keyboard and focus behavior.
6. Add focused unit/component tests and run the desktop verification suite.

## Verification

- A Person not already attending appears in the picker.
- A Person whose email differs only by casing or surrounding whitespace from an attendee does not appear.
- Selecting a Person adds the saved email and optional name once.
- The selected Person disappears from picker results immediately after the note cache updates.
- Existing attendees never appear as selectable People.
- Manual entry still works when People is loading, empty, or unavailable.
- Empty search shows at most 20 available People.
- Search matches both name and email and prefers prefix matches.
- Hundreds of People do not produce hundreds of rendered result rows.
- If all People are attendees, the picker shows **All people have been added**.
- Duplicate conflicts and generic failures show the correct message without closing the dropdown.
- Removing an attendee makes a matching Person eligible for the picker again after the note cache updates.
- Switching accounts cannot expose the previous account's People cache.
- Desktop unit tests, TypeScript checks, lint, and relevant component tests pass.

## Explicitly out of scope

- Automatically collecting note or calendar attendees into People
- Editing or deleting People from the attendee dropdown
- Updating a saved Person's name when adding them to a note
- Creating a Person automatically after manual attendee entry
- Multi-select or bulk attendee addition
- Server-side People search or database changes in the initial release

## Completion boundary

This plan is complete when the attendee dropdown can search and select existing People, never offers someone already present by normalized email, renders a bounded result set for lists containing hundreds of People, and preserves the existing manual attendee workflow.
