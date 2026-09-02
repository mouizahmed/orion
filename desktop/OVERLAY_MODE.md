# Recording Overlay Rework

## Status

This is the working plan for rebuilding Orion's recording overlay and its relationship to the dashboard. The first delivery is UI-first and fixture-driven. Audio capture, transcription transport, recording persistence, recovery, and backend changes are intentionally deferred until the new interaction model and visual design are approved.

Phases 1 through 4 are implemented and visually iterated. The shared recording foundation, expanded/collapsed overlay, dashboard recording controls, and window-flow shell are now the official UI path. The shell remains fixture-driven for audio and transcription, but its cross-window note draft is now main-owned, encrypted on disk, and retained until the backend save is acknowledged. Real capture/transcription ownership and backend recording recovery still begin with the Phase 5 architecture design.

This document replaces the old concept of a freely switchable "overlay mode." Orion will no longer have two peer application modes. The dashboard is the application; the overlay is a temporary recording surface with a notepad by default and a toggleable live transcript.

## Product decisions

### One application, two recording surfaces

| State | Dashboard | Overlay | Recording behavior |
| --- | --- | --- | --- |
| Signed out | Closed | Closed | Unavailable |
| Signed in, idle | Open by default | Must not exist or be reachable | No active session |
| Recording, overlay visible | Hidden or in background | Visible and always on top | Continues |
| Recording, dashboard visible | Visible | Hidden, not ended | Continues uninterrupted |
| Recording stopped | Visible, preferably on the recorded note | Closed/hidden and no longer reachable | Finalizing, then complete |

The dashboard is always the default signed-in window and the only normal idle surface. There is no idle overlay, overlay-only home, manual overlay mode, meeting/insight mode picker, or generic dashboard-to-overlay toggle.

The overlay may be opened only as part of an active note recording. Returning to the dashboard changes window visibility only; it does not pause, stop, recreate, or reconnect the recording.

### Recommended location for persistent recording status

Use a compact recording status pill in the right side of `DashboardTopBar`, before the native window controls. This is preferable to a floating element over page content because it:

- remains visible on Home, Calendar, Notes, Chat, and Settings;
- does not cover the note editor or assistant panels;
- reads as application-level state rather than note content;
- gives the user one stable way to return to the active recording.

The pill should show animated recording bars, elapsed time, and the active note title when space allows. Clicking it returns to the overlay. A separate stop action should be available but visually guarded from accidental clicks.

When the active recording note is open, the note dock also reflects the live state. If another note or another dashboard page is open, only the global top-bar pill reflects it; that unrelated note's transcript control must not appear live. Clicking the global pill's note/title area may open the active note, while clicking its overlay action returns to the overlay.

## Target experience

### Start a recording

1. The user starts a recording from a note or an approved dashboard recording entry point.
2. Orion creates or identifies the destination note before the session becomes active.
3. The shared recording session enters `starting`.
4. The recording overlay opens only after a valid session exists.
5. The session enters `recording`; elapsed time and live transcript begin.
6. The dashboard may be hidden, but it remains the primary application surface and can be restored at any time.

The UI must not manufacture `local-meeting-*` note IDs. UI fixtures may use fixture IDs, but production recording requires a real note identity.

### Use the new overlay

The supplied compact transcript reference defines the information hierarchy, not its visual style. Orion uses the dashboard's existing neutral palette, `#171417` dark assistant-surface family, soft borders, rounded geometry, typography, light/dark support, and restrained motion. The overlay keeps only enough translucency to read as an overlay without allowing background windows to overpower its content.

The overlay is one compact transparent/glass surface with these regions:

1. **Session header**
   - elapsed time on the left;
   - live audio activity and stop controls in the center;
   - one collapse/expand affordance on the right;
   - the whole safe header region acts as the drag handle, excluding controls.
2. **Notepad/transcript switch**
   - `Notepad` is the default view;
   - quiet upper-right `Notepad` and `Transcript` buttons switch views without discarding the note draft or transcript position;
   - do not render a redundant content title or expanded-body recording status row.
