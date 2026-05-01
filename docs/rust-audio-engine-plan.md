# Production Audio Engine Implementation Plan

**Status:** Proposed  
**Updated:** 2026-05-01  
**Scope:** Build a production-ready native audio, transcription, speaker attribution, and AI meeting pipeline for Orionly. The old app can be used as reference, but the new implementation does not need to preserve old capture code, stale abstractions, or current WebSocket contracts.

## Product Goal

Orionly should feel like a reliable meeting intelligence app, not a prototype wrapper around browser audio APIs. The production architecture should support:

- high-quality mic and system audio capture
- local audio preprocessing
- real-time transcription
- speaker/source attribution
- meeting-aware name mapping
- robust transcript persistence
- summaries and AI workflows
- privacy-conscious local behavior
- clean desktop packaging
- room to swap STT providers or add internal ASR later

## Core Architecture

```text
Electron renderer
  - app UI
  - meeting controls
  - live transcript
  - notes
  - speaker correction UI
  - AI features UI

Electron main process
  - owns native helper lifecycle
  - owns local recording session lifecycle
  - opens backend realtime connection
  - forwards helper events to renderer
  - forwards backend transcript events to renderer
  - handles packaging paths, permissions, crash recovery

Rust audio engine helper
  - device discovery
  - mic capture
  - system audio capture
  - resampling
  - channel alignment
  - VAD
  - AGC
  - noise cancellation
  - echo handling
  - chunking
  - local metrics
  - optional local audio recording

Go backend
  - auth
  - quota/billing enforcement
  - recording session state
  - realtime audio WebSocket
  - STT provider adapters
  - transcript normalization
  - speaker metadata persistence
  - summaries and AI workflows
  - search/indexing

STT / ASR layer
  - external streaming STT first
  - provider abstraction in backend
  - optional internal ASR later
```

## Key Decision

The low-level audio engine should be a local Rust helper process, not a Go microservice and not renderer-based browser capture.

Rust should own local audio capture and preprocessing because those tasks are latency-sensitive, device-specific, and OS-specific. Go should own backend orchestration, auth, persistence, provider routing, and AI workflows.

The Rust engine should ship as a separate helper binary managed by Electron main. A helper process is easier to restart, log, test, sign, and eventually reuse than a native Node module.

## Greenfield Assumptions

Since this is being revisited as a production app:

- The current `getUserMedia` / `AudioWorklet` path can be replaced completely.
- The current macOS Swift helper can be replaced.
- The current transcription client naming and protocol can be redesigned.
- The backend WebSocket protocol can change.
- Transcript schema can be improved.
- The UI can expose better source/speaker concepts from the beginning.
- Existing files are implementation references, not constraints.

## Production Pipeline

```text
Mic audio
System audio
  → Rust audio engine
    → capture
    → resample to standard format
    → normalize channels
    → level metering
    → noise suppression
    → echo cancellation / echo reduction
    → AGC
    → VAD
    → timestamped source chunks
  → Electron main realtime session
  → Go backend audio stream
  → STT provider adapter or internal ASR
  → transcript event normalizer
  → speaker attribution/name mapping
  → transcript persistence
  → summaries / AI features
```

## Rust Audio Engine Responsibilities

The Rust helper owns:

- startup/shutdown
- health checks
- protocol version negotiation
- audio device inventory
- default device detection
- mic capture
- system/loopback capture
- sample format conversion
- resampling
- channel mixing/normalization
- drift detection between mic and system clocks
- frame timestamps
- VAD
- AGC
- noise suppression
- echo handling
- level metering
- chunk sequencing
- local debug metrics
- optional local raw/processed recording

### macOS Backend Strategy

The macOS capture backend should be implemented inside the Rust audio engine first, using Rust bindings to Apple's native Core Audio APIs.

Preferred approach:

```text
Rust audio engine
-> macOS capture backend
-> objc2-core-audio / coreaudio-sys
-> AudioHardwareCreateProcessTap
-> Core Audio callback
-> lock-free/ring buffer
-> Rust processing pipeline
```

Use:

- `objc2-core-audio` for modern Core Audio types such as `CATapDescription` where the bindings are complete enough.
- `coreaudio-sys` for lower-level Core Audio calls or missing pieces.
- a small C/Obj-C shim only if Rust bindings block a required API, callback shape, entitlement behavior, or packaging requirement.

