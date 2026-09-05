# Audio Engine Rebuild Plan

## Why the integration is being rebuilt

The first audio-engine implementation landed as commit `ae874bb` with 17,863 insertions and 629 deletions across 100 files. It combined Rust capture, Electron process supervision, IPC, transcription, storage, recovery, backend lifecycle changes, meeting artifacts, settings, and UI behavior in one change set.

That breadth made regressions difficult to isolate. Failures in helper startup, macOS permissions, capture ordering, renderer recovery, transcription availability, recording finalization, and overlay behavior could affect one another without a small known-good boundary.

The replacement approach starts from `main` and introduces one independently verifiable capability at a time. The original `audio-engine-integration` branch remains available as a reference, but its large commits will not be cherry-picked into the rebuild.

## Branch strategy

- Baseline: `main` at `0a8dac9` (`render sync fix`).
- Rebuild branch: `audio-engine-rebuild`.
- Reference branch: `audio-engine-integration`.
- Preserve the reference branch unchanged.
- Reconstruct useful behavior in small commits instead of copying whole files blindly.
- Keep generated files and build output out of Git.
- Use the repository's configured developer identity for commits. Do not add automated-agent co-author metadata.

## Implementation principles

1. Each commit should introduce one capability or one tightly coupled contract.
2. Every commit must leave the existing application path buildable.
3. Rust capture must not be connected to recording lifecycle code until helper startup and shutdown are reliable independently.
4. Microphone and system-audio capture are separate milestones and separate failure domains.
5. System-audio failure must be able to degrade to microphone-only recording.
6. Transcription availability must not determine whether audio capture can continue.
7. Recording finalization and recovery are introduced only after capture and streaming boundaries are stable.
8. Backend storage, meeting artifacts, and AI-derived output remain separate from the native capture foundation.
9. Do not add, modify, or run automated tests under the current project guidance. Verification uses static checks, builds, direct helper commands, and user-led runtime inspection.

## Rebuild sequence

### Stage 0 — Stable baseline and UI correction

- Branch from `main`.
- Carry forward the confirmed macOS overlay correction independently.
- Lock the floating overlay to 100% Chromium zoom so dashboard-origin zoom cannot reduce its renderer viewport.
- Size the native window by content dimensions and keep it inside the active display work area.

Exit condition: the baseline desktop application starts and the overlay has equal visible inset on every edge on macOS.

### Stage 1 — Minimal native executable

- Add a dependency-free Rust binary crate.
- Add deterministic `--healthcheck` and `--version` commands.
- Commit the lockfile and ignore Cargo build output.
- Build the helper before desktop development starts so a missing binary fails early and clearly.

Exit condition: locked Cargo checks/builds pass and the helper reports a versioned ready response without accessing audio hardware.

### Stage 2 — Host launch and handshake

- Resolve development and packaged helper paths explicitly.
- Define per-launch identity and parent-process ownership.
- Spawn the helper with bounded startup and shutdown deadlines.
- Introduce one versioned control transport and handshake.
- Keep this stage free of audio capture and backend networking.

Exit condition: Electron can start, health-check, stop, and replace the helper without leaving an orphan process.

### Stage 3 — Microphone capture

- Add microphone device discovery and selection.
- Request and surface microphone permission explicitly on macOS.
- Open only the microphone stream initially.
- Emit bounded PCM frames and scalar level telemetry.
- Add mute behavior without closing the device.

Exit condition: user-led macOS and Windows checks confirm permission prompting, moving waveform, mute behavior, and clean stop.

### Stage 4 — System-audio capture

- Implement macOS system capture separately from microphone startup.
- Implement Windows loopback capture separately.
- Keep source-tagged frames independent.
- Define microphone-only fallback when system capture is unavailable.
- Verify speaker-to-microphone acoustic bleed separately from true system capture.

Exit condition: both sources can be identified independently, and failure of one source does not deadlock or silently stop the other.

### Stage 5 — Main-process recording ownership

- Move canonical recording lifecycle ownership into Electron main.
- Keep renderer windows as state mirrors.
- Preserve recording across overlay/dashboard navigation and renderer reload.
- Make stop available for interrupted sessions.

Exit condition: switching notes or reopening the overlay cannot create contradictory recording state.

### Stage 6 — Live transcription

- Stream source-aware audio from Electron main to the backend.
- Keep provider/network failures independent from capture.
- Add bounded reconnect behavior and explicit unavailable state.
- Preserve deterministic transcript segment identity and deduplication.

Exit condition: transcription reconnects or degrades visibly while local capture remains controllable.

### Stage 7 — Persistence and finalization

- Introduce recording-session backend lifecycle changes separately.
- Persist final transcript segments incrementally.
- Add bounded stop, drain, finalize, and idempotent retry behavior.
- Add local/cloud audio retention only after finalization is reliable.

Exit condition: stop cannot leave the UI indefinitely active, and repeated finalize requests cannot duplicate durable data.

### Stage 8 — Recovery and hardening

- Handle helper failure, renderer failure, backend loss, sign-out, and app quit independently.
- Add parent watchdog behavior.
- Add device-disconnect and partial-source degradation states.
- Perform user-led long-recording and crash-recovery drills.

Exit condition: every failure has an explicit owner, bounded cleanup, and a visible recover-or-stop path.

### Stage 9 — Meeting artifacts and AI features

- Reintroduce summaries, decisions, action items, and related backend/UI work only after durable transcripts are stable.
- Keep these changes out of native capture and transport commits.

Exit condition: derived artifacts consume finalized transcript data without changing recording reliability.

## Verification commands

Use checks appropriate to the files changed in each stage:

```sh
cd desktop
npx tsc -p tsconfig.node.json --noEmit
npx tsc -p tsconfig.json --noEmit
npm run lint
npm run build:audio-engine

cd native/audio-engine
cargo fmt --all -- --check
cargo check --locked
cargo build --locked
```

Backend stages additionally use Go formatting, build, and vet checks. Automated test suites are intentionally excluded by project instruction.

## Historical reference

The original implementation and its detailed completion notes remain on `audio-engine-integration`:

- Initial integration: `ae874bb`
- Later macOS-specific work: `faef517`
- Historical progress document: `audio-engine-integration:docs/audio-engine-progress.md`
- Historical final plan: `audio-engine-integration:docs/rust-audio-engine-final-plan.md`

These are reference material, not accepted completion evidence for the rebuild.
