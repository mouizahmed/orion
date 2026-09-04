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
   - stable microphone/system source distinction using Orion's current restrained chips or alignment, without chat-bubble clutter;
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
- live transcript with microphone and system sources;
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

> Phase 5 output: [`docs/rust-audio-engine-final-plan.md`](../docs/rust-audio-engine-final-plan.md) (supersedes `docs/rust-audio-engine-plan.md` as the execution plan). Incremental implementation status is tracked in [`docs/audio-engine-progress.md`](../docs/audio-engine-progress.md). The hosted transcription path is fixed to AssemblyAI Universal-Streaming Multilingual; speaker diarization/name mapping is out of scope, while a possible packaged local model remains a separate post-plan decision. Recording storage offers server (default), local, and no-retention choices. The desktop sends that intent in the authenticated transcription handshake. Live transcription stays PCM16; retained audio is Ogg Opus only. Server mode creates no desktop audio spool: the backend writes admitted frames to bounded, recoverable disk files, streams them through FFmpeg/libopus during finalization, uploads per-source Ogg objects and a manifest to B2, then retains the validated manifest locally as a cloud-commit receipt until database completion; missing or empty capture finalizes truthfully as `none`. Server frame admission and disk spooling continue if quota, usage authorization, or AssemblyAI makes live transcription unavailable. Terminal cleanup is retried by janitor reconciliation after failures or restarts. Local mode writes bounded owner-only PCM staging files, converts each non-empty source to Ogg Opus on desktop, atomically publishes only the Opus files plus manifest, and removes the staging data on completion or failure; startup also deletes interrupted staging owned by that installation while preserving completed and foreign-installation directories. No-retention mode creates no storage spool. Summary generation belongs to Phase H; Phase E finalization owns indexing and audio storage. Phase H is limited to transcript-derived summaries, decisions, and action items; third-party product integrations/connectors are excluded. macOS Electron/runtime acceptance is also deferred to a separate follow-up goal and is not a completion gate for this Windows-led plan; native/static Mac checks continue where practical. All remaining user-led runtime/manual acceptance checks are accumulated until the audio-plan implementation is complete; per-increment static checks and builds continue, without automated test-file or test-suite work.

> Phase E implementation exit audit passed: durable ordered transcript reload, bounded reconnect reconciliation, idempotent completion, indexing, Opus storage, invalidation, and resume-as-new-session are wired. Phase F DSP implementation is current; accumulated runtime acceptance remains deferred until implementation completes.

> Phase F now routes microphone, Windows loopback, and macOS process-tap audio through one hardened streaming resampler. It trims filter startup delay, drains the exact remaining duration at stop, and resets filter/input state at capture discontinuities before later VAD, gain, suppression, and echo processing.

> Phase F now also annotates every source frame with WebRTC VAD using bounded 120 ms pre-roll and 300 ms post-roll. Silence remains continuous timestamped PCM for AssemblyAI, reconnect replay, and recording storage; VAD is metadata only. Muted frames remain silence, and discontinuities reset detector state without dropping queued audio.

> Phase F uses pinned Sonora 0.2 for a pure-Rust WebRTC M145 DSP boundary. Microphone audio receives moderate noise suppression and bounded adaptive AGC2; system audio receives separately bounded AGC2 without default suppression. Processing runs in 10 ms blocks before VAD and resets at discontinuities. Raw pre-AGC system PCM now reaches microphone-owned AEC3 through a bounded, non-blocking, timestamp-aligned reference channel; stale, discontinuous, or overflowed reference state safely falls back to microphone NS/AGC while system output remains separate. This decision raises the helper MSRV from Rust 1.85 to 1.91.

> Phase F helper control exposes correlated versioned DSP state and runtime toggles. One atomic configuration controls VAD/AGC for both sources and microphone-only NS/AEC; capture workers apply changes at frame boundaries, preserve queued VAD ordering, and clear stale AEC reference state while echo cancellation is disabled. Speech-free per-source snapshots report requested versus applied state, whole-pipeline effective gain, and bounded Sonora AEC delay/echo statistics without touching real-time callbacks. Dashboard-only authenticated main/preload IPC validates and fences access to the active helper, resets every new session to production defaults, and restores session-scoped overrides across one automatic helper replacement without changing `RecordingUiController` or existing recording channels. Preferences now polls this active-helper state and exposes acknowledged session-scoped toggles plus microphone/system processing and echo metrics; controls are unavailable while capture is idle or disconnected.

