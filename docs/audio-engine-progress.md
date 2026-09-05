# Audio Engine Rebuild Progress

**Branch:** `audio-engine-rebuild`

**Baseline:** `main` at `0a8dac9`

**Current stage:** Stage 2 — host launch and handshake

**Status:** In progress

**Plan:** [Audio Engine Rebuild Plan](./audio-engine-rebuild-plan.md)

## Reset decision

The original audio integration is not being extended further on this branch. Commit `ae874bb` changed 100 files with 17,863 insertions and 629 deletions, coupling too many native, Electron, backend, persistence, and UI concerns to debug reliably.

The old implementation remains intact on `audio-engine-integration` as a reference. The rebuild started from `main` and will reintroduce capabilities through small, independently verifiable commits.

## Completed

### Stage 0 — stable baseline and macOS overlay

- Created `audio-engine-rebuild` from `main` at `0a8dac9`.
- Preserved `audio-engine-integration` without rewriting or deleting it.
- Removed the previous branch's untracked 551 MB Cargo build cache from the workspace. It was moved to macOS Trash as `orion-audio-engine-target-from-integration` and remains recoverable.
- Fixed the macOS recording-overlay clipping in commit `10a610c`.
- Confirmed the root cause was a persisted Chromium zoom factor shared by the development origin: a native 460×540 window exposed only a 420×493 renderer viewport at DPR 2.19089.
- Locked the floating overlay to 100% zoom, restoring a 460×540 viewport at DPR 2 with the 420×500 surface fully inside its intended inset.
- Switched overlay resizing to content dimensions and constrained expanded bounds to the active display work area.

Verification completed:

- Node/Electron TypeScript checks passed.
- Renderer TypeScript checks passed.
- ESLint passed with zero warnings.
- User confirmed the clipping was fixed on macOS.

### Stage 1 — minimal native executable

- Added a dependency-free Rust binary crate in commit `e1a2ff6`.
- Added deterministic `--healthcheck` and `--version` commands.
- Added protocol version `1` to the health response.
- Committed a minimal Cargo lockfile.
- Ignored only the crate's Cargo `target/` output.
- Added the desktop pre-development build contract in commit `b3f350c` so the helper is built before Vite/Electron starts.

Verification completed:

- `cargo fmt --all -- --check` passed.
- `cargo check --locked` passed.
- `cargo build --locked` passed.
- `orion-audio-engine --healthcheck` returned:

  ```json
  {"protocol_version":1,"engine_version":"0.1.0","status":"ready"}
  ```

- `orion-audio-engine --version` returned `orion-audio-engine 0.1.0`.
- `npm run build:audio-engine` passed.
- Desktop lint passed.
- The main-based desktop development process started successfully after the pre-development helper build.

## In progress

### Stage 2 — host launch and handshake

Next implementation slice:

- Add explicit development and packaged binary path resolution.
- Launch the helper without connecting it to recording controls.
- Add a bounded, versioned readiness handshake.
- Add graceful shutdown with forced termination only after a deadline.
- Confirm the helper cannot outlive Electron main.

## Not started

- Stage 3 — microphone capture and permission handling.
- Stage 4 — macOS and Windows system-audio capture.
- Stage 5 — main-process recording ownership.
- Stage 6 — live transcription.
- Stage 7 — persistence and finalization.
- Stage 8 — recovery and hardening.
- Stage 9 — meeting artifacts and AI-derived features.

## Commit attribution

Rebuild commits use the repository's configured identity:

`Mouiz Ahmed <mouiza@my.yorku.ca>`

No automated-agent author, committer, or co-author metadata is added.

## Historical progress

The superseded implementation's detailed progress log remains available at:

`audio-engine-integration:docs/audio-engine-progress.md`

Its completed checkboxes and acceptance notes apply only to that branch and are not carried forward as evidence for this rebuild.
