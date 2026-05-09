# Note Attendees & Sharing — Phased Plan

## Context

Notes can be linked to calendar events whose attendees are stored in `calendar_events.attendees`. The owner can share a note with anyone by email (not limited to existing users). Sharing uses Resend for email delivery and a magic-link accept flow. Three roles: **owner**, **editor**, **viewer**. Attendees surfaced from a linked event start with no access and must be explicitly invited.

This plan is broken into self-contained phases. Each phase compiles, ships, and can be tested independently before the next phase begins.

---

## Phase 1 — Database Schema

*Deliverable: migration applied, nothing else changes yet.*

Via Supabase MCP:

```sql
CREATE TABLE note_shares (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id      UUID        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  email        TEXT        NOT NULL,                          -- always set; canonical invite address
  user_id      UUID        REFERENCES users(id) ON DELETE SET NULL, -- null until invite accepted
  shared_by    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT        NOT NULL DEFAULT 'viewer'
                           CHECK (role IN ('viewer', 'editor', 'owner')),
  status       TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'active')),
  invite_token UUID        UNIQUE DEFAULT gen_random_uuid(), -- magic link token; cleared on accept
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (note_id, email)
);
CREATE INDEX ON note_shares(note_id);
CREATE INDEX ON note_shares(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX ON note_shares(invite_token) WHERE invite_token IS NOT NULL;
```

Design notes:
- `email` is the stable key for an invite (independent of whether the person has an account yet)
- `user_id` is null while pending, set when the person accepts
- `invite_token` is cleared after acceptance (set to NULL)
- `UNIQUE (note_id, email)` prevents duplicate invites to the same address
- `owner` role reserved for the original note creator (stored here for a consistent permission check, or enforced at the app layer — decide during Phase 2)

---

## Phase 2 — Backend: Model + Repository

*Deliverable: Go model, repository, and updated `GetNoteByID`. No HTTP routes yet.*

### Model

**`backend/internal/models/note.go`** — add:

```go
type NoteShare struct {
    ID          string    `json:"id"`
    NoteID      string    `json:"note_id"`
    Email       string    `json:"email"`
    UserID      *string   `json:"user_id,omitempty"`
    SharedBy    string    `json:"shared_by"`
    Role        string    `json:"role"`
    Status      string    `json:"status"`
    CreatedAt   time.Time `json:"created_at"`
    UpdatedAt   time.Time `json:"updated_at"`
    // Joined from users table when user_id is set
    UserName      string  `json:"user_name,omitempty"`
    UserAvatarURL *string `json:"user_avatar_url,omitempty"`
}
```

### Repository

New file: **`backend/internal/repository/note_share.go`**

```go
type NoteShareRepository struct { db *database.DB }
func NewNoteShareRepository(db *database.DB) *NoteShareRepository
```

**`ListShares(ctx context.Context, noteID string) ([]*models.NoteShare, error)`**
```sql
SELECT ns.id, ns.note_id, ns.email, ns.user_id, ns.shared_by, ns.role, ns.status,
       ns.created_at, ns.updated_at,
       u.name, u.avatar_url
FROM note_shares ns
LEFT JOIN users u ON u.id = ns.user_id AND u.deleted_at IS NULL
WHERE ns.note_id = $1
ORDER BY ns.created_at ASC
```

**`AddShare(ctx context.Context, noteID, email, sharedByUserID, role string) (*models.NoteShare, error)`**
```sql
INSERT INTO note_shares (note_id, email, shared_by, role, status)
VALUES ($1, $2, $3, $4, 'pending')
ON CONFLICT (note_id, email) DO UPDATE SET role = EXCLUDED.role, updated_at = now()
RETURNING id, note_id, email, user_id, shared_by, role, status, invite_token, created_at, updated_at
```

**`RemoveShare(ctx context.Context, noteID, email string) (bool, error)`**
```sql
DELETE FROM note_shares WHERE note_id = $1 AND email = $2
```
Return `RowsAffected() > 0`.