Do not default to a separate Swift helper in the new architecture. The existing Swift helper proves the Core Audio process tap approach works, but production code should live behind the unified Rust engine interface unless a specific Apple API forces a bridge.

Real-time callback rule:

- the Core Audio callback should do the minimum possible work
- copy samples into a preallocated ring buffer
- avoid logging, allocation, blocking locks, network I/O, IPC writes, or heavy DSP in the callback
- run resampling, VAD, AGC, noise suppression, echo handling, metrics, and streaming on worker threads

ScreenCaptureKit remains an optional fallback/alternate backend for cases where process taps are unavailable or where the product later needs screen/window capture together with audio. It should not be the primary macOS audio-only strategy.

The Rust helper does not own:

- user auth
- billing/quota
- cloud transcript storage
- summaries
- note organization
- calendar integration
- long-term speaker identity storage

## Electron Main Responsibilities

Electron main should be the production coordinator for local recording:

- spawn the Rust helper
- restart or shut down the helper safely
- own the local recording session state
- request auth token from renderer when needed
- connect to backend realtime audio WebSocket
- stream helper audio frames to backend
- receive transcript events from backend
- forward transcript/status events to renderer
- forward user commands to helper
- keep renderer free from low-level audio timing work

This keeps the renderer focused on UI and avoids pushing audio streaming reliability into React state.

## Electron Renderer Responsibilities

The renderer owns:

- meeting start/stop controls
- mic/system mute controls
- audio status display
- live transcript rendering
- note editor
- speaker label correction UI
- summary/AI controls
- errors and permission guidance

Renderer should not directly capture audio in production.

## Go Backend Responsibilities

The backend owns:

- authenticated realtime audio sessions
- per-user quota enforcement
- session lifecycle persistence
- STT provider routing
- provider failover hooks
- provider event normalization
- transcript segment persistence
- speaker metadata persistence
- session context inference from source activity
- note/transcript linking
- AI summaries and transformations
- retrieval/search indexing

The backend should expose a provider-neutral transcription contract to the desktop app.

## Session Context Inference

The app does not need to force users to choose a recording mode before every session. The production pipeline should infer the effective session context from source-aware audio activity and transcript segments.

Rust should emit source facts only:

- `mic` or `system` source id
- per-source VAD state
- per-source RMS/peak level
- timestamps and durations
- processing metadata

Go should translate those facts into product meaning:

- `mic` speech only -> in-person meeting context
- `system` speech only -> media, podcast, or video context
- `mic` and `system` speech -> online meeting context
- neither source active -> no realtime insight generation

The inferred context should guide realtime AI behavior, transcript presentation, summaries, and follow-up workflows. For example, in a `mic`-only session, realtime insights should prefer in-person meeting behavior such as key points, decisions, names, and action items. In a `system`-only session, insights should avoid conversational coaching and focus on media summarization, topic extraction, and timestamped notes.

This logic belongs in the Go backend, not the Rust helper, because it affects AI prompts, persistence, billing, product behavior, and can evolve without shipping a native helper update.

## Audio Format And Streaming Protocol

Use a first-party Orionly realtime protocol instead of inheriting the current interleaved PCM assumptions.

Initial standard:

- sample rate: 48 kHz
- frame duration: 10-20 ms internally
- stream chunk duration: 40-100 ms
- source ids: `mic`, `system`
- sample format: PCM16 initially
- timestamps: monotonic helper timestamp plus wall-clock session timestamp
- metadata: VAD state, RMS level, processing flags, sequence number

The protocol should allow either:

- separate per-source binary frames, preferred for clarity
- mixed stereo frames, only if a provider requires it

Example control message:

```json
{
  "type": "audio_session.start",
  "protocol_version": 1,
  "session_id": "session_123",
  "sample_rate": 48000,
  "sources": ["mic", "system"],
  "processing": {
    "vad": true,
    "agc": true,
    "noise_suppression": true,
    "echo_cancellation": true
  }
}
```

Example audio metadata:

```json
{
  "type": "audio.frame",
  "source": "mic",
  "sequence": 1842,
  "timestamp_ms": 34520,
  "duration_ms": 60,
  "sample_rate": 48000,
  "format": "pcm16",
  "vad": "speech",
  "rms_db": -24.8,
  "peak_db": -7.2,
  "processing": {
    "agc_gain_db": 3.1,
    "noise_suppression": true,
    "echo_cancellation": true
  }
}
```

