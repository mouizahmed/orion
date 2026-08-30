# AI Chat

## Status

This is the working plan for rebuilding Orion AI chat from the ground up. The first delivery is UI-only. Backend behavior, persistence, retrieval, permissions enforcement, model execution, and migrations are intentionally deferred.

The legacy floating `ChatWidget` is not part of the target design and will be removed completely.

## Product decisions

Orion will have two separate chat surfaces with different scopes:

| Surface | Location | Default context | Read access | Write access |
| --- | --- | --- | --- | --- |
| Global chat | Dedicated Chat page from the dashboard sidebar | Entire Orion workspace | Notes, transcripts, summaries, people, attendees, calendar events, and related workspace data | None |
| Note chat | Right side panel inside an open note | Current note | Current note first, with read-only cross-reference access to other relevant Orion data, including calendar events | Current note only; may update its title, body, summary, attendees, event link, folder, and other editable metadata, but may not delete it, modify another note, or modify a calendar event |

These capability boundaries are part of the UI contract now, but enforcement belongs to the later backend phase.

## Current state

### Legacy dashboard chat removal

- The floating `ChatWidget`, `ChatContext`, and widget-only message/response components have been deleted.
- `ChatProvider` and the commented widget render have been removed from the dashboard.
- The obsolete `chat:activeConversationId` logout-storage key has been removed.
- The dashboard sidebar Chat row opens the fixture-driven global Chat landing page and clears selected note/folder context.
- The existing chat API client and query hooks remain temporarily for the later backend phase and are not connected to rendered UI.

### Global Chat landing page

- Chat is a first-class dashboard view with the standard active sidebar treatment.
- The landing page has the personalized greeting, shared page composer, exactly the three most recently updated conversations, and an in-page full history toggle.
- Conversation history and other display state remain local fixtures; no chat API, persistence, retrieval, or model execution is connected.
- Opening a fixture conversation or submitting a landing-page prompt enters the active global conversation view.

### Active global conversation

- The fixture-driven active view has a compact History/New chat header, centered scrolling thread, and bottom-anchored shared composer.
- Existing fixture conversations demonstrate user and assistant messages, Orion retrieval activity, citations, source chips, and copy behavior.
- New fixture prompts demonstrate streaming geometry, Stop, inline failure, Retry, and completion without calling a model or backend.
- History opens an anchored conversation dropdown without leaving the active thread; it uses the same `Last 3 days`, then calendar-month grouping as the full history view. New chat returns to the clean landing state.
- The global surface remains read-only and never renders note action cards.

### Current note side panel

- `NoteEditorView` opens the extracted `NoteSidePanel` from one clearly labeled Transcript & AI toolbar action.
- The shared panel is `360px` wide and contains a compact Transcript/Chat tab switch with one close action.
- The Transcript tab preserves the existing informational banner and `SavedTranscriptView` presentation states.
- Both tab contents remain mounted while the panel is open so switching tabs does not discard their local UI or scroll position.
- The Chat tab uses the shared narrow conversation, source, composer, and action-card components.
- Note chat includes compact note-scoped History and New chat controls; fixture conversations use the same date grouping as global history.
- Fixture responses demonstrate current-note proposals, running/completed changes, failures, retry, and undo without calling an API or saving changes.

### Overlay

- The meeting overlay has an Ask entry.
- Its current content is only a placeholder and is not the legacy `ChatWidget`.
- Redesigning the meeting overlay Ask experience is not part of this dashboard UI phase.

## Target UI architecture

### 1. Global Chat page

Chat becomes a first-class dashboard view alongside Home, Calendar, My Notes, and People.

#### Entry and routing

- Add `chat` to the dashboard view mode.
- Make the existing Chat sidebar row open the global Chat page.
- Selecting Chat clears the selected note and folder in the same way as other top-level pages.
- The Chat row receives the normal active sidebar treatment.
- No floating chat launcher or widget remains anywhere in the dashboard.

#### New-chat landing state

Match the supplied design reference while using Orion's existing light/dark dashboard tokens:

- Centered content column with a comfortable maximum width around `720px`.
- Greeting: `Hi {firstName}, ask anything`.
- Large rounded composer immediately below the greeting.
- Composer includes:
  - Multiline prompt input.
  - Attachment button.
  - Attachment button beside Send.
  - Send button once text or an attachment is present.
- Recent conversations section below the composer.
- Show the latest three conversations initially.
- Each recent row shows its title and relative timestamp.
- `See all` opens the complete conversation history in the same page, grouped under `Last 3 days` and then calendar months in reverse chronological order.

#### Active-conversation state

- Keep the same centered page shell and visual language as the landing state.
- Show a compact header with:
  - Conversation title.
  - New chat action.
  - Conversation history action.
- Use a vertically scrolling message thread.
- User messages appear as restrained rounded surfaces.
- Assistant messages remain mostly unboxed for readability.
- Keep markdown support for headings, lists, links, tables, inline code, and code blocks.
- Place copy and retry actions on message hover/focus.
- Keep the composer anchored at the bottom of the conversation column.
- Surface read operations as quiet status rows such as `Searched 12 notes` or `Referenced 3 people`.
- Do not show edit/apply controls in global chat because this surface is read-only.

#### Global-chat empty, loading, and error states

- Loading recent conversations uses simple skeleton rows.
- An empty history keeps the greeting and composer as the primary experience.
- Conversation load errors are shown inline with Retry.
- Sending failures preserve the user's draft and provide Retry.
- Streaming shows a subtle assistant activity indicator and a Stop control.

### 2. Note Chat side panel

The current transcript sidebar becomes a shared note side panel rather than creating another floating surface.

#### Panel structure

- Replace `transcriptOpen: boolean` with panel state that represents:
  - Closed.
  - Open on Transcript.
  - Open on Chat.
- Keep one right-side panel container so opening Chat never creates a second sidebar.
- Increase the target width modestly to approximately `360px` so chat remains usable without overpowering the note editor.
- Preserve the current rounded dashboard-panel styling, border, background, and close behavior.
- The header contains a compact `Transcript | Chat` tab switch and one close button.
- Preserve the selected tab while the same note remains open.
- Reset the panel conversation context when a different note is selected.

#### Note toolbar entry point

- Use one `Transcript & AI` toolbar button to make both destinations discoverable without duplicate actions.
- It opens Transcript by default, then remembers the last selected panel tab while the note remains open.
- The same button closes the panel when it is already open and retains an active treatment on either tab.
- The header tab switch allows moving between Transcript and Chat without closing the panel.

#### Transcript tab

- Move the existing transcript heading semantics into the tab label.
- Retain the transcript information banner and `SavedTranscriptView`.
- Preserve loading, empty, timestamp, speaker alignment, and copy states.
- Do not redesign transcript behavior during the first chat phase beyond fitting it into the shared panel shell.

#### Note-chat empty state

- Begin with a compact current-note context indicator containing the note title.
- Use a short prompt such as `Ask about this note`.
- Keep the empty state focused on the composer without quick-action buttons.
- Keep the composer at the bottom of the panel.
- Composer includes attachment/context controls only when they have a real UI purpose; no decorative disabled controls.

#### Note-chat conversation state

- Use the same shared message components as global chat, scaled for the narrower panel.
- Keep assistant responses unboxed and user messages compact.
- Show a small context label when the response references another note, person, meeting, or transcript.
- Read-only cross-references should appear as clickable source chips that can open the relevant Orion surface later.
- The current note remains visually identified as the primary context throughout the thread.

#### Current-note modifications

The UI must make writes easy to understand without building a complex approval system.

- Represent each successful write as an action card inside the thread.
- Action cards state exactly what changed, for example:
  - `Updated note body`
  - `Updated summary`
  - `Added 2 attendees`
  - `Changed title`
- Include `View change` and `Undo` actions when the later backend supports them.
- For a proposed change that requires confirmation, use a compact preview card with `Apply` and `Cancel`.
- Never render a delete-note action.
- Never render an action that writes to a referenced note.
- If the user requests an out-of-scope write, show a neutral capability message explaining that note chat can only modify the open note.