> Phase F implementation exit audit passed. The resampler, VAD/silence policy, AGC, microphone NS, timestamp-aligned AEC3 fallback, diagnostics protocol, authenticated controls, and dashboard view are wired across both supported native builds. Residual acoustic echo uses the plan's explicit-guidance exit branch: dashboard transcript surfaces warn that system audio can repeat when it reaches the microphone and recommend headphones. Orion does not heuristically delete similar cross-source text because genuine overlapping speech must remain intact. Phase G recovery and hardening is current; runtime/manual scenarios remain accumulated for the end-of-plan pass.

> Phase G now gates explicit local and global sign-out on active-recording teardown. Main flushes the existing dashboard draft handshake, shares any in-flight stop/finalize operation, preserves the last valid auth token until that barrier settles, rejects new starts during sign-out, then clears auth and renderer state without clearing the draft. Failed finalization disposes capture before sign-out, leaving backend abandonment reconciliation as the durability fallback. Graceful app-quit teardown is the next Phase G unit.

> Graceful app quit now pauses once in `before-quit`, flushes both renderer draft owners through the existing handshake, persists the canonical draft, and gives helper drain plus backend finalization 15 seconds to settle. Success resumes Electron quit exactly once; failure or timeout disposes capture before exit, with helper parent-watchdog and backend abandonment reconciliation covering the interrupted path. Startup recover-last-recording hydration is the next Phase G unit.

> Authenticated startup now queries the existing active-recording endpoint and account-fences the response before publishing a typed dashboard recovery notice. It matches the non-terminal backend session to the restored encrypted draft, never revives capture or reuses that client session identity, and uses subscribe-first IPC plus a getter fallback so dashboard startup cannot miss the notice. The neutral notification reports recovered-draft availability and opens the affected note. Discovery does not auto-finalize because the row may belong to another device still recording; explicit recovered-session finalization is the next Phase G unit, and Resume remains a new session.

> Explicit recovery now requires the dashboard action before Resume. Main revalidates the same account-owned active session, serializes and bounds the existing idempotent finalizer request, rejects local recording/start races, and treats janitor-already-terminal state as recovered. It never revives capture. Success clears recovery state, refreshes the durable transcript query, opens the affected note, and allows Resume to create a new session; failure keeps recovery available. `cloud` finalization lets the backend commit any surviving server spool and truthfully records `none` when no spool exists. Packaged helper and desktop FFmpeg resource wiring is the next Phase G unit.

> Packaged audio runtime wiring now builds or accepts an explicit locked release helper, requires explicit FFmpeg and license inputs, validates target architecture and `libopus`, and copies fixed executables under `resources/bin`. Production runtime resolution ignores development executable overrides and fails closed when those versioned resources are absent. Windows x64 unsigned NSIS assembly passed with byte-identical packaged inputs; macOS arm64 static checks passed. Release acceptance remains blocked on a Windows code-signing identity/method and an approved redistributable FFmpeg build/license package; the locally verified GPL FFmpeg and unsigned artifacts are not release inputs.

> Release packaging is no longer part of this goal by confirmed product decision. Signed installers, selection and compliance packaging of a redistributable FFmpeg/libopus build, notarization, and packaged auto-update replacement checks move to a separate release goal. Existing resource-preparation wiring remains ready but does not block audio-engine implementation. Development live transcription needs no FFmpeg; server retention uses backend FFmpeg, local retention uses installed desktop FFmpeg, and no-retention mode skips encoding. Phase G continues with the audio-data privacy audit, while Windows runtime/manual acceptance remains accumulated until implementation is complete.

> Phase G subprocess diagnostics now fail closed for privacy: helper stderr is drained without retention so device labels and per-user endpoint paths cannot reach Electron logs, and both desktop/backend FFmpeg diagnostics are discarded so selected or staging paths cannot be logged. Typed operation context and process exit status remain available. The next unit completes the privacy audit across provider forwarding, retained B2 metadata, and terminal cleanup.

> Phase G third-party response handling now reduces AssemblyAI errors to a fixed internal provider failure and B2 failures to operation plus HTTP status; provider-controlled payloads cannot enter Orion logs. Retained recording object identifiers and metadata contain only opaque UUIDs and source/codec facts, never transcript text, note titles, or speech. The cleanup audit found one remaining privacy gap: a failed best-effort deletion after partial B2 upload has no durable janitor retry. Durable partial-upload cleanup is the next unit; successfully committed retained recordings must remain untouched.

