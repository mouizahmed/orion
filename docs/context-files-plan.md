# Context Files Plan

## Entities & Relationships

**Folder**
- Has files (project context)
- Has notes (notes are optional — they don't have to be in a folder)
- No nesting

**Note**
- Always the central entity — represents a meeting or standalone document
- Optionally belongs to one folder
- Optionally linked to one calendar event
- Has files (meeting context)

**Event**
- Calendar data only — no files, no special treatment
- When a meeting is started from an event, it creates a note linked to that event
- That is the only thing events do
- The linkage between a note and an event is purely associative — no data or behavior is inherited from the event. It is a reference only (event title, time, attendees) displayed as a distinct section on the note, separate from note content
- Folders have no direct relationship with events. A note created from an event may still belong to a folder.

---

## File Buckets

Exactly two, nothing else.

| Bucket | Attached to | Purpose |
|---|---|---|
| Folder files | Folder | Project/ongoing context |
| Note files | Note | Meeting-specific context |

Events never have files.

---

## AI Context at Inference Time

Always at most two sources, in order:
1. Files on the current note (if the current user has access to the note)
2. Files on the note's folder (only if the current user has access to the folder)

Sharing a note does not grant access to its folder's context files. Folder context is only included if the folder itself is shared with the user. This prevents a shared note inside a private folder from leaking project context.

---

## Meeting Start Flows

**Ad-hoc from home**
Pre-start modal (title, optional folder, optional file upload) → creates note → meeting starts.

**From a folder**
Same modal, folder pre-selected → creates note in that folder → meeting starts.

**From a calendar event**
Clicking Start on the event card opens the same modal, event pre-linked → creates note linked to that event → meeting starts. File upload in this modal writes to the note, not the event.

**Pre-meeting context for an event (before clicking Start)**
Clicking "Prepare note" on an event card creates a draft note linked to that event and opens it. User uploads files there. Later when they click Start on the event, it resumes that draft note.

---

## Sharing

**What can be shared**
- Both notes and folders can be shared with collaborators
- Every collaborator is assigned a permission level: editor or viewer

**Permission levels**

| Action | Owner | Editor | Viewer |
|---|---|---|---|
| View content and files | ✓ | ✓ | ✓ |
| Edit note content | ✓ | ✓ | ✗ |
| Upload files | ✓ | ✓ | ✗ |
| Delete files | ✓ | ✓ | ✗ |
| Add / remove collaborators | ✓ | ✗ | ✗ |
| Change permission levels | ✓ | ✗ | ✗ |
| Link / change / unlink event | ✓ | ✗ | ✗ |
| Delete note or folder | ✓ | ✗ | ✗ |

**Folder sharing**
- Sharing a folder shares all notes within it automatically at the same permission level
- Collaborators access folder context files according to their permission level

**Note sharing**
- Sharing a note does not share its folder — collaborators only get access to folder context files if the folder itself is also shared with them

**Event linkage and sharing**
- The event section (title, time, attendees) is visible to both the owner and collaborators as a distinct read-only section on the note
- Calendar-specific details (provider, account, calendar ID, sync state, RSVP) are private to the owner and never shown to collaborators
- Only the owner can link, change, or unlink the event — collaborators have no controls on the event section
- Attendees extracted from the linked event are shown in a dropdown beside the event section, serving two purposes: displaying who is in the meeting and providing one-click invite suggestions for sharing the note
- The dropdown clearly distinguishes between "in this meeting" (from the event) and "has access to this note" (explicitly shared) — attendees are shown as suggestions with an explicit invite action, not implied collaborators
- Sharing is always a manual action — attendees are never auto-shared
- If an attendee does not have an account, they can be invited via email

---

## Rules

- A note belongs to at most one folder
- A note links to at most one event
- An event links to at most one note per user (enforced — not just a convention)
- Files attach to folders or notes only — nowhere else
- Events have no files of their own
- The same pre-start modal is used for all meeting start flows
- Only the note owner can link, change, or unlink a calendar event on a note