3. **Notepad body**
   - a simple distraction-free writing area following the supplied layout hierarchy;
   - transparent styling inside the shared glass surface;
   - draft state survives collapsing and switching to Transcript;
   - the latest draft is mirrored through main-process IPC, durably recovered, and cleared only after the dashboard confirms the exact value was saved.
4. **Live transcript body**
   - chronological transcript rows in a single readable column;
   - stable speaker/source distinction using Orion's current restrained chips or alignment, without chat-bubble clutter;
   - automatic follow mode while the user is at the bottom;
   - preserve the user's scroll position when they scroll upward, with a `Jump to live` affordance;
   - an intentional empty state such as `Start speaking...` before the first segment.
5. **Optional collapsed state**
   - a slim glass recording capsule with activity, timer, stop, and expand;
   - still available only while a recording is active.

The expanded overlay should initially target roughly `380-440px` width and `420-520px` height, then be tuned by the user during visual review. It should remain resizable only if testing shows that a fixed transcript viewport is too restrictive. Transparency applies to the Electron window background; readable content sits on a translucent, blurred Orion surface rather than directly on the desktop.

### Return to the dashboard during recording

1. The user selects `Dashboard` from the overlay.
2. The overlay hides and the dashboard restores/focuses.
3. No end-recording confirmation is shown because navigation is non-destructive.
4. The top-bar recording pill immediately communicates that recording continues.
5. If the active recording note is open, its transcript dock is live and new segments roll in.
6. The user can return to the overlay from the top-bar recording pill without restarting any capture or transcript connection.

### Live note transcript and dock

The current note assistant dock already provides the right basic anchor. During an active recording for the open note, its left transcript control becomes a recording capsule matching the supplied reference:

- animated purple recording bars using Orion's accent color;
- transcript expand/collapse chevron;
- stop square as a distinct adjacent action;
- adequate spacing and hit targets so expanding the transcript cannot accidentally stop the session.

Opening it expands the existing transcript surface upward. During recording:

- committed segments stream into the open panel as they arrive;
- interim text may appear in a visually quieter final row and be replaced in place;
- the panel follows the latest segment only when already at the bottom;
- reconnecting, degraded transcription, and capture-without-transcript are distinct states;
- stopping transitions the panel to `finalizing`, then the normal saved transcript state without closing it.

The note editor remains usable throughout. Transcript updates must not reset editor drafts, assistant state, panel animation state, or scroll position.

### Stop a recording

Stop is a recording action, not a window-navigation action. It may be initiated from the overlay, the dashboard top-bar pill, or the active note's dock; all three dispatch the same session command.

1. Session enters `stopping`; controls disable to prevent duplicate stops.
2. Remaining transcript data flushes.
3. Session enters `finalizing` while the backend completes any post-processing.
4. The overlay closes/hides immediately after capture is safely stopped.
5. The dashboard becomes visible and opens the recorded note.
6. The note transcript remains available while finalization completes.
7. Session becomes `complete` or surfaces a recoverable `error` state.

Do not use a confirmation dialog for every stop click if the stop control is already isolated and clearly labeled. Use disabled in-progress feedback plus a short undo only if the future engine can safely support it. Closing Orion while recording remains a separate confirmation/recovery decision for the engine phase.

### Resume recording from a saved note

Resume does not revive a paused capture session. After Stop completes, the transcript panel for that note offers `Resume recording`. Selecting it starts a new recording session associated with the same `noteId`, opens the overlay, and appends subsequent transcript segments to that note. The new capture receives a new session ID and elapsed timer, while the note and its previously saved transcript remain continuous.

## Shared recording UI contract

UI work should depend on a single renderer-agnostic snapshot rather than local booleans in `OverlayApp` or `NoteAssistantDock`.