Binary payload should be separate from JSON metadata to avoid base64 overhead.

## Device Discovery

The helper should support:

- list microphones
- list output/system capture routes
- detect default mic
- detect default output
- report device id, display label, channel count, sample rates, and availability
- notify Electron when devices are added/removed
- notify Electron when default input/output changes

Production UI should eventually support selecting preferred devices, but defaults should work without configuration.

## Mic Capture

Requirements:

- default mic capture
- selected mic capture later
- mute without tearing down stream
- level metering
- permission failure reporting
- device disconnect recovery
- no audio capture before user starts a session
- stable behavior across built-in, USB, and Bluetooth microphones

## System Audio Capture

Requirements:

- Windows WASAPI loopback
- macOS Core Audio process tap through Rust bindings
- optional macOS ScreenCaptureKit fallback/alternate path
- mute without tearing down stream
- level metering
- output device change handling
- mic-only fallback if system audio is unavailable
- clear permission flow on macOS

System audio is a first-class source, not a display-capture side effect.

macOS target behavior:

- capture mixed system output for meeting audio
- exclude Orionly's own audio from capture to avoid feedback
- expose whether capture is system-output or fallback mode
- require explicit user permission where macOS requires it

For meeting transcription, mixed output-device/system capture is the target behavior because Zoom/Teams/Meet audio reaches the user's selected output device. Do not scope capture to specific process ids in the production plan.

## Resampling And Clock Alignment

Requirements:

- normalize all sources to 48 kHz
- support f32/i16/u16 native input formats
- convert multichannel source audio to mono for STT unless stereo is explicitly needed
- detect drift between mic and system clocks
- keep frame timestamps monotonic
- avoid growing buffers during long meetings

Use a proven resampler rather than ad hoc conversion.

## VAD

Voice activity detection should run locally per source.

Requirements:

- classify speech/silence
- emit state changes
- configurable aggressiveness
- pre-roll before speech
- post-roll after speech
- avoid clipping words
- support disabling for diagnostics

Benefits:

- lower STT cost
- cleaner turns
- better live UI status
- less wasted bandwidth

Important decision: if the STT provider needs continuous timing, send silence markers or timestamp metadata rather than pretending silence did not exist.

## AGC

Automatic gain control should improve quiet speakers and inconsistent microphones.

Requirements:

- per-source AGC
- target level configuration
- max gain limit
- avoid amplifying noise during silence
- expose applied gain for diagnostics
- allow disabling

Preferred implementation: WebRTC Audio Processing AGC via Rust bindings or C/C++ FFI.

## Noise Cancellation

Requirements:

- mic noise suppression
- optional system audio suppression
- configurable strength
- preserve speech intelligibility
- diagnostics for enabled/disabled state

Preferred implementation:

- WebRTC Audio Processing first
- evaluate RNNoise only if quality requires it

## Echo Handling

Echo handling should reduce duplicate transcripts when the mic hears speaker output.

Layers:

- local acoustic echo cancellation using system audio as reference
- delay alignment between system and mic sources
- backend transcript duplicate detection as fallback
- UI guidance when echo cannot be corrected reliably

Requirements:

- do not collapse mic/system into one source
- preserve source metadata
- allow AEC to be disabled
- report echo metrics for tuning

## Speaker Segmentation, Separation, And Attribution

Separate these concepts:

- **Source attribution:** mic vs system.
- **Speaker segmentation:** when speaker turns start/end.
- **Speaker diarization:** distinguishing different remote speakers.
- **Name mapping:** assigning real names to speaker labels.

### Source Attribution

Immediate:

- `mic` source maps to the signed-in local user by default.
- `system` source maps to remote meeting audio.

### Speaker Segmentation

Use:

- local VAD turns
- STT word timings
- provider utterance boundaries
- source-specific timing

### Speaker Diarization

Options:

- STT provider diarization
- backend diarization service
- future local diarization model

Do not force this into the Rust helper at first unless local diarization quality and performance are proven.

### Name Mapping

Inputs:

- calendar attendees
- organizer
- signed-in user
- meeting title
- repeated meeting history
- transcript self-introductions
- user corrections

Behavior:

- suggest names when confidence is reasonable
- show uncertainty
- let users correct labels
- persist corrections per note/meeting
- optionally remember mappings for recurring meetings

## Transcript Data Model

Production transcript segments should support richer metadata than plain text chunks.