**`AcceptInvite(ctx context.Context, token, userID, email string) (*models.NoteShare, error)`**
```sql
UPDATE note_shares
SET user_id = $2, status = 'active', invite_token = NULL, updated_at = now()
WHERE invite_token = $1 AND email = $3 AND status = 'pending'
RETURNING id, note_id, email, user_id, shared_by, role, status, created_at, updated_at
```
Returns nil if token not found/already used.

**`GetByToken(ctx context.Context, token string) (*models.NoteShare, error)`**
```sql
SELECT ns.*, n.title AS note_title, u.name AS shared_by_name
FROM note_shares ns
JOIN notes n ON n.id = ns.note_id AND n.deleted_at IS NULL
JOIN users u ON u.id = ns.shared_by
WHERE ns.invite_token = $1 AND ns.status = 'pending'
```
Used to show the invite preview page before the user accepts.

### Update `GetNoteByID` for shared access

**`backend/internal/repository/note.go`**:

```sql
WHERE n.id = $1
  AND n.deleted_at IS NULL
  AND (
    n.user_id = $2
    OR EXISTS (
      SELECT 1 FROM note_shares
      WHERE note_id = n.id AND user_id = $2 AND status = 'active'
    )
  )
```

`UpdateNote` and `DeleteNote` keep `user_id = $2` — mutation is owner-only for now (editor write support added later when needed).

---

## Phase 3 — Backend: Share/Invite API + Resend

*Deliverable: REST endpoints for managing shares and sending invite emails.*

### Email service

New file: **`backend/internal/email/resend.go`**

```go
type EmailService struct { apiKey string }
func NewEmailService(apiKey string) *EmailService
func (e *EmailService) SendNoteInvite(ctx, toEmail, toName, fromName, noteTitle, acceptURL string) error
```

Uses Resend's REST API (`POST https://api.resend.com/emails`). `RESEND_API_KEY` from environment. `acceptURL` = deep-link into the Orion desktop app: `orion://accept-invite?token=<invite_token>`. Email also includes a fallback plain-text token for manual entry.

### Handler

New file: **`backend/internal/handlers/note_shares.go`**

```go
type NoteSharesHandler struct {
    noteRepo  *repository.NoteRepository
    shareRepo *repository.NoteShareRepository
    email     *email.EmailService
}
```

**`ListNoteShares`** — `GET /notes/:noteID/shares`
1. Verify caller owns the note (or is an editor — check `note_shares`) → 404 if absent
2. `shareRepo.ListShares(noteID)` → `{"shares": [...]}`