## Shared chat UI system

Build a small shared UI layer instead of duplicating global and note chat:

- `ChatComposer`: prompt input, attachments, send, stop, and keyboard behavior.
- `ChatThread`: scroll behavior, empty/loading/error handling, and message grouping.
- `ChatMessage`: user and assistant presentation.
- `ChatResponse`: markdown rendering.
- `ChatActivityRow`: thinking, search, and tool activity.
- `ChatSourceChip`: references to notes, people, meetings, and transcripts.
- `ChatActionCard`: proposed, running, completed, failed, and undoable current-note changes.
- `ConversationHistory`: recent and full-history lists for global chat.

Global chat and note chat should compose these primitives but own their separate page/panel layouts and capability messaging.

## Proposed frontend structure

```text
desktop/src/features/chat/
  components/
    ChatActionCard.tsx
    ChatActivityRow.tsx
    ChatComposer.tsx
    ChatMessage.tsx
    ChatResponse.tsx
    ChatSourceChip.tsx
    ChatThread.tsx
  global/
    GlobalChatView.tsx
    GlobalChatLanding.tsx
    GlobalConversationHeader.tsx
    ConversationHistory.tsx
  note/
    NoteChatPanel.tsx
    NoteChatEmptyState.tsx
  dev/
    ChatFoundationPreview.tsx
    chat-ui-fixtures.ts
  chat-ui-types.ts

desktop/src/features/notes/
  NoteSidePanel.tsx
  NoteEditorView.tsx
  SavedTranscriptView.tsx
```

Shared presentational components must not import API clients or own persisted server state. Temporary development fixtures exercise presentation states without becoming application data.

## Legacy removal

The initial UI cleanup is complete:

- Deleted `ChatWidget.tsx`.
- Deleted `ChatContext.tsx`.
- Removed `ChatProvider` from `DashboardProviders`.
- Deleted the widget-only AI message and response components.
- Removed widget-specific runtime state and the commented render from `DashboardApp`.
- Removed the obsolete active-conversation storage key.
- No compatibility adapter or legacy widget UI-state migration was added.

The existing desktop API client and backend chat endpoints are outside this UI-only plan. They can remain temporarily unused, then be redesigned or deleted during the backend phase.

## Incremental UI delivery plan

### Phase 1 - Legacy UI cleanup (complete)

- Remove the widget, context provider, old presentation components, dashboard wiring, and obsolete local UI storage.
- Confirm no rendered desktop code imports the removed UI.
- Preserve the API/query layer for the separately scoped backend phase.

### Phase 2 - Shared visual foundation (complete)

#### Goal

Create the reusable, UI-only building blocks used by both global chat and note chat. Phase 2 does not add the Chat dashboard page, place chat inside the note panel, connect an API, persist conversations, or implement AI behavior.

All components are controlled and receive display data and event callbacks through props. They must not import `chat-client.ts`, query hooks, authentication, note mutations, or dashboard contexts.

Phase 2 must be presentation-ready for citations from both Orion data and future internet access. It includes Orion-resource locations, web-search activity, external-source metadata, and shared citation UI, but it does not fetch Orion resources, make network requests, add a browser/search tool, or decide whether global chat, note chat, or both may use the internet. Those permissions and their enforcement are finalized with the backend phase.

#### Shared UI types

Add a small presentation-only type file at `desktop/src/features/chat/chat-ui-types.ts`.

Define only the types needed to render the foundation:

- Message role: user or assistant.
- Message state: complete, streaming, or failed.
- Activity kind: thinking, workspace search, calendar search, web search, reading, or updating.
- Activity state: running, complete, or failed.
- Source kind: note, summary, transcript, person, meeting, calendar event, attendee, folder, or web.
- Note action kind: title, body, summary, attendees, event link, folder, or metadata.
- Note action state: proposed, confirmation required, running, complete, failed, stale, permission denied, undone, or undo unavailable.
- Attachment kind: document, image, audio, or unsupported.
- Attachment state: queued, uploading, ready, failed, or rejected.
- Internet access state: available and enabled, available and disabled, or unavailable.

