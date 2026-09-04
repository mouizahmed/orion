# Rust Audio Engine — Final Implementation Plan

**Status:** Final plan for engine integration. This document is the Phase 5 output required by `desktop/OVERLAY_MODE.md` and supersedes `rust-audio-engine-plan.md` as the execution plan. The older document remains a component-level reference for exhaustive DSP requirements and the applicable portions of its manual QA matrix.
**Updated:** 2026-09-04
**Scope:** Real audio capture, transcription transport, recording/transcript persistence, and recovery for Orion's recording overlay system — integrated with the shipped session host, draft channel, and UI contract, none of which existed when the original plan was written.

---

## 1. Review verdict on the original plan

Kept unchanged (sound decisions, carried forward):

- Rust **helper process** owns capture and DSP — not a native Node module, not a Go sidecar, not renderer `getUserMedia`.
- Two persistent IPC channels (control + audio) with 4-byte length-prefixed framing, per-session endpoint names, ready/handshake protocol, bounded buffering with dropped-frame accounting.
- Mic capture via `cpal`; system audio via **direct platform APIs** (WASAPI loopback on Windows, Core Audio process tap via Rust bindings on macOS; ScreenCaptureKit only as fallback).
- Rust emits **source facts** (source id, VAD, levels, timestamps); Go derives **product meaning** (session context, AI behavior).
- Hosted STT uses AssemblyAI **Universal-Streaming Multilingual** directly; Orion still owns its source-aware wire contract and transcript normalization.
- Real-time callback discipline, 48 kHz PCM16 live transport, and privacy boundaries (no capture before explicit action and no speech in logs). By confirmed product decision, recording storage offers `server|local|none` and defaults to server. Retained recordings are Opus, never raw PCM: `server` encodes from a backend disk spool during finalization, `local` encodes on desktop, and `none` creates no retention spool.

Corrected or superseded by the recording rework:

| Original plan said | Reality now / correction |
|---|---|
| Electron main "requests auth token from renderer when needed" | **Inverted.** `electron/auth-handlers.ts` owns the Supabase session; renderers request short-lived tokens *from* main. The engine's backend connection authenticates with main's own token (`getCurrentAuthTokenForRequest`). |
| Open decision: main vs. Rust streams to backend | **Resolved: Electron main streams.** Main owns tokens, session state, and reconnect policy; the Rust helper stays network-free and auth-free, which keeps it testable and signable in isolation. |
| Renderer-agnostic UI to be designed | Already shipped: `RecordingUiController` (`recording-types.ts`), `RecordingPhase`/`TranscriptPhase` state machine (`recording-state.ts`), snapshot validation (`recording-snapshot.ts`). The engine slots in **behind this contract**; overlay/dashboard components do not change. |
| No session host existed | `electron/recording-ipc.ts` is the session host: single-session enforcement, overlay lifecycle waiters, versioned note-draft channel with encrypted persistence, draft-flush handshake on window swaps, `recording:session` / `recording:transcript-update` fan-out. The engine replaces the **fixture** as the source of session/transcript events, not this plumbing. |
| New backend audio WS to be invented | `backend/internal/handlers/transcription.go` already proxies an authenticated audio WS with per-frame quota enforcement (`authorizeAudio`) and custom-vocabulary injection. Evolve this into the session-scoped, source-aware contract rather than green-fielding. |
| New transcript storage to be invented | `transcript.go` + `TranscriptRepository` + the Redis index queue already persist/search/index segments. Extend the schema; keep the pipeline. |
| Transcript model proposed from scratch | Must map onto the shipped renderer type `RecordingTranscriptSegment` (id, sessionId, noteId, sequence, source, text, startTime, endTime, createdAt, isFinal), with word timings as optional metadata. Speaker fields are excluded. |
| Generic cloud-provider abstraction and benchmark | **Removed from this plan.** The hosted path integrates directly with AssemblyAI Universal-Streaming Multilingual. Orion's own WebSocket/event boundary remains clean, but Phase D does not add a Deepgram/other-cloud adapter layer. |
| Speaker diarization and name mapping | **Removed from scope.** Source attribution (`mic`/`system`) and word timing remain; provider speaker labels, speaker persistence, name mapping, and correction UI are not implemented. |