**`AddNoteShare`** — `POST /notes/:noteID/shares`  body: `{"email":"...","role":"viewer"|"editor"}`
1. Verify caller is owner
2. Trim + lowercase email; guard against inviting self
3. `shareRepo.AddShare(noteID, email, callerID, role)` → returns share with `invite_token`
4. `email.SendNoteInvite(...)` — fire and forget (log on error, don't fail the request)
5. Return `201 {"share": {...}}` — include `status: "pending"` so UI shows the right state

**`RemoveNoteShare`** — `DELETE /notes/:noteID/shares/:shareEmail` (URL-encoded email)
1. Verify caller is owner
2. `shareRepo.RemoveShare(noteID, email)` → 404 if not found
3. Return `200 {"status": "ok"}`

**`UpdateNoteShare`** — `PATCH /notes/:noteID/shares/:shareEmail`  body: `{"role":"viewer"|"editor"}`
1. Verify caller is owner
2. `UPDATE note_shares SET role = $3 WHERE note_id = $1 AND email = $2`
3. Return `200 {"share": {...}}`

**`AcceptInvite`** — `POST /notes/accept-invite`  body: `{"token": "..."}`
1. `shareRepo.GetByToken(token)` → 404 if expired/used
2. Get current authenticated user's email from auth context
3. `shareRepo.AcceptInvite(token, userID, email)` → sets `user_id`, clears token
4. Return `200 {"note_id": "...", "role": "..."}` — frontend redirects to the note

**`GetInvitePreview`** — `GET /notes/invite-preview?token=...`  (unauthenticated)
Returns note title + sharer name so the accept page can show "Alice shared 'Meeting notes' with you".

**`GetNotesByAttendee`** — `GET /notes/by-attendee?email=...`  (authenticated)
Returns up to 10 notes where the given email appears in `note_shares` (any status) and the caller is the owner or an active sharer of those notes. Used by the `AttendeeHoverCard` "Recent notes" section.

```sql
SELECT n.id, n.title, n.created_at, n.updated_at
FROM notes n
JOIN note_shares ns ON ns.note_id = n.id
WHERE ns.email = $1
  AND n.deleted_at IS NULL
  AND (
    n.user_id = $2
    OR EXISTS (SELECT 1 FROM note_shares WHERE note_id = n.id AND user_id = $2 AND status = 'active')
  )
ORDER BY n.updated_at DESC
LIMIT 10
```

Returns `{"notes": [{"id":"...","title":"...","updated_at":"..."}]}`.

### Routes in `cmd/api/main.go`

```go
noteShareRepo     := repository.NewNoteShareRepository(db)
emailSvc          := email.NewEmailService(os.Getenv("RESEND_API_KEY"))
noteSharesHandler := handlers.NewNoteSharesHandler(noteRepo, noteShareRepo, emailSvc)

// Authenticated
authenticated.GET("/notes/:noteID/shares",            noteSharesHandler.ListNoteShares)
authenticated.POST("/notes/:noteID/shares",           noteSharesHandler.AddNoteShare)
authenticated.DELETE("/notes/:noteID/shares/:email",  noteSharesHandler.RemoveNoteShare)
authenticated.PATCH("/notes/:noteID/shares/:email",   noteSharesHandler.UpdateNoteShare)
authenticated.POST("/notes/accept-invite",            noteSharesHandler.AcceptInvite)
authenticated.GET("/notes/by-attendee",               noteSharesHandler.GetNotesByAttendee)
// Public
api.GET("/notes/invite-preview",                      noteSharesHandler.GetInvitePreview)
```

---

## Phase 4 — Calendar: Attendees in Search + Lookup Endpoint

*Deliverable: search response includes attendees; single-event lookup added.*

### Add attendees to search response

**`backend/internal/handlers/calendar.go`** — `SearchEvents` handler loop (lines 376–394): add the unmarshal already present in the upcoming-events loop (lines 275–277):

```go
var attendees []CalendarAttendee
if len(event.AttendeesJSON) > 0 {
    _ = json.Unmarshal(event.AttendeesJSON, &attendees)
}
// set Attendees: attendees on the CalendarEvent struct
```

`CalendarEvent` struct already has `Attendees []CalendarAttendee json:"attendees,omitempty"` — no struct change needed.

### Single-event lookup

**`backend/internal/repository/calendar_cache.go`** — add to interface + impl:

```go
GetCalendarEventByID(ctx context.Context, userID, connectionID, calendarID, providerEventID string) (*models.CachedCalendarEvent, error)
```

SQL: same SELECT shape as `ListUpcomingEvents`, filtered by all four keys, `LIMIT 1`.

**`backend/internal/handlers/calendar.go`** — add:

```go
// GET /calendar/events/lookup?connectionId=&calendarId=&providerEventId=
func (h *CalendarHandler) GetCalendarEvent(c *gin.Context)
```

Returns full `CalendarEvent` including attendees. 404 if not cached.

Route in `cmd/api/main.go`:
```go
authenticated.GET("/calendar/events/lookup", calendarHandler.GetCalendarEvent)
```

---

## Phase 5 — Frontend Foundation

*Deliverable: types, API client, hook — no visible UI yet.*

### Types

**`desktop/src/types/note.ts`** — add:

```ts
export type NoteShare = {
  id: string
  noteId: string
  email: string
  userId?: string
  sharedBy: string
  role: 'viewer' | 'editor' | 'owner'
  status: 'pending' | 'active'
  createdAt: string
  updatedAt: string
  userName?: string
  userAvatarUrl?: string
}
```

### API client

**`desktop/src/lib/notes-client.ts`** — add:

```ts
listNoteShares(noteId: string): Promise<NoteShare[]>
addNoteShare(noteId: string, email: string, role: 'viewer' | 'editor'): Promise<NoteShare>
removeNoteShare(noteId: string, email: string): Promise<void>
updateNoteShare(noteId: string, email: string, role: 'viewer' | 'editor'): Promise<NoteShare>
```

New file **`desktop/src/lib/calendar-client.ts`**:

```ts
getCalendarEventById(connectionId, calendarId, providerEventId): Promise<CalendarEvent | null>
// GET /calendar/events/lookup — returns null on 404
```

### Hook

New file: **`desktop/src/hooks/useNoteShares.ts`**

```ts
function useNoteShares(noteId: string | null): {
  shares: NoteShare[]
  loading: boolean
  invite: (email: string, role: 'viewer' | 'editor') => Promise<NoteShare>
  revoke: (email: string) => Promise<void>
  updateRole: (email: string, role: 'viewer' | 'editor') => Promise<void>
}
```

Optimistic local state: add/remove immediately, roll back on error. Refetches on `noteId` change.

---

## Phase 6 — Frontend: `NoteAttendeesButton` Component

*Deliverable: attendees pill in note header with hover-card invite UI.*

New file: **`desktop/src/components/NoteAttendeesButton.tsx`**

```ts
type Props = {
  noteId: string
  connectionId: string
  calendarId: string
  providerEventId: string
  currentUserEmail: string
}
```

**Behavior:**
1. On mount: `getCalendarEventById(connectionId, calendarId, providerEventId)` to get attendees (not reliant on search results — works for old events too)
2. `useNoteShares(noteId)` for live share state
3. Pill trigger button: `<Users2 /> N attendees` (or `1 attendee`)
4. Dropdown: same `useRef` + `mousedown` outside-click pattern as folder/meeting pickers in `DashboardWorkspace.tsx` (lines 373, 411)
5. Inside dropdown:
   - Text input `"Add attendees..."` — filters the visible attendee list by name/email; also accepts arbitrary email typed in full. **Typing an email not in the event's attendee list adds a display-only row for that email — it does NOT share the note.**
   - Attendees grouped by email domain (via `useMemo`)
   - Current user row: `"(you) · Owner"` — no hover card, no action
   - Each other attendee row shows: avatar initial + name + email + share-status indicator
     - If `status === 'pending'`: "Invited" badge
     - If `status === 'active'`: "Has access" badge + role label
     - If no share record: no badge (just the row)
   - **Hovering any non-self row opens an `AttendeeHoverCard`** (see below)

### `AttendeeHoverCard` sub-component

Shown on row hover, positioned to the right of the dropdown. Contains:

- **Header**: large avatar initial, display name, email address
- **Action buttons row**: "Share notes" button + LinkedIn icon button + contact icon button
  - "Share notes" → calls `invite(email, 'viewer')` → transitions row to pending state; button changes to "Invited" (disabled). If already shared, shows "Revoke" instead.
- **Recent notes section**: `"Recent notes"` label + `"View all >"` link
  - Fetches `GET /notes/by-attendee?email=<email>` (see Phase 3 addition) on card open
  - Shows up to 3 notes: note icon + title + date (e.g. "May 6 9:00 PM")
  - Loading skeleton while fetching; empty state if none

Card dismisses when mouse leaves both the row and the card (combined hover area), or when the main dropdown closes.

### Wire into `DashboardWorkspace.tsx`

1. Add `attendees: CalendarAttendee[]` to `MeetingOption` type (line 20)
2. Update `setMeetingResults` mapper (line 161): `attendees: e.attendees ?? []`
3. Add component to header after meeting picker div:

```tsx
{selected?.providerEventId && selected.connectionId && (
  <div style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
    <NoteAttendeesButton
      noteId={selected.id}
      connectionId={selected.connectionId}
      calendarId={selected.calendarId ?? ''}
      providerEventId={selected.providerEventId}
      currentUserEmail={auth.currentUser?.email ?? ''}
    />
  </div>
)}
```

---

## Phase 7 — Accept Invite Flow

*Deliverable: recipient can open the invite link in the desktop app and gain access.*

Since there is no web sign-up — auth only exists in the desktop app — the invite email links directly into the app via a deep-link:

**Email CTA**: `orion://accept-invite?token=<uuid>`

**Desktop app flow:**
1. App registers the `orion://` protocol handler (if not already done for other deep-links)
2. On `orion://accept-invite?token=<uuid>`:
   - If not logged in: show sign-in screen, then re-process the deep-link after auth
   - If logged in: call `POST /api/notes/accept-invite` with `{token}` — backend validates token and that the authenticated user's email matches the invite email
   - On success: navigate to the note
   - On mismatch (logged in as wrong account): show error "This invite was sent to a different email address"

**For non-users** (no Orion account):
- Email says: "To view this note, download Orion and sign in with this email address"
- No web fallback — they must create an account in the app first
- Token stays valid (pending) until they do

**`GetInvitePreview`** remains useful — called by the app before showing the accept confirmation screen to display "Alice shared 'Meeting notes' with you" without requiring the full note load.

---

## Files Summary

| Phase | File | Change |
|-------|------|--------|
| 1 | Supabase DB | Create `note_shares` table |
| 2 | `models/note.go` | Add `NoteShare` struct |
| 2 | `repository/note_share.go` | **New** — 5 methods |
| 2 | `repository/note.go` | Broaden `GetNoteByID` WHERE |
| 3 | `email/resend.go` | **New** — `SendNoteInvite` |
| 3 | `handlers/note_shares.go` | **New** — 7 handler methods (incl. `GetNotesByAttendee`) |
| 3 | `cmd/api/main.go` | Instantiate + wire 7 routes |
| 4 | `repository/calendar_cache.go` | Add `GetCalendarEventByID` |
| 4 | `handlers/calendar.go` | Attendees in `SearchEvents`; add `GetCalendarEvent` handler |
| 4 | `cmd/api/main.go` | Add lookup route |
| 5 | `types/note.ts` | Add `NoteShare` type |
| 5 | `lib/notes-client.ts` | 4 share API functions |
| 5 | `lib/calendar-client.ts` | **New** — `getCalendarEventById` |
| 5 | `hooks/useNoteShares.ts` | **New** |
| 6 | `components/NoteAttendeesButton.tsx` | **New** (incl. `AttendeeHoverCard` sub-component) |
| 6 | `components/DashboardWorkspace.tsx` | Add `attendees` to `MeetingOption`; wire button |
| 7 | Accept invite page | **New** frontend route + page |

---

## Verification (per phase)

**Phase 1:** `note_shares` table exists with all constraints in Supabase.

**Phase 2:** `go build ./...` passes. `GetNoteByID`: owner can read; active shared user can read; pending share user cannot read; non-member cannot read.

**Phase 3:** `POST /notes/:id/shares` with valid email → 201 + Resend email sent (check Resend dashboard). Duplicate invite → 200 (upsert). `DELETE` → 200. `PATCH` role → 200. `GET /notes/invite-preview?token=...` returns note title.

**Phase 4:** `GET /calendar/events/lookup?...` returns event with `attendees` array. `GET /calendar/events/search?q=...` results include `attendees` field.

**Phase 5:** `listNoteShares`, `addNoteShare`, `removeNoteShare` functions work against the running API. `useNoteShares` hook updates local state optimistically.

**Phase 6:** Link a note to an event with attendees → pill appears. Click pill → dropdown shows attendees. Click "Invite" → row changes to "Invited" badge. Refresh → share persists. Click "Revoke" → row returns to "Invite".

**Phase 7:** Open invite link → see note title + sharer name. Sign in if needed → accept → land on note with read access. Try to edit note as viewer → request fails with 403.