```ts
type RecordingPhase =
  | 'starting'
  | 'recording'
  | 'stopping'
  | 'finalizing'
  | 'complete'
  | 'error'

type TranscriptPhase =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'unavailable'
  | 'finalizing'
  | 'complete'

type RecordingSessionSnapshot = {
  sessionId: string
  noteId: string
  noteTitle: string
  phase: RecordingPhase
  transcriptPhase: TranscriptPhase
  startedAt: number
  stoppedAt: number | null
  micMuted: boolean
  systemAudioMuted: boolean
  recoverableError: string | null
}
```

The UI layer consumes:

- `getSnapshot()` for initial render in either window;
- a session subscription for phase/control changes;
- `stop()` and source mute commands;
- `startForNote(noteId)` for a new recording session on an existing note;
- `showOverlay()` and `showDashboard()` as visibility commands only;
- live transcript deltas keyed by both `sessionId` and `noteId` (not repeated full transcript snapshots);
- committed transcript query data for reload and final state.

For the UI-only milestone, provide a deterministic fixture adapter implementing this interface. It should simulate elapsed time, transcript arrival, interim replacement, stop/finalization, starting another session for the same note, reconnecting, and error states without using microphone permission, audio capture, WebSockets, recording endpoints, or production persistence.

## Window lifecycle target

The later integration must move recording ownership outside the overlay renderer. Hiding a window currently preserves its renderer most of the time, but it is not a sufficient ownership boundary: a renderer crash, reload, sign-out transition, or window destruction can currently tear down `useTranscription` and its audio handles.

Target responsibilities:

| Layer | Responsibility |
| --- | --- |
| Electron main/session host | Authoritative active-session state, window policy, capture/transcription process lifetime or supervision, command serialization, renderer broadcasts, recovery |
| Dashboard renderer | Display global status, active-note dock state, and live/saved transcript; issue commands |
| Overlay renderer | Display the compact recording UI and live transcript; issue commands |
| Backend | Authoritative recording record, transcript durability, finalization, ownership checks, reconnect/recovery support |

Exact audio-process placement is deliberately undecided until the audio redesign. The invariant is that neither window's visibility nor React component lifetime may own the recording lifetime.

The Phase 4 shell already enforces the boundary where it can: main owns the canonical cross-window snapshot, rejects renderer-published null sessions and backwards transitions, serializes start/stop commands, and retains the note draft independently of either renderer. The fixture renderer still advances simulated `recording -> finalizing -> complete` phases; moving real capture and phase authorship fully into the session host remains Phase 5/6 work.

### Draft durability and handoff

- Main holds the canonical versioned draft and encrypts the per-account recovery copy with Electron `safeStorage` (the packaged app already requires secure OS storage for authentication).
- A recovered draft is account-scoped; it is never exposed to a different signed-in account.
- Overlay and dashboard edits update the same channel. Sender echoes are excluded, while MDXEditor's built-in muted external update path prevents normalization feedback.
- A completed or interrupted session keeps its draft until the selected note is hydrated and the existing revision-aware note mutation saves that exact value.
- The dashboard then acknowledges `{ sessionId, noteId, value }`; main clears the in-memory and encrypted copies only if they still match. A newer edit therefore cannot be cleared by a stale save response.
- Switching surfaces relies on ordered IPC from the outgoing renderer: its editor change is published before the visibility command, and the incoming renderer hydrates from main's latest version.

### Required window policy changes during integration

- Signed-in startup creates/shows the dashboard only.
- `app.activate`, tray click, protocol callbacks, and normal app reopening restore the dashboard when idle.
- Remove idle `Show Overlay` tray behavior; use `Show Recording Overlay` only when a session is active, otherwise omit/disable it.
- Remove `Back to overlay` from the dashboard when idle.
- During recording, dashboard and overlay commands only swap visibility and focus.
- Hiding or closing the dashboard must not reveal an idle overlay.
- The overlay cannot create a recording by itself unless it was opened by a valid start-recording command.
- Authentication loss stops or safely suspends capture according to the later recovery policy; it must never leave an invisible orphan recording.
- Global keyboard shortcuts are removed so native editing shortcuts remain available without conflicts.

## UI component plan

### New or substantially rewritten

