# Context Files Plan

## Entities & Relationships

**Folder**
- Has files (project context)
- Has notes (notes are optional—they do not have to be in a folder)
- No nesting

**Note**
- Always the central entity—represents a meeting or standalone document
- Optionally belongs to one folder
- Optionally linked to one calendar event
- Has files (meeting context)

**Event**
- Calendar data only—no files, no special treatment
- When a meeting is started from an event, it creates a note linked to that event
- That is the only thing events do
- The linkage between a note and an event is purely associative—no data or behavior is inherited from the event. It is a reference only (event title, time, attendees) displayed as a distinct section on the note, separate from note content
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

Always at most two owner-scoped sources, in order:
1. Files on the current user's note
2. Files on that note's folder

Notes, folders, and their context files are private to their owner. Every context lookup must preserve that ownership boundary.

---

## Meeting Start Flows

**Ad-hoc from home**
Pre-start modal (title, optional folder, optional file upload) → creates note → meeting starts.

**From a folder**
Same modal, folder pre-selected → creates note in folder → meeting starts.

**From a calendar event**
Clicking Start on the event card opens the same modal, event pre-linked → creates note linked to that event → meeting starts. File upload in this modal writes to the note, not the event.

**Pre-meeting context for an event (before clicking Start)**
Clicking "Prepare note" on an event card creates a draft note linked to that event and opens it. The user uploads files there. Later, clicking Start on the event resumes that draft note.

---

## Access Model

- Notes, folders, and context files are owner-only.
- Only the owner can view or modify a note or folder and its files.
- Only the owner can link, change, or unlink the calendar event associated with a note.
- The linked event section remains distinct, read-only meeting metadata inside the owner's note.
- Attendees extracted from a linked event identify meeting participants only. They do not receive access to the note, folder, transcript, recording, or files.
- Future sharing is outside this plan and must not be inferred from an attendee email or linked Orion user.

---

## Rules

- A note belongs to at most one folder
- A note links to at most one event
- An event links to at most one note per user (enforced—not just a convention)
- Files attach to folders or notes only—nowhere else
- Events have no files of their own
- The same pre-start modal is used for all meeting start flows
- Only the note owner can link, change, or unlink a calendar event on a note
- Attendees never grant or imply access