> Partial B2 upload cleanup is now durable and janitor-retriable. An owner-only synced marker exists before any recording object upload and remains until a local committed-upload receipt exists; deletion failure retains the marker and spool. Janitor reconciliation distinguishes active, complete, and failed/abandoned/missing database sessions: active data is untouched, complete sessions keep remote retained audio while local receipts are removed, and every other terminal/orphan path deletes exact deterministic remote objects before removing the spool. Missing B2 targets are idempotent successes and exact-name checks prevent deletion of adjacent objects. Phase G implementation exit audit is next.

> Phase G long-meeting spool hardening now gives both desktop-local and backend-server retention a matching 4 GiB per-source disk bound, about 12.4 hours of continuous 48 kHz mono PCM16. This replaces the accidental 512 MiB / 93-minute ceiling without introducing memory growth; live transcription and no-retention mode are unchanged. Phase G implementation exit re-audit is next. Release packaging remains outside this goal.

> Phase G implementation re-audit passed recovery, resource-bound, timestamp/drift, cleanup, and speech-log privacy tracing except one auth-loss gap. Explicit sign-out already flushes the draft and drains/finalizes with the retained token, but implicit session expiry, validation failure, `SIGNED_OUT`, or auth-service loss currently clears auth and disposes capture first. Next unit routes all authenticated-to-nonauthenticated transitions through the same serialized teardown barrier before publishing auth loss. Phase H remains blocked until this is fixed.

> Implicit auth loss now coalesces through one main-process teardown barrier before auth state clears: new recording starts are fenced, the cached token remains available, the draft flushes, capture drains, and finalization is attempted before session expiry, Supabase `SIGNED_OUT`, backend rejection, or auth-service loss reaches renderers. Token-refresh failure starts teardown without blocking its own reconnect call, so finalization can retry with the cached token instead of deadlocking. Failure still terminates capture and leaves backend janitor recovery; explicit sign-out remains unchanged. Final Phase G implementation exit audit is next.

> The final Phase G audit found one remaining long-meeting memory issue in the AssemblyAI adapter: finalized turn text/timing state accumulated for the connection lifetime. Finalized content is now released immediately while duplicate suppression retains only the latest 128 finalized identities per source channel. Final Phase G implementation exit re-audit is next; release work remains excluded.

> Phase G re-audit also found the retained recording fixture module lacked the required dev-only entry route. `?view=recording-fixture` now mounts and starts it only in Vite development mode; normal and production overlay paths remain unconditionally IPC-backed and main-owned. Final Phase G implementation exit re-audit remains next.

> Phase G implementation exit audit passed after bounded provider-turn cleanup and development-fixture restoration. Static tracing covers the full recovery matrix, teardown/finalization ordering, single-session and main-authorship invariants, bounded long-meeting state, durable cleanup, and speech-log privacy on both supported native builds. Phase H is current and remains limited to backend + renderer transcript-derived summaries, decisions, and action items. Accumulated Windows runtime acceptance remains deferred until implementation completion; macOS runtime and release packaging remain separate goals.

> Phase H backend generation now has a bounded transcript-to-artifacts service and authenticated `POST /api/notes/:noteID/meeting-artifacts` channel. The endpoint verifies note ownership, loads account-scoped durable segments, resolves the optional template assigned to the note's live folder, and returns strict artifacts plus non-secret template identity without persisting note markdown or logging transcript/provider content. The desktop has authenticated abortable transport, a strict bounded decoder, and a saved-transcript-only generation/review surface with explicit invocation, stale-request fencing, template attribution, empty/error states, retry, and regeneration. Strictly decoded artifacts also populate renderer-local selected-note Summary-tab state, which clears on note changes. Reviewed output changes the note only through an explicit “Add to note” action: model text is bounded and Markdown-escaped, appended without rewriting existing content, mirrored through the shipped draft channel, then saved only by the dashboard's revision-aware mutation. Phase H implementation exit audit is next. Connectors, speaker features, helper changes, macOS runtime, and release work remain excluded.

> Phase H structured-output hardening now gives meeting-artifact generation a dedicated OpenRouter JSON-object request mode plus a 90-second provider deadline. Strict local decoding remains authoritative, and unrelated AI text generation keeps its existing request behavior. Phase H implementation exit re-audit is next; release packaging remains outside this deeply-in-development goal.

> Phase H implementation exit audit passed. Backend generation, authenticated note ownership, durable transcript and folder-template reads, strict renderer decoding, provisional review, selected-note Summary state, and explicit dashboard-only insertion are wired end to end. Phases A–H are implementation-complete. This deeply-in-development goal now stops at the accumulated Windows development-runtime checklist in `docs/audio-engine-progress.md`; macOS runtime and release packaging remain separate future goals.

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