These are UI types, not copies of backend request or database models.

Citation presentation is source-agnostic. Every Orion or web source may include a citation index, title, excerpt, and an optional location within the source.

Orion-source presentation data should allow a resource ID and a typed location such as a note section, summary section, transcript timestamp range, person or attendee identity, meeting, calendar event, or folder. Calendar-event sources should also allow start time, end time, calendar name, and event status. This is enough for the UI to explain and eventually open the cited location without importing backend models.

Calendar-event presentation must account for all-day events, recurrence, cancellation, multiple calendars, and timezone-aware date labels.

Web-source presentation data should additionally allow an optional URL, domain, favicon URL, and publication date. The shared types describe how internet results are presented; they do not perform network access or decide when web search is allowed.

#### Components

##### `ChatResponse`

Purpose: render assistant text consistently in both page and panel layouts.

- Use the existing `react-markdown` and `remark-gfm` dependencies.
- Support paragraphs, headings, lists, links, blockquotes, tables, inline code, and fenced code blocks.
- Open external links safely.
- Use existing light/dark neutral colors rather than dark-only hard-coded text colors.
- Keep code blocks readable with horizontal scrolling.
- Wrap wide tables in their own horizontal overflow container.
- Preserve partial content while streaming without a separate renderer.
- Render compact numbered citation markers that correspond to the message's source list.
- Treat citation markers identically whether they point to Orion data or a web source.
- Do not add syntax-highlighting infrastructure in this phase.

##### `ChatSourceChip`

Purpose: show what Orion referenced without turning sources into large cards.

- Display a source-type icon and a short label.
- For Orion sources, show the resource type and useful location metadata such as a note section or transcript timestamp.
- For calendar events, show the event date/time and calendar context without exposing internal IDs.
- For web sources, show the domain and external-source treatment without exposing a raw long URL.
- Allow an optional citation index so every source can correspond to a citation marker in an assistant response.
- Truncate long titles while retaining the full accessible name and tooltip.
- Render as a button only when `onOpen` is provided; otherwise render as non-interactive metadata.
- Orion-source actions will later open the relevant resource or cited location inside Orion.
- Web-source actions must use safe external-link behavior when later connected.
- Support unavailable, deleted, or inaccessible source states without offering a broken open action.
- Deduplicate repeated sources at the message boundary while allowing the same source to support multiple citation markers.
- Allow an optional compact source preview containing the excerpt and location metadata; the owning view decides whether previews open on click or keyboard activation.
- Support wrapping groups of source chips on narrow layouts.
- Provide hover, active, disabled, and keyboard-focus states.

##### `ChatActivityRow`

Purpose: quietly communicate thinking, retrieval, and update activity.

- Show a compact icon, label, and running/completed/failed state.
- Include dedicated workspace-search, calendar-search, and web-search labels so users can distinguish Orion retrieval from calendar retrieval and internet retrieval.
- Use a spinner only for running activity.
- Use restrained success/error treatment; activity must not compete with the answer.
- Allow optional expandable detail text, closed by default.
- Expose status semantics with `role="status"` and appropriate live-region behavior for running updates.

##### `ChatActionCard`

Purpose: represent changes that note chat may make to the current note.

- Support proposed, confirmation-required, running, complete, failed, stale, permission-denied, undone, and undo-unavailable presentations.
- Show the affected field and a plain-language summary of the change.
- Proposed state may expose Apply and Cancel.
- Complete state may expose View change and Undo.
- Failed state may expose Retry when a callback is provided.
- Stale state explains that the note changed since the proposal was created and requires a refreshed proposal.
- Permission-denied and undo-unavailable states remain informative and do not show unusable controls.
- Buttons only appear when their callback exists.
- Do not include delete-note or cross-note-write variants.
- Global chat will never render this component.
- Keep the card compact enough for the note side panel.

##### `ChatMessage`

Purpose: provide the shared message shell around content, sources, activity, errors, and actions.

