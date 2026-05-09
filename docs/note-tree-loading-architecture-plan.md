# Note Tree Loading Architecture Plan

## Goal

Build the notes/folders tree so it scales cleanly without startup overfetching, while keeping selection restore, linked calendar event labels, transcript loading, and editing behavior correct.

The current system already has per-folder note pagination, but it uses it eagerly: startup loads folders and then fetches the first note page for every folder. Each note page currently returns full note markdown, so the sidebar tree loads editor-sized data for notes the user may never open.

## Current State

### Folders

- `GET /folders` returns all folders for the user.
- Folder records are small: id, name, timestamps, parent metadata.
- The frontend stores all folders in `DashboardNotesContext`.
- `NotesTree` renders all folders.

This is acceptable for normal folder counts, including roughly 100 folders. If folder counts grow into the thousands, add virtualization or folder search/pagination later. The current problem is not folder loading.

### Notes

- `GET /notes?folder_id=...&limit=...&cursor=...` returns paginated notes for a folder.
- `GET /notes?unfiled=true&limit=...&cursor=...` returns paginated unfiled notes.
- `DashboardNotesContext.refresh()` currently calls:
  - `listFolders()`
  - `listNotesPage({ unfiled: true })`
  - `listNotesPage({ folderId })` for every folder
- `NoteRecord` includes `noteMarkdown`, so each tree page carries full note body content.

This means 100 folders causes 102 startup requests: folders, unfiled notes, and one note-page request per folder.

### Selected Note

- Selected note ID is restored from `localStorage`.
- Restore succeeds only if the selected note appears in the initially fetched note pages.
- There is a `getNote()` client method, but startup selection does not currently rely on it.

### Linked Calendar Event

- Notes store link identifiers:
  - `providerEventId`
  - `connectionId`
  - `calendarId`
- Note API responses do not include linked event display metadata such as title/start/color.
- The UI currently resolves the linked event label indirectly from meeting search results, which only exist after search/dropdown loading.

### Transcript

- Transcript is not part of note list payloads.
- Transcript segments are fetched only when the transcript panel opens.
- This lazy loading model is correct.

## Target Architecture

### Data Shapes

Introduce separate frontend types:

```ts
type NoteSummary = {
  id: string
  title: string
  folderId?: string
  createdAt: number
  updatedAt: number
}

type NoteDetail = NoteSummary & {
  noteMarkdown: string
  providerEventId?: string
  connectionId?: string
  calendarId?: string
  linkedEvent?: LinkedEventDetail
}

type LinkedEventSummary = {
  providerEventId: string
  connectionId: string
  calendarId: string
  title: string
  start: string
  color: string
}

type CalendarAttendee = {
  email: string
  name?: string
  responseStatus?: string
  optional?: boolean
  organizer?: boolean
}

type LinkedEventDetail = LinkedEventSummary & {
  end?: string
  allDay?: boolean
  calendarName?: string
  provider?: string
  meetingLink?: string
  eventLink?: string
  location?: string
  organizerEmail?: string
  attendees: CalendarAttendee[]
}

type NoteShare = {
  id: string
  noteId: string
  email: string
  userId?: string
  sharedBy: string
  role: "viewer" | "editor" | "owner"
  status: "pending" | "active"
  createdAt: string
  updatedAt: string
  userName?: string
  userAvatarUrl?: string
}
```

The tree consumes `NoteSummary`. The editor consumes `NoteDetail`.

`LinkedEventDetail` is the shape the selected note needs because the planned note-sharing attendee UI depends on cached calendar attendees.

`CalendarAttendee` and `NoteShare` are related but separate:

- `CalendarAttendee` means "this person is on the linked calendar event."
- `NoteShare` means "this person has been invited to, or already has access to, this note."
- An attendee starts with no note access until a `NoteShare` row is created.

### Backend API

Keep folders and notes separate.

Required endpoints:

- `GET /folders`
  - Returns all folder metadata for now.
  - Optionally include `note_count` later.

- `GET /notes?folder_id=...&limit=...&cursor=...`
  - Returns paginated `NoteSummary[]`.
  - Must not include `note_markdown`.

- `GET /notes?unfiled=true&limit=...&cursor=...`
  - Returns paginated unfiled `NoteSummary[]`.

- `GET /notes/:id`
  - Returns `NoteDetail`.
  - Includes `linked_event` detail if the note is linked to a cached calendar event.
  - `linked_event.attendees` must be populated from `calendar_events.attendees` so the editor can render attendee/share UI without depending on calendar search results.

- `GET /notes/:id/shares`
  - Returns `NoteShare[]` for the selected note.
  - Includes email, role, status, linked user profile fields if accepted, and timestamps.
  - Does not include invite tokens.