- `RecordingOverlay`: the complete transparent recording surface with default notepad and toggleable transcript.
- `RecordingOverlayHeader`: timer, activity, stop, collapse, and drag region.
- `RecordingOverlayNotepad`: the default distraction-free recording note surface.
- `LiveTranscriptViewport`: shared follow-mode behavior for live transcript rendering.
- `RecordingStatusPill`: dashboard-wide recording status and overlay return entry.
- `NoteAssistantDockControls`: the widened recording version of the note transcript button.
- `RecordingUiProvider`: fixture-backed overlay snapshot/commands for the UI milestone, bridged to the dashboard through Electron IPC and later replaced by the real engine adapter.

### Reuse where useful

- `RecordingBars` for Orion's activity language, with configurable active/error color.
- `NoteAssistantSurface` for dock geometry and animation.
- transcript typography/data concepts from `SavedTranscriptView`, after extracting reusable rows rather than coupling live UI to a saved-query component.
- dashboard and overlay light/dark tokens from `index.css` and existing component primitives.

### Remove after replacement

- idle `CompactOverlayBar` behavior and the current multi-tool recording toolbar;
- the old `CompactMeetingPanel` notepad implementation;
- overlay `Insights` and `Ask` placeholders;
- overlay panel switching state and all related global shortcuts;
- the confirmation that opening the dashboard ends a meeting;
- `TEMP_BYPASS_MEETING_BACKEND` and production paths using `local-meeting-*` IDs;
- legacy overlay components that have no remaining importers.

Removal happens only after the replacement surfaces are accepted and their imports are migrated.

## UI states to design explicitly

### Overlay

- starting;
- listening with no transcript yet;
- live transcript with mic and system speakers;
- reconnecting transcription while capture continues;
- transcript unavailable while capture continues;
- stopping/finalizing;
- recoverable error;
- expanded and collapsed.

### Dashboard

- recording pill at wide and compact window widths;
- active recording note open, transcript closed;
- active recording note open, transcript expanded and rolling;
- a different note open;
- non-note pages open;
- reconnecting, stopping, and finalizing;
- transcript panel with no committed segments, many segments, and user scrolled away from live.

## Delivery phases

### Phase 1: UI contract and fixture harness

- Add the recording/transcript state types and controlled fixture adapter.
- Add deterministic fixture segment streams and command transitions.
- Keep fixture data isolated behind the recording UI controller boundary so it can be replaced by the real recording engine without changing the overlay components.
- Keep legal transitions, elapsed-time calculation, and note/session matching explicit in pure modules so static review remains straightforward.

No audio, recording API, WebSocket, database, or Electron lifecycle changes in this phase.

### Phase 2: Overlay UI from scratch

- Build the new expanded and collapsed transparent overlay with Notepad as its default view and Transcript as a toggle.
- Implement header controls, drag-safe regions, statuses, transcript follow mode, and `Jump to live`.
- Use the fixture provider for every state.
- The legacy overlay was initially retained for review, then removed early by product decision.

User performs visual inspection and gives feedback at the end of this phase.

The new recording overlay is now the official overlay renderer. No preview environment variables or alternate startup route are required.

### Phase 3: Dashboard recording UI

- Add `RecordingStatusPill` to the dashboard top bar.
- Adapt the note transcript dock to the recording capsule only when `activeSession.noteId === selectedNote.id`.
- Stream fixture transcript rows into the expanded dock.
- Preserve note editor, chat, transcript scroll, and animation state across updates.
- Cover narrow dashboard widths and non-note pages.

User performs visual inspection and gives feedback at the end of this phase.

### Phase 4: Window-flow shell

- Make dashboard the default signed-in/idle window.
- Restrict fixture overlay creation and reveal to an active fixture session.
- Wire overlay-to-dashboard and dashboard-to-overlay visibility transitions without ending the fixture session.
- Update tray behavior and dashboard recording affordance; global overlay shortcuts have been removed.
- Keep real audio/transcription disabled in the new shell.