- User messages use a subtle rounded surface aligned to the end.
- Assistant messages remain mostly unboxed and aligned to the start.
- Assistant text is rendered through `ChatResponse`.
- Allow optional source chips, activity rows, and action cards beneath assistant content.
- Complete messages expose Copy on hover and keyboard focus.
- Failed messages show an inline error and optional Retry.
- Streaming messages use the same layout as complete messages to prevent a visual jump at completion.
- Use `min-width: 0`, word breaking, and overflow guards for long content.

##### `ChatComposer`

Purpose: provide one controlled composer with page and panel variants.

- Controlled props: value, onValueChange, onSubmit, disabled, submitting, and onStop.
- Variants:
  - `page`: large composer used by global chat.
  - `panel`: compact composer used by note chat.
- Optional controls are explicit props: attachments and internet access.
- Do not render a control when its callback or options are unavailable.
- Internet access uses a clear enabled/disabled state and communicates when a request may use an external search provider.
- Attachment presentation supports queued, uploading, ready, failed, rejected, removable, and unsupported states.
- Show file name, type, progress when known, and a concise validation error.
- Enforce configurable prompt length, attachment count, and attachment-size limits in the UI and expose visible validation messages.
- Enter submits; Shift+Enter inserts a newline.
- IME composition must never submit prematurely.
- Empty or whitespace-only input cannot submit.
- Auto-grow the textarea to a documented maximum height, then scroll internally.
- While submitting, replace Send with Stop when `onStop` exists.
- Preserve the draft on a failed submit; clearing it remains the owning view's responsibility.
- Use real buttons with accessible names and visible focus states.
- Respect `prefers-reduced-motion` for auto-grow, loading, and control transitions.

#### Component composition

The dependency direction stays simple:

```text
ChatMessage
  -> ChatResponse
  -> ChatSourceChip
  -> ChatActivityRow
  -> ChatActionCard

ChatComposer is independent.
```

Do not create a generic chat context, global state store, or universal container component in Phase 2. Page scrolling, conversation headers, message fetching, note context, and side-panel behavior belong to later phases.

#### Temporary fixtures and manual gallery

- Keep serializable development fixtures for messages, markdown, Orion and web citations, calendar edge cases, activity, streaming, failures, note actions, attachments, model states, and composer validation.
- Render them in a development-only `ChatFoundationPreview` at `?view=chat-foundation`.
- The gallery may switch between light/dark and `720px`, `360px`, and `320px` widths.
- It must remain disconnected from APIs, authentication, production navigation, and persisted state.
- This gallery is temporary manual testing infrastructure and should be removed after the complete chat UI is stable.
- Do not add automated desktop component tests or new test-only dependencies for Phase 2.

#### Styling rules

- Reuse Orion's existing neutral palette, rounded surfaces, `Button`, `cn`, focus-ring conventions, and scrollbar treatment.
- Use violet only for meaningful AI emphasis or current-note actions, not as the base color of every chat element.
- Support both light and dark themes in each component rather than styling the preview container as a workaround.
- Keep font sizes aligned with the dashboard: mostly `text-xs` and `text-sm`.
- Use variant props for page-versus-panel density; do not fork duplicate component files.
- Avoid component-specific global CSS unless markdown content requires a selector that cannot be expressed locally.
- Hover-only actions must also become visible through keyboard focus.
- Motion must remain understandable when animation is disabled through `prefers-reduced-motion`.

#### Visual and manual verification

Use the temporary development gallery to verify the shared components, then repeat the checks as they are integrated into the global and note chat surfaces:

- Light theme.
- Dark theme.
- Page width around `720px`.
- Note-panel width at `360px`.
- Narrow stress width at `320px`.
- Keyboard-only navigation from the first interactive control to the last.
- Long markdown, long source titles, long code lines, wide tables, and a maximally grown composer.
- Numbered Orion and web citations paired with their source chips.

Confirm:

- No horizontal overflow escapes the fixture container.
- Code blocks and tables scroll internally when necessary.
- Focus indicators remain visible and are not clipped.
- Hover actions are reachable by keyboard.
- Text contrast and disabled states remain legible in both themes.
- Streaming and completion use the same geometry.
- Action-card controls wrap cleanly in the note-panel width.
- Reduced-motion mode removes nonessential animation without hiding status changes.
- Composer validation remains visible and associated with the relevant input or attachment.