- `POST /notes/:id/shares`
  - Creates or updates a pending invitation for an email and sends the invite email.

- `PATCH /notes/:id/shares/:email`
  - Updates share role.

- `DELETE /notes/:id/shares/:email`
  - Revokes a pending invitation or active share.

Optional later:

- `GET /notes/recent?limit=...`
  - Useful for a startup/recent view.

### Linked Event Metadata

Do not resolve linked event labels through picker search state.

The note detail response should join to `calendar_events` using:

```sql
notes.user_id = calendar_events.user_id
notes.connection_id = calendar_events.connection_id
notes.calendar_id = calendar_events.calendar_id
notes.provider_event_id = calendar_events.provider_event_id
```

Return:

```json
"linked_event": {
  "provider_event_id": "...",
  "connection_id": "...",
  "calendar_id": "...",
  "title": "test meeting",
  "start": "2026-05-08T...",
  "end": "2026-05-08T...",
  "all_day": false,
  "color": "#...",
  "calendar_name": "Work",
  "provider": "google",
  "meeting_link": "https://...",
  "event_link": "https://...",
  "location": "Conference Room",
  "organizer_email": "owner@example.com",
  "attendees": [
    {
      "email": "person@example.com",
      "name": "Person Example",
      "response_status": "accepted",
      "optional": false,
      "organizer": false
    }
  ]
}
```

Note list summaries do not include `linked_event`. Raw event identifiers and attendees belong on `GET /notes/:id` because they are editor/linking/share workflow data, not tree data.

### Note Shares And Invitations

Do not store note sharing state inside `linked_event`.

The selected note view needs two independent data sets:

- `selectedNote.linkedEvent.attendees`: candidate people from the linked calendar event.
- `noteSharesByNoteId[selectedNote.id]`: actual note access and pending invitations.

This separation matters because notes can be shared with emails that are not event attendees, and event attendees do not automatically get note access.

Fetch note shares through `GET /notes/:id/shares` when the sharing UI mounts or opens. If the editor top bar needs a passive "shared with N" indicator before the sharing UI opens, add a small `share_summary` to `GET /notes/:id`:

```ts
type NoteShareSummary = {
  activeCount: number
  pendingCount: number
}
```

Do not include full `NoteShare[]` in note list summaries. Full share rows are selected-note workflow data, not tree data.

### Frontend State Model

Replace the single overloaded `notes: NoteRecord[]` model with separate state:

```ts
folders: FolderRecord[]

folderPages: Record<string, {
  noteIds: string[]
  hasMore: boolean
  cursor?: string
  isLoading: boolean
  loaded: boolean
}>

noteSummariesById: Record<string, NoteSummary>

selectedNoteId: string | null
selectedNote: NoteDetail | null
selectedNoteLoading: boolean

noteSharesByNoteId: Record<string, {
  shares: NoteShare[]
  loaded: boolean
  loading: boolean
}>
```

Use a stable key for unfiled notes:

```ts
const UNFILED_ID = "__unfiled__"
```

### Startup Flow

On app/dashboard startup:

1. Load all folders.
2. Load unfiled first page, or recent first page if the product wants recent notes as the default.
3. Read saved selected note ID from `localStorage`.
4. If a saved note ID exists, call `GET /notes/:id`.
5. Set `selectedNote` from the detail response.
6. Ensure the selected note summary exists in `noteSummariesById`.
7. If the selected note has a folder, mark or expand that folder as needed, but do not need to load the whole folder page immediately.

Do not fetch page one for every folder on startup.

### Folder Expansion Flow

When a user expands a folder:

1. Check `folderPages[folderId].loaded`.
2. If not loaded, fetch `GET /notes?folder_id=...&limit=20`.
3. Store returned summaries in `noteSummariesById`.
4. Store returned IDs/cursor/hasMore in `folderPages[folderId]`.

When the user clicks “Load more”:

1. Fetch the next page using the folder cursor.
2. Append note IDs to `folderPages[folderId].noteIds`.
3. Merge summaries into `noteSummariesById`.

### Selected Note Rendering In Tree

The selected note may not exist in the currently loaded folder page. The tree should still be coherent.

If `selectedNote` exists but its ID is not in `folderPages[selectedNote.folderId].noteIds`, render it in that folder as an injected selected row. Options:

- Show it at the top of the folder section with selected styling.
- Or insert it into the loaded list by updated date if enough summary metadata exists.

This avoids forcing folder page fetches just to show the selected note.

### Note Selection Flow

When a user clicks a note row:

1. Set `selectedNoteId`.
2. Persist it to `localStorage`.
3. Fetch `GET /notes/:id`.
4. Set `selectedNote`.
5. Use `selectedNote.noteMarkdown` for the editor.

If the user clicks a note whose detail is already loaded and fresh, reuse cached detail. Otherwise fetch.

### Editing And Autosave

Autosave writes to the selected note detail.

On successful save or optimistic save:

- Update `selectedNote`.
- Update the corresponding `noteSummariesById[id]` fields:
  - title
  - folderId
  - updatedAt
  - linked event identifiers/summary if changed

If folder changes:

- Remove note ID from old folder page if present.
- Add/inject note ID into new folder page if that folder is loaded or selected.

### Transcript Flow

Keep transcript lazy.

- Do not include transcript in note summaries.
- Do not include transcript in note detail unless the editor specifically needs it.
- Fetch transcript only when the transcript panel opens.
- Prefer caching by note ID:

```ts
transcriptByNoteId: Record<string, {
  segments: TranscriptSegment[]
  loaded: boolean
  loading: boolean
}>
```

This avoids refetching when users toggle the transcript panel.

### Sharing Flow

Keep note sharing lazy but selected-note scoped.

- Fetch `GET /notes/:id/shares` when the attendee/share dropdown opens, or when a visible sharing indicator needs exact state.
- Cache shares by note ID.
- On invite, optimistically add or update a `NoteShare` with `status: "pending"`.
- On accept invite, the backend changes that row to `status: "active"` and sets `user_id`.
- On revoke, remove the share from the selected note cache.
- Match attendees to shares by normalized lowercase email for badges such as "Invited" or "Has access".

## Migration Plan

### Phase 1: Backend Summary/Detail Split

1. Add backend response structs:
   - `NoteSummaryResponse`
   - `NoteDetailResponse`
   - `LinkedEventSummaryResponse`
   - `LinkedEventDetailResponse`
   - `CalendarAttendeeResponse`
2. Update list endpoints to return summaries without `note_markdown`.
3. Update `GET /notes/:id` to return detail with `note_markdown`.
4. Add linked event join to `GET /notes/:id`.
5. Decode `calendar_events.attendees` into `LinkedEventDetailResponse.attendees`.
6. Keep existing response fields temporarily if needed for compatibility, but migrate desktop client to new shape.

### Phase 2: Frontend Client Types

1. Add `NoteSummary`, `NoteDetail`, `LinkedEventSummary`, `LinkedEventDetail`, `CalendarAttendee`, and `NoteShare` types.
2. Update `notes-client.ts`:
   - `listNotesPage()` returns summaries.
   - `getNote()` returns detail.
3. Keep conversion functions separate:
   - `toNoteSummary`
   - `toNoteDetail`

### Phase 3: DashboardNotesContext Refactor

1. Replace `notes: NoteRecord[]` with:
   - `noteSummariesById`
   - `folderPages`
   - `selectedNote`
   - `noteSharesByNoteId`
2. Change startup to:
   - load folders
   - load unfiled/recent
   - restore selected note via `getNote(id)`
3. Change folder expansion to fetch that folder page on demand.
4. Change load-more to append to that folder page.

### Phase 4: NotesTree Refactor

1. Consume folder pages instead of one flat `notes` array.
2. Render folders from `folders`.
3. Render note rows from `folderPages[folderId].noteIds`.
4. Inject selected note row if needed.
5. Keep unfiled as its own page key.

### Phase 5: DashboardWorkspace Refactor

1. Use `selectedNote` detail for title, markdown, folder ID, linked event display.
2. Remove reliance on note list payload for markdown.
3. Remove reliance on event picker search state for linked event label.
4. Keep event picker search only for changing the linked event.
5. Use `selectedNote.linkedEvent.attendees` as the source for the later note-sharing attendee UI.
6. Use `noteSharesByNoteId[selectedNote.id]` as the source of actual share/invitation status.

### Phase 6: Verification

Test with:

- 0 folders, 0 notes.
- 100 folders, no notes.
- 100 folders, many notes in one folder.
- 100 folders, many notes across folders.
- Saved selected note not present in loaded folder pages.
- Saved selected note linked to a calendar event.
- Saved selected note linked to a calendar event with attendees.
- Saved selected note with pending invitations.
- Saved selected note with active shares.
- Linked calendar event missing from cache.
- Move note between folders.
- Delete selected note.
- Toggle transcript panel across multiple notes.

## Non-Goals

- Do not load transcript in note tree.
- Do not load full markdown in note tree.
- Do not fetch note pages for every folder on startup.
- Do not make calendar picker search responsible for selected note display.