Suggested shape:

```json
{
  "id": "segment_123",
  "note_id": "note_123",
  "session_id": "recording_123",
  "source": "system",
  "channel": 1,
  "speaker_id": "speaker_b",
  "speaker_name": "Sarah",
  "speaker_confidence": 0.76,
  "text": "Let's look at the roadmap.",
  "start_time": 42.15,
  "end_time": 45.82,
  "confidence": 0.93,
  "is_final": true,
  "provider": "assemblyai",
  "provider_segment_id": "provider-id",
  "words": [
    { "text": "Let's", "start": 42.15, "end": 42.34, "confidence": 0.92 }
  ],
  "created_at": "2026-05-01T05:00:00Z"
}
```

Store enough provider/source metadata to debug and improve speaker attribution later.

## STT Provider Strategy

Use a backend provider abstraction from the beginning.

Provider interface should support:

- connect session
- send audio frame
- receive interim transcript
- receive final transcript
- terminate session
- provider metadata
- error normalization

Required provider features:

- streaming transcription
- low-latency interim results
- final utterance boundaries
- word timings
- punctuation
- custom vocabulary
- multi-channel or source-aware support
- optional diarization

Internal ASR can be evaluated later. If added, it should be a separate runtime/service, not mixed into the Rust capture helper by default.

## AI Features

The audio engine feeds the transcript layer. AI features should build on structured transcript data.

Planned AI features:

- live meeting summary
- post-meeting summary
- decisions
- action items
- follow-up email draft
- key questions
- risks/blockers
- topic timeline
- speaker-specific commitments
- searchable transcript memory
- meeting brief from calendar context and previous notes

The AI layer should consume:

- final transcript segments
- speaker labels
- timestamps
- calendar metadata
- note content
- user vocabulary/custom terms

## User Vocabulary And Custom Terms

Production transcription should support:

- custom vocabulary
- company/product names
- people names
- acronym handling
- meeting-specific glossary from calendar attendees and note context

Flow:

```text
user vocabulary + calendar attendees + note context
→ backend provider adapter
→ STT custom vocabulary / prompt where supported
→ transcript normalizer
```

## Recording Storage

Support these modes:

- transcript only
- local audio recording
- cloud audio recording if explicitly enabled

Defaults should be privacy-conscious:

- do not store raw audio by default
- store transcript segments
- allow user-controlled local recording folder

If audio is saved, store:

- source
- raw vs processed flag
- sample rate
- start/end time
- associated note/session id

## Privacy And Permissions

Rules:

- no audio capture before explicit user action
- no background recording without visible state
- no raw audio upload unless transcription or cloud recording is enabled
- no speech content in logs
- clear mic/system permission guidance
- local debug recordings off by default

Permissions:

- microphone permission
- macOS system audio capture permission requirements for Core Audio taps
- macOS ScreenCaptureKit permission requirements if fallback is enabled
- Windows loopback behavior verification

## Error Handling

Structured helper errors:

- `permission_denied`
- `no_input_device`
- `no_output_device`
- `system_audio_unavailable`
- `device_disconnected`
- `device_busy`
- `unsupported_platform`
- `processing_init_failed`
- `audio_overrun`
- `audio_underrun`
- `ipc_protocol_error`

App behavior:

- continue mic-only if system audio fails
- show clear permission instructions
- allow retry
- recover from helper crash if session can continue
- preserve partial transcript on failure

## Observability

Collect diagnostics without user speech:

- helper version
- protocol version
- selected devices
- sample rates
- chunk duration
- dropped frames
- buffer depth
- RMS/peak levels
- VAD state
- processing flags
- helper restarts
- backend stream latency
- STT provider latency
- transcript finalization delay

Add a developer diagnostics view or exportable debug bundle later.

## Packaging And Distribution

Build requirements:

- compile Rust helper for each target platform
- copy helper into Electron app resources
- resolve helper path in dev and packaged app
- sign helper with app
- notarize macOS build
- include required entitlements
- verify auto-update handles helper replacement

Target platforms:

- Windows first
- macOS first
- Linux only if product scope explicitly includes it

## Testing Plan

### Rust Tests

Cover:

- protocol parsing
- device config validation
- ring buffers
- resampling
- frame timestamps
- interleaving/source framing
- mute behavior
- VAD transitions
- dropped frame accounting

### Helper Integration Tests

Cover:

- starts cleanly
- responds to health check
- lists devices
- starts mic capture
- starts system capture where supported
- emits valid frames
- handles invalid commands
- stops cleanly

### Desktop Tests

Cover:

- Electron main starts helper
- session starts/stops
- mic/system mute works
- helper crash surfaces clearly
- backend disconnect surfaces clearly
- renderer receives transcript events
- partial transcript survives failures

### Backend Tests

Cover:

- authenticated audio session
- provider adapter contract
- audio frame validation
- transcript normalization
- segment persistence
- speaker metadata persistence
- provider error normalization

### Manual QA Matrix

Windows:

- built-in mic
- USB mic
- Bluetooth headset
- laptop speakers
- external monitor audio
- device switch during meeting
- no headphones
- headphones
- noisy room
- long meeting

macOS:

- built-in mic
- AirPods
- USB mic
- system audio permission flow
- output switch during meeting
- sleep/wake
- notarized packaged app

Meeting scenarios:

- quiet local speaker
- loud remote speaker
- overlapping speech
- long silence
- rapid speaker changes
- background music/noise
- recurring calendar meeting
- attendees with names to map

## Implementation Phases

These phases are for execution order. The target architecture is the full production system above.

### Phase 1: Production Foundations

Build:

- Rust helper crate
- versioned IPC protocol
- Electron main audio engine manager
- backend realtime audio session contract
- provider-neutral transcription interfaces
- new transcript segment model plan/migration

### Phase 2: Native Capture

Build:

- mic capture
- Windows system audio capture
- macOS Core Audio process-tap capture using Rust bindings
- device discovery
- mute controls
- level meters
- clean permission errors

### Phase 3: Realtime Audio Stream

Build:

- timestamped source audio frames
- Electron main to backend streaming
- backend frame validation
- STT provider adapter
- transcript event streaming back to desktop
- live transcript UI integration

### Phase 4: Transcript Persistence

Build:

- structured transcript segment storage
- source/channel metadata
- word timings
- interim vs final event handling
- session recovery/partial-save behavior
- search/index hooks

### Phase 5: Audio Processing

Build:

- resampling hardening
- VAD
- AGC
- noise suppression
- echo cancellation/reduction
- diagnostics and toggles

### Phase 6: Speaker Intelligence

Build:

- source attribution
- speaker diarization integration
- speaker/name mapping
- calendar attendee hints
- speaker correction UI
- persistence of speaker corrections

### Phase 7: AI Meeting Features

Build:

- live summary
- post-meeting summary
- decisions
- action items
- follow-up drafts
- topic timeline
- speaker-specific commitments
- meeting brief from calendar/history

### Phase 8: Production Hardening

Build:

- packaging/signing/notarization
- diagnostics view
- long-meeting stability
- provider failover strategy
- quota/billing integration
- privacy review
- crash recovery
- QA matrix pass

## Open Technical Decisions

Decide during implementation:

- direct platform APIs vs `cpal` for each capture source
- exact Rust binding split for macOS Core Audio: `objc2-core-audio`, `coreaudio-sys`, or a minimal C/Obj-C shim if required
- WebRTC Audio Processing binding choice
- stdio vs named pipe/socket IPC
- PCM vs Opus between desktop and backend
- continuous silence vs timestamped sparse audio during VAD silence
- whether Electron main or a local Rust network client streams directly to backend
- provider choice for best diarization/latency/cost

## Risks

Main risks:

- macOS system audio capture complexity
- native signing/notarization friction
- AEC tuning difficulty
- Bluetooth device quirks
- VAD clipping speech
- diarization quality variance
- STT provider lock-in
- long-meeting memory/CPU issues

Mitigations:

- test real meeting audio early
- build diagnostics before tuning
- keep processing toggles
- use provider abstraction
- design transcript schema with metadata
- validate packaged builds early

## Definition Of Done

This project is complete when:

- native Rust helper owns mic and system audio capture
- renderer does not use browser capture APIs for production recording
- local VAD, AGC, noise suppression, and echo handling are available
- backend receives source-aware audio frames
- STT provider integration is backend-abstracted
- transcript segments include source, speaker, timing, and confidence metadata
- speaker/name correction exists
- summaries and AI features consume structured transcript data
- app handles permissions, device changes, and failures cleanly
- packaged Windows/macOS builds include signed helper binaries
- diagnostics exist without logging user speech
- long meetings run reliably without memory growth or audio drift