#### Implementation order

1. Add presentation types and temporary fixtures.
2. Build and verify `ChatResponse`.
3. Build `ChatSourceChip`, `ChatActivityRow`, and `ChatActionCard`.
4. Compose those pieces in `ChatMessage`.
5. Build the page and panel variants of `ChatComposer`.
6. Add the temporary development-only manual gallery.
7. Run TypeScript and lint.
8. Complete visual, theme, width, focus, and overflow verification in the gallery and again when components are integrated.

#### Phase 2 completion criteria

- Every planned shared component exists and is backend-independent.
- Shared types and temporary fixtures cover citations from Orion data and the web without fetching either source.
- Attachment, model/mode, internet-access, calendar edge-case, citation failure, and action safeguard states are covered.
- Global and note chat can reuse the same message and composer primitives without conditional product logic inside them.
- Components include light/dark, focus, reduced-motion, and narrow-layout styling.
- All temporary fixture states render in the development-only gallery.
- TypeScript and lint pass.
- No dashboard route, note-panel integration, API connection, or conversation persistence is implemented yet.

### Phase 3 - Global Chat landing page (complete)

- Add the `chat` dashboard view and wire the sidebar row.
- Build the greeting, large composer, recent conversations, See all state, and new-chat action.
- Use fixtures only.
- Match the supplied reference's hierarchy, spacing, and low-chrome visual style.

### Phase 4 - Global conversation page (complete)

- Add the active-conversation layout, message thread, compact header, bottom composer, loading, streaming, error, copy, retry, and stop states.
- Make the read-only nature visible through content and the absence of write actions rather than a persistent warning banner.

### Phase 5 - Shared note side panel (complete)

- Extract the current transcript sidebar from `NoteEditorView` into `NoteSidePanel`.
- Add Transcript and Chat tabs.
- Add one Transcript & AI toolbar entry point for the shared panel.
- Preserve all existing transcript presentation states.

### Phase 6 - Note Chat UI (complete)

- Build the current-note conversation thread, source chips, and composer.
- Add note-scoped conversation history and a new-chat state.
- Add fixture-driven current-note action cards for preview, running, success, failure, and undo states.
- Verify switching tabs does not disturb the note editor draft or transcript scroll state.

### Phase 7 - UI verification

- Verify keyboard-only navigation and visible focus states.
- Verify screen-reader names for composer controls, tabs, conversation rows, action cards, and close buttons.
- Verify empty, loading, long-content, error, offline, streaming, and stopped states.
- Verify common dashboard window sizes and minimum usable width.
- Verify global chat cannot present write actions.
- Verify note chat never presents delete or cross-note write actions.

## UI acceptance criteria

- Chat opens as a full dashboard page from the sidebar.
- The new-chat landing state closely follows the supplied visual reference.
- The Chat landing page shows the latest three conversations; its full-history state and the active-thread History dropdown group all conversations under `Last 3 days` and then calendar months.
- An active global conversation uses a full-page thread and remains read-only in its available actions.
- Opening a note exposes one Transcript & AI entry point into a shared right-side panel with Transcript and Chat tabs.
- The note side panel switches between Transcript and Chat tabs without opening overlapping panels.
- Note chat clearly identifies the current note as primary context.
- Note chat can represent current-note changes and never offers delete or cross-note modification actions.
- Shared chat components are reused across both surfaces.
- No floating `ChatWidget`, legacy widget provider, commented widget render, or widget-only styling remains after cleanup.

## Deferred backend phase

The later backend plan must define conversation persistence, streaming transport, model selection, attachments, Orion retrieval scope, calendar-event search and visibility rules, internet-search availability by chat surface, search-provider/tool execution, web-source normalization, citation grounding, external-content safety, authorization, current-note mutations, undo semantics, audit history, and hard enforcement of the global-read-only and current-note-only write boundaries.