The single most important architectural change vs. today's fixture wiring: **session-phase authorship moves from the overlay renderer into Electron main.** Today the fixture inside the overlay publishes phase transitions and main validates them (`recording:publish-session`). That was the documented UI-milestone compromise; OVERLAY_MODE.md line "neither window's visibility nor React component lifetime may own the recording lifetime" becomes literally true only when the engine lands in main.

---

## 2. Target architecture

```text
Overlay renderer                     Dashboard renderer
  RecordingOverlay + notepad           pill / dock / transcript panel / editor
  consumes RecordingUiController       consumes recording:session / :transcript-update
  issues commands only                 issues commands only; sole backend note persister
          ▲    │ commands                      ▲    │ commands
          │    ▼                               │    ▼
┌─────────────────────────────────────────────────────────────────┐
│ Electron main — recording session host (recording-ipc.ts)       │
│  • sole author of RecordingPhase transitions                    │
│  • single-session + start-pending enforcement (exists)          │
│  • note-draft channel + flush handshake (exists)                │
│  • NEW audio-engine-manager.ts: helper lifecycle, IPC client,   │
│    backend audio WS client, reconnect, recovery                 │
└───────┬─────────────────────────────────────────┬───────────────┘
        │ control + audio IPC                     │ authenticated WSS
        ▼ (named pipe / unix socket)              ▼ (main's own token)
┌──────────────────────┐            ┌─────────────────────────────┐
│ Rust helper (no net) │            │ Go backend                  │
│  capture, resample,  │            │  recording_sessions state   │
│  VAD/AGC/NS/AEC,     │            │  audio WS + quota (exists)  │
│  framing, metering   │            │  AssemblyAI multilingual    │
└──────────────────────┘            │  transcript persistence      │
                                    │  (exists) + finalize jobs,   │
                                    │  Opus storage, indexing, events │
                                    └─────────────────────────────┘
```

Ownership rules (unchanged from the shipped design, now load-bearing):

- **Main** owns session lifetime, phase transitions, the draft, and both network legs (helper IPC, backend WS). Renderer death, reload, or window visibility never affects capture.
- **Renderers** render snapshots and issue commands. The dashboard remains the only writer of note markdown to the backend.
- **Rust helper** owns audio only. No auth, no tokens, no network, no product policy.
- **Backend** owns the authoritative recording record, transcript durability, quota, finalization, and cross-device invalidation.

---

## 3. Engine ↔ UI contract (what replaces the fixture)

The fixture (`recording-ui-fixture.ts`) previously implemented `RecordingUiController` inside the overlay renderer and *drove* main. The engine inverts this permanently: main drives, renderers mirror.

### 3.1 Main-process changes

New module `electron/audio-engine-manager.ts` (owned by `recording-ipc.ts`, mirroring how `recording-draft-store.ts` is owned today):

- spawn/supervise the Rust helper (ready line → connect both channels → `hello`/`hello_ack`)
- translate helper + backend events into `publishRecordingUiSnapshot` / transcript fan-out calls — the same functions the IPC handlers use today
- own the backend audio WS: connect with `getCurrentAuthTokenForRequest`, refresh on 401 mid-session (the token-refresh loop in `transcription.go` already supports re-resolution), reconnect with capped backoff
- apply the phase reducer (`recording-state.ts` is already pure and shared with `../src` — reuse it verbatim in main, as `recording-snapshot.ts` is reused today)

Retired at cutover:

- `recording:publish-session` and `recording:publish-transcript-update` IPC (renderer→main authorship). `canApplyRecordingUiSnapshot` moves from "validate renderer claims" to an internal transition assertion in main.
- `recording:start` / `recording:stop` forwarding to the overlay renderer (`overlay.webContents.send('recording:start' …)`) — the commands now terminate in the engine manager. The overlay-renderer readiness handshake (`recording:preload-ready`, `recording:surface-ready`) stays: it still gates *window reveal*, just no longer session start.

### 3.2 Renderer changes