This phase validates navigation semantics without relying on a real recording engine. Start, stop, and overlay-return commands use acknowledged IPC, wait for overlay renderer readiness, and reject invalid or backwards fixture snapshots.

Session events and transcript segment deltas use separate IPC channels, avoiding repeated full-history payloads and unrelated top-bar re-renders. The signed-out auth renderer has its own root and cannot invoke recording channels or content-size the auth window. `dashboard:select-note` is buffered in preload so a reused but loading dashboard cannot miss the finalization handoff.

### Phase 5: Audio and recording architecture design

Before implementation, audit and separately plan:

- microphone and system-audio capture on Windows and macOS;
- process ownership and supervision;
- permission acquisition and loss;
- WebSocket lifecycle, reconnect, backpressure, and duplicate prevention;
- stop/finalization semantics and starting a subsequent session for an existing note;
- incremental transcript durability and live fan-out to both renderers;
- active-session discovery, crash recovery, and stale-session cleanup;
- finalization, summary jobs, recording-file storage, quotas, and error recovery;
- backend endpoint and schema changes.

This phase produces a second implementation plan. It does not inherit current Deepgram/backend choices automatically.

### Phase 6: Engine integration and legacy removal

- Replace the fixture adapter with the authoritative session IPC/event adapter.
- Connect live transcript fan-out and committed transcript reconciliation.
- Exercise real stop, resume-recording-as-new-session, and source controls.
- Legacy overlay UI, overlay-owned recording state, obsolete IPC, shortcuts, tray actions, and dead components were removed early after Phase 2.
- Retain the fixture adapter for deterministic component development.

## Acceptance criteria

### UI-first milestone (Phases 1-4)

- Dashboard is the only idle/default signed-in surface.
- Overlay cannot be opened when the fixture session is idle.
- Starting a fixture recording opens the new overlay.
- Overlay matches the supplied layout hierarchy while visibly belonging to Orion.
- Switching to the dashboard and back preserves timer, transcript contents, and scroll behavior.
- Dashboard top bar always shows active recording state, regardless of dashboard page.
- Only the active recording note receives the live transcript dock treatment.
- Transcript rows roll into both visible surfaces without resetting unrelated UI.
- Stop from any surface produces one `stopping -> finalizing -> complete` transition.
- Stopping removes overlay access and returns to the recorded note in the dashboard.
- Light/dark, reduced motion, keyboard focus, accessible labels, and narrow-window states are covered.
- TypeScript, strict ESLint, and production renderer/main/preload builds pass.

### Integrated milestone (Phase 6)

- Real recording continues uninterrupted while switching windows repeatedly.
- Overlay renderer reload/destruction does not stop or duplicate the session.
- Dashboard reload restores the active session snapshot and transcript.
- Exactly one active session and one stop/finalize operation are enforced.
- Transcript segments are ordered, deduplicated, durable, and reconciled after reconnect.
- Pausing and source muting have documented, consistent semantics.
- Sign-out, quit, crash, permission loss, network loss, quota exhaustion, and backend failure do not leave orphan capture.
- Saved transcript and recording state remain correct after app restart.

## Verification approach

Code-level verification runs desktop TypeScript, strict ESLint, renderer/main/preload production bundles, Go build/vet for touched backend code, and diff/static inspection. Per project guidance, Codex does not add, modify, or run automated tests, and will not use browser automation, screenshots, computer-use, or local visual inspection unless explicitly requested. The user visually reviews the overlay and dashboard flows.

## Decisions to confirm before implementation

The plan recommends these defaults:

1. Put the persistent recording indicator in `DashboardTopBar`, not over page content.
2. Let clicking the indicator return to the overlay; provide a secondary path to open the active note.
3. Keep stop visually separate from transcript expand/collapse and dashboard navigation.
4. Make Notepad the overlay default and keep live Transcript available as a reversible toggle.
5. Support a collapsed recording capsule as part of the UI rebuild.
6. Show the dashboard immediately after stop while transcript/summary finalization continues.

These choices can be adjusted during the UI fixture reviews without committing to an audio or backend architecture.