- `RecordingOverlayApp` drops the fixture, `RecordingSnapshotPublisher`, and its `onStart`/`onStop` command handlers. It mounts a thin **IPC-backed `RecordingUiController` adapter**: `getSessionSnapshot`/`subscribeSession` over `recording:session` (extended to also broadcast to the overlay, today dashboard-only), transcript over `recording:transcript-update`, commands over the existing invoke channels. `RecordingOverlay`, header, notepad, `LiveTranscriptViewport` are untouched.
- The dashboard already consumes exactly these channels — no changes.
- The fixture is no longer a runtime adapter or compatibility requirement. Its isolated development artifact may remain temporarily, but no application path mounts it.

### 3.3 Phase mapping

`RecordingPhase` stays the UI truth; the engine maps onto it:

| Engine reality | RecordingPhase | TranscriptPhase |
|---|---|---|
| helper spawning / device open / backend WS connecting | `starting` | `connecting` |
| capture running, STT streaming | `recording` | `live` |
| capture running, backend WS reconnecting | `recording` | `reconnecting` |
| capture running, STT declared unavailable (quota, provider down) | `recording` | `unavailable` |
| stop requested; helper draining, final frames flushing | `stopping` | `finalizing` |
| capture closed; backend finalize job running | `finalizing` | `finalizing` |
| finalize acked by backend | `complete` | `complete` |
| recoverable failure (device lost, helper crash w/ session preserved) | `error` | per-cause |

Transition legality is encoded in `ALLOWED_PHASE_UPDATES`; the engine manager must respect it (assert, not bypass). Phase B adds the explicit main-owned `recover` reducer action and legal `error`→`recording` transition required by the helper-restart matrix: helper loss enters `error` / `reconnecting`, a single successful automatic replacement recovers the same session to `recording` / `live`, and replacement failure remains `error` / `unavailable` so the user can stop with partial results. Renderers cannot invoke this internal action.

### 3.4 Commands

- `recording:start {noteId,…}` (dashboard-only sender, unchanged): validate note, create backend recording session (§5), spawn/reuse helper, open backend WS, start capture, publish `starting`→`recording`, then reveal overlay via the existing surface-ready + flush path.
- `recording:stop` (either window, unchanged): publish `stopping`, command helper to drain, flush remaining audio to backend, close WS with an end-of-session frame, await backend finalize ack → `finalizing` → `complete`. The existing draft-flush handshake on the finalizing reveal is the "draft quiescent" hook this plan anticipated — stop reuses it as-is.
- Mute mic / mute system (new IPC, maps to `RecordingUiController.setMicrophoneMuted`/`setSystemAudioMuted`): control-channel command to helper; helper keeps stream alive, emits silence-with-metadata per the VAD/silence policy.
- **Resume** stays exactly as shipped: a *new* sessionId against the same noteId; backend appends segments to the note's transcript; no session revival.

---

## 4. Helper protocol and audio pipeline

Carried from the original plan as **resolved** — restated here so this document stands alone:

- Transport: Windows named pipes with per-user ACLs, macOS unix sockets under a per-session runtime dir; endpoint names delivered via the helper's startup metadata, never global constants.
- Two channels: control (length-prefixed JSON) and audio (length-prefixed binary: fixed header — source id, sequence, timestamp, VAD state, RMS, flags — then raw PCM16). Max sizes defined before allocation; oversized frames are protocol errors.
- Startup: helper binds both endpoints → prints `ready\n` → main connects → `hello` (protocol version, platform) → `hello_ack`.
- Format: 48 kHz, 10–20 ms internal frames, 40–100 ms stream chunks, sources `mic`|`system`, monotonic helper timestamps + wall-clock session timestamp.
- Backpressure: bounded ring buffers, dropped-frame accounting surfaced on the control channel; control stays responsive while audio drops.
- Pipeline order: capture → resample/normalize → metering → NS → AEC (system as reference) → AGC → VAD → framing. WebRTC Audio Processing preferred for NS/AGC/AEC; RNNoise only if quality demands. All DSP toggleable for diagnostics.
- Real-time callbacks copy into preallocated ring buffers only; all DSP and I/O on worker threads.
- Structured error codes (`permission_denied`, `no_input_device`, `system_audio_unavailable`, `device_disconnected`, `device_busy`, `audio_overrun`, `ipc_protocol_error`, …) — main maps these to `recoverableError` text and phase/transcript-phase transitions (e.g. system audio lost → keep recording mic-only, surface `Recording without transcript`-class warning, never silently die).

Deep per-component requirements (device discovery, drift handling, VAD pre/post-roll, AGC targets, echo layering) remain as specified in `rust-audio-engine-plan.md` §Device Discovery–§Observability, plus its Manual QA Matrix, and are not re-litigated here. Its automated-test sections do not apply — per repo guidance, verification is static checks, builds, and user-led manual QA.

---

## 5. Backend: sessions, streaming, durability

### 5.1 Recording session record (evolve existing `note_recording_sessions`)

The live database (verified 2026-09-02, project `njzmleaestfbhdamyitd`) already has a legacy-era `note_recording_sessions` table — currently **empty**, so the migration is free of backfill concerns. Evolve it in place:

Keep: `id`, `note_id`, `user_id`, `status`, `started_at`, `stopped_at`, `last_activity_at` (this is the heartbeat column).

```sql
alter table note_recording_sessions
  drop column paused_at,           -- pause was removed from the product
  drop column transcript_chunks,   -- superseded by transcript_segments rows
  add column client_session_id text not null unique,  -- the desktop sessionId
  add column finalized_at timestamptz,
  add column audio_stored text not null default 'none';  -- none|local|cloud

-- status values become: starting|recording|finalizing|complete|failed|abandoned
-- (drop the legacy 'active' default)

-- exactly one non-terminal session per user, enforced at the DB level
create unique index one_active_recording_per_user
  on note_recording_sessions (user_id)
  where status in ('starting','recording','finalizing');
```

RLS is already enabled on the table; new columns inherit the existing policies.

A legacy `RecordingSessionRepository` (`backend/internal/repository/recording_session.go`, wired through `notes.go`) still targets this table with old start/stop semantics. Phase D reworks it into the new session lifecycle rather than leaving two write paths against one table; its `GetActiveSession(noteID, …)` per-note lookup becomes the per-user active-session lookup the janitor and startup-recovery need.

- `recording:start` calls `POST /api/recordings` before any capture starts (satisfies "the session becomes active only after a real note identity and a real session record exist").
- **Single active session is enforced in both layers**: main already rejects a second start; the partial unique index above rejects violations at the database, which also covers a second device.
- Heartbeats ride the audio WS. A janitor marks sessions `abandoned` after a heartbeat gap (crash recovery below) — the OVERLAY_MODE "stale-session cleanup" requirement.

### 5.2 Audio WS contract (evolve `transcription.go`)

Keep: WS upgrade + `authenticateWSConn`, per-frame `authorizeAudio` quota gate, vocabulary injection, AssemblyAI proxying, token re-resolution mid-stream. Change:

- Bind the connection to a `recording_sessions` row (session id in the connect params); reject unknown/terminal sessions.
- Accept the source-aware binary frame format (source id + sequence + timestamps), replacing interleaved-PCM assumptions.
- Emit transcript events tagged `{session_id, note_id, source, sequence, is_final, words[]}` matching `RecordingTranscriptSegment`. Source attribution comes from Orion's separate microphone/system channels; no speaker diarization or speaker-name fields are produced.
- On quota exhaustion mid-session: do **not** kill capture — respond with a `transcript_unavailable` control event (maps to `TranscriptPhase 'unavailable'`); main keeps recording locally per the storage setting.
- End-of-session frame triggers the finalize path: provider session close → residual finals → status `finalizing` → enqueue post-processing → status `complete` → ack to main.

Duplicate prevention and reconciliation: the existing `transcript_segments` columns `channel` (0 = mic, 1 = system — the mapping `transcript.go` already uses) and `segment_index` serve as source and sequence; `(session_id, channel, segment_index)` is the unique idempotency key on segment upsert. On WS reconnect main replays its unacked tail and the backend dedupes. `applyRecordingTranscriptUpdate` on the renderer side is already idempotent by segment id — segment ids become `"{sessionId}:{source}:{sequence}"` so all three layers agree.

### 5.3 Transcript durability

- **Interim** segments: memory only (main's snapshot + renderer fan-out), never persisted — matches the migration plan's "no live deltas in query data" rule.
- **Final** segments: persisted incrementally by the backend as they arrive (extend `TranscriptRepository`; the `SaveSegments` batch path remains for the finalize sweep). A crash at any point loses at most the in-flight interim, satisfying "incremental transcript durability". Because only finals are persisted, no `is_final` column is needed.
- Segment schema migration (the live table is empty, so this is free): keep existing `id`, `note_id`, `channel`, `text`, `start_time`, `end_time`, `segment_index`, `created_at`; add `session_id uuid references note_recording_sessions`, `words jsonb`, `provider`, `provider_segment_id`, and the unique index `(session_id, channel, segment_index)`. No speaker columns are added.
- On `complete`, publish a `notes` resource event (existing bus) with the note id → invalidates `useNoteTranscriptQuery` on every device, which is how the saved-transcript panel refreshes today. No new renderer wiring.
- Finalize job (existing Redis `queue` + `worker`): embedding/indexing via the existing index-queue hookup in `transcript.go` plus optional recording storage. Live desktop→backend and backend→AssemblyAI audio remains source-aware 48 kHz PCM16. For `server`, the backend streams admitted PCM into bounded session-scoped disk files during capture, then the finalize job encodes per-source Ogg Opus files from that disk spool before streaming them to B2 and deleting all PCM/temp files; recording bytes are never accumulated in backend memory. For `local`, desktop spools PCM only as temporary input, encodes per-source Ogg Opus files at stop, atomically retains the Opus files plus manifest in the selected directory, and deletes the PCM inputs. For `none`, neither side creates a retention spool and audio is discarded after live transcription. Summary generation belongs only to Phase H.

### 5.4 Recovery matrix

| Failure | Behavior |
|---|---|
| Overlay renderer crash/reload | Nothing happens to capture (engine lives in main). Existing `markOverlayRendererReady` recovery stops *tearing down the session* and instead just re-reveals/reloads the window; its "session interrupted" branch is retired. |
| Dashboard crash/close/hide | Already handled; no capture impact. |
| Helper crash | Main: mark `error` + `recoverableError`, attempt one automatic helper restart and session re-arm (same sessionId — capture gap is recorded in diagnostics); if restart fails, offer stop-with-partial-transcript. Transcript persisted so far is safe. |
| Backend WS loss | Capture continues; `TranscriptPhase 'reconnecting'`; bounded local audio buffer with drop accounting; replay unacked tail on reconnect. |
| Auth loss / sign-out | Existing `onSignedOut` path extends to: command helper stop + drain, best-effort finalize with the last valid token, then teardown. Never an invisible orphan capture (OVERLAY_MODE hard rule). Draft handling stays as shipped (`clearDraft:false`). |
| App quit during recording | `will-quit` gains: stop helper, flush draft persistence (exists), fire finalize request; backend janitor completes or marks `abandoned` if the ack never lands. On next launch, main queries for a non-terminal session for this user → surfaces "recover last recording" (transcript persisted; note draft restored from the encrypted store — both mechanisms already exist). |
| Main process crash | Backend janitor closes the session as `abandoned` after heartbeat timeout; helper exits when its control channel closes (helper watchdog rule: no parent, no capture). Desktop startup recovery as above. |

---

## 6. Implementation phases

Sequenced so every phase leaves the main-owned recording path shippable. Verification per repo guidance (`AGENTS.md`: no test authoring or test-suite runs): desktop `tsc` (both configs) + strict ESLint + production builds; `cargo check`/`clippy` for the helper; `go build`/`go vet` for backend changes; user-led visual/manual QA passes.

**macOS manual-gate scheduling amendment (confirmed 2026-09-03).** The current macOS Electron host is not yet stable enough for reliable audio-engine acceptance runs. User-led macOS Electron/runtime testing is therefore outside this goal and will be handled by a separate follow-up goal after the host app is stabilized. It is deferred, not passed, and does not block completion of this Windows-led audio-engine plan. Native/static macOS checks continue over SSH where practical; Windows manual gates remain in their designated phases.

**Manual-gate scheduling amendment (confirmed 2026-09-03).** All remaining user-led runtime/manual acceptance checks are accumulated until Phases A–H are implementation-complete. Phase exit criteria remain required final acceptance coverage, but no longer pause implementation or phase advancement at their original intermediate gates. Every increment still runs the required static checks and builds; no automated test files or test suites are added, modified, or run.

**Phase A — Session host completion (no audio yet).**
Move phase authorship permanently into main: the engine manager skeleton drives the timer-based `starting→recording→stopping→finalizing→complete` sequence, renderers use the IPC-backed controller adapter, and `recording:publish-*` endpoints become inert while their channel names remain stable. *Exit:* the overlay renderer is demonstrably stateless (kill/reload it mid-"recording" — session unaffected) and the stop/finalization flow remains intact.

**Phase B — Helper foundations.**
Rust crate: transport, framing, handshake, health, device inventory, structured errors; Electron manager: spawn/supervise/reconnect. No capture. *Exit:* helper lifecycle survives manual kill -9 / stale-socket / double-spawn drills; `cargo check` and `clippy` clean.

**Phase C — Capture.**
Mic (`cpal`) + Windows WASAPI loopback; macOS Core Audio tap next (bindings decision resolved here); mute; metering; permission errors mapped to UI states. *Exit:* level meters live in the overlay from real frames; mic-only fallback works.

**Phase D — Backend sessions + streaming.**
`recording_sessions` migration + endpoints + janitor; evolve `transcription.go` to the session-scoped source-aware contract backed directly by AssemblyAI Universal-Streaming Multilingual; main streams; interim/final events flow end-to-end into both windows through the existing fan-out. *Exit:* live transcript in overlay + dock from real multilingual speech; quota exhaustion degrades to `unavailable` without killing capture.

**Phase E — Durability + finalization.**
Incremental final-segment persistence, idempotent upsert keys, reconnect replay, finalize job (indexing and Opus audio storage), `complete` ack, resource-event invalidation, resume-as-new-session appending. *Exit:* OVERLAY_MODE integrated-milestone transcript criteria (ordered, deduplicated, durable, reconciled after reconnect; dashboard reload restores session + transcript). Summary generation is excluded here and implemented in Phase H.

**Phase F — DSP.**
Resampling hardening, VAD (+ silence policy decision), AGC, NS, AEC, diagnostics view/toggles. *Exit:* echo/duplicate-transcript scenarios from the QA matrix pass or are explicitly guided in UI.

**Phase G — Recovery + hardening.**
Full §5.4 matrix, sign-out/quit/crash drills, long-meeting soak (memory/drift), and privacy review. Runtime/manual checks remain accumulated until implementation is complete. *Exit:* OVERLAY_MODE integrated-milestone acceptance list passes on the Windows development runtime, excluding release packaging and signing.

**Phase H — AI features.** Build transcript-derived summaries, decisions, and action items on the durable transcript. Third-party product integrations/connectors are excluded. Speaker diarization, identity, mapping, and correction remain excluded; this phase is backend + renderer only and requires no helper changes.

**Separate follow-up macOS goal.** After the macOS Electron host is stabilized, run the accumulated native runtime coverage: microphone and system-audio permissions, both live meters, microphone-only fallback, real-speech transcription and quota degradation, echo/duplicate-transcript behavior, recovery/quit/crash handling, and the packaged signed-build matrix. This coverage is not claimed as passed and is not part of this goal's completion criteria.

**Separate follow-up release-packaging goal (confirmed 2026-09-04).** Production installers are not being prepared or released during this audio-engine goal. Finalize the already-wired runtime resource assembly there: select and document a redistributable FFmpeg/libopus build, sign the Windows application, helper, FFmpeg executable, and installer, notarize the macOS bundle when that host is ready, and prove auto-update replaces the helper and encoder with the application version. None of those release-distribution checks block Phases G or H here. Development local-retention mode continues to resolve installed FFmpeg from `PATH` or the explicit development override.

---

## 7. Decisions

Resolved (beyond the original plan's resolved table):

| Decision | Resolution | Why |
|---|---|---|
| Who streams to backend | Electron main | Token ownership, session authority, and reconnect policy already live in main; helper stays network/auth-free. |
| Session phase author | Electron main only | OVERLAY_MODE invariant; renderers become stateless mirrors. |
| UI contract | Keep `RecordingUiController` + existing IPC channel names | Zero component churn at cutover; fixture stays for dev. |
| Transcript identity | `{sessionId}:{source}:{sequence}` across helper/backend/renderer | One idempotency scheme end to end. |
| Quota exhaustion mid-session | Degrade to `transcriptPhase 'unavailable'`, keep capturing | Matches shipped UI states and the "capture-without-transcript" product state. |
| Backend WS handler | Evolve `transcription.go`, keep `authorizeAudio` + vocabulary flow | Working auth/quota/vocab code beats a rewrite. |
| Hosted STT provider | AssemblyAI Universal-Streaming Multilingual (`universal-streaming-multilingual`) | It is the selected hosted provider; no generic cloud-provider adapter or benchmark is required in this plan. |
| Speaker attribution | Source only (`mic`/`system`); no diarization | Provider speaker labels are not viable for the product requirement, while deterministic source attribution remains useful and reliable. |
| Recording storage default | `server`; also offer `local` and `none` | The user explicitly chose server retention as the product default after adding a no-audio-retention option; existing server/local preferences remain stable. |
| Live/saved audio codecs | PCM16 live; Ogg Opus retained | AssemblyAI receives PCM16. Server mode spools PCM on backend disk and encodes during finalization; local mode encodes on desktop; none creates no retention spool. Raw PCM is never retained. |
| VAD silence transport | Continuous timestamped PCM with VAD metadata | AssemblyAI timing, reconnect replay, and recording storage retain one continuous source timeline; VAD labels speech/silence but never makes transport sparse. |
| WebRTC audio processing | Sonora 0.2, pinned; helper MSRV 1.91 | Its pure-Rust WebRTC M145 pipeline provides AEC3, NS, and AGC2 with native Windows/macOS builds and no separately packaged C++ runtime. |

Still open (decide in the phase noted):

- macOS Core Audio binding split — `objc2-core-audio` vs `coreaudio-sys` vs minimal shim (Phase C).

Post-plan consideration (not a commitment or current requirement): evaluate packaging a local transcription model such as Moonshine as an optional alternative after this plan is fully complete. Eligibility for free versus paid users, model/runtime choice, packaging size, hardware requirements, privacy behavior, and fallback policy will be decided in that separate effort.

---

## 8. Definition of done

The applicable capture, DSP, durability, and recovery requirements in the original plan's DoD remain, except its generic provider abstraction, all speaker-diarization/name-mapping requirements, and release-packaging requirements, which are explicitly superseded here. Source attribution remains required. In addition:

- Overlay renderer kill/reload during recording: session, capture, and transcript continue; window returns to live state.
- Exactly one active session enforced by main **and** the backend constraint; second-device start is rejected with a clear error.
- Draft integrity invariants shipped this cycle remain true under the engine: single draft owner, flush-fenced window swaps, no renderer session authorship, dashboard as sole note persister.
- Stop from any surface produces one `stopping → finalizing → complete` transition with one finalize job.
- Live transcription uses PCM16 while retained audio uses per-source Ogg Opus only. Server-mode PCM exists solely in a bounded backend disk spool until finalization; local-mode PCM exists solely as desktop conversion input; `none` creates no retention spool; no successful path retains raw PCM.
- Sign-out, quit, and crash paths leave no orphan capture and no permanently blocked next recording.
- After implementation is complete, the applicable capture, device, echo, recovery, and long-session cases in `rust-audio-engine-plan.md`'s QA matrix pass on the Windows development runtime; speaker/attendee-name scenarios are excluded. Signed Windows distribution and packaged macOS runtime acceptance belong to their separate follow-up goals.
