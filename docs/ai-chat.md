# AI Chat

## Status

This is the working plan for rebuilding Orion AI chat from the ground up. The first delivery is UI-only. Backend behavior, persistence, retrieval, permissions enforcement, model execution, and migrations are intentionally deferred.

The legacy floating `ChatWidget` is not part of the target design and will be removed completely.

## Product decisions

Orion will have two separate chat surfaces with different scopes:

| Surface | Location | Default context | Read access | Write access |
| --- | --- | --- | --- | --- |
| Global chat | Dedicated Chat page from the dashboard sidebar | Entire Orion workspace | Notes, transcripts, summaries, people, attendees, and related workspace data | None |
| Note chat | Right side panel inside an open note | Current note | Current note first, with read-only cross-reference access to other relevant Orion data | Current note only; may update its title, body, summary, attendees, event link, folder, and other editable metadata, but may not delete it or modify another note |

These capability boundaries are part of the UI contract now, but enforcement belongs to the later backend phase.

## Current state

### Legacy dashboard chat removal

- The floating `ChatWidget`, `ChatContext`, and widget-only message/response components have been deleted.
- `ChatProvider` and the commented widget render have been removed from the dashboard.
- The obsolete `chat:activeConversationId` logout-storage key has been removed.
- The dashboard sidebar still has a Chat row whose click handler does nothing until the new global page is built.
- The existing chat API client and query hooks remain temporarily for the later backend phase and are not connected to rendered UI.

### Current note side panel

- `NoteEditorView` has a transcript-only right panel.
- The panel is opened from the note toolbar and is currently `328px` wide.
- It has a Transcript heading, close button, informational banner, and `SavedTranscriptView`.
- There is no Transcript/Chat tab switch yet.

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
  - Model/mode selector.
  - Voice button when available; otherwise omit it without leaving empty space.
  - Send button once text or an attachment is present.
- Recent conversations section below the composer.
- Show the latest three conversations initially.
- Each recent row shows an icon, title, and relative timestamp.
- `See all` opens the complete conversation history in the same page, not a modal.
- A small plus action starts a clean conversation.

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

#### Note toolbar entry points

- Keep the existing Transcript toolbar button.
- Add an `Ask AI` toolbar button beside it.
- Transcript opens or focuses the shared panel on the Transcript tab.
- Ask AI opens or focuses the same panel on the Chat tab.
- Both buttons show an active treatment when their corresponding tab is visible.
- The header tab switch allows moving between Transcript and Chat without closing the panel.

#### Transcript tab

- Move the existing transcript heading semantics into the tab label.
- Retain the transcript information banner and `SavedTranscriptView`.
- Preserve loading, empty, timestamp, speaker alignment, and copy states.
- Do not redesign transcript behavior during the first chat phase beyond fitting it into the shared panel shell.

#### Note-chat empty state

- Begin with a compact current-note context indicator containing the note title.
- Use a short prompt such as `Ask about this note`.
- Offer two or three lightweight suggestion chips based on available note content, for example:
  - `Summarize key decisions`
  - `Find action items`
  - `Who attended?`
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

- `ChatComposer`: prompt input, attachments, model/mode selector, send, stop, and keyboard behavior.
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
  chat-ui-types.ts

desktop/src/features/notes/
  NoteSidePanel.tsx
  NoteEditorView.tsx
  SavedTranscriptView.tsx
```

The UI-only phase should use local fixture data at the view boundary. Shared presentational components must not import API clients or own persisted server state.

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

### Phase 2 - Shared visual foundation

- Build the shared chat message, response, composer, activity, source, and action-card components.
- Add UI fixtures covering short text, long markdown, sources, streaming, errors, and note-change actions.
- Verify light and dark themes, keyboard focus, overflow, and narrow layouts.

### Phase 3 - Global Chat landing page

- Add the `chat` dashboard view and wire the sidebar row.
- Build the greeting, large composer, recent conversations, See all state, and new-chat action.
- Use fixtures only.
- Match the supplied reference's hierarchy, spacing, and low-chrome visual style.

### Phase 4 - Global conversation page

- Add the active-conversation layout, message thread, compact header, bottom composer, loading, streaming, error, copy, retry, and stop states.
- Make the read-only nature visible through content and the absence of write actions rather than a persistent warning banner.

### Phase 5 - Shared note side panel

- Extract the current transcript sidebar from `NoteEditorView` into `NoteSidePanel`.
- Add Transcript and Chat tabs.
- Add Transcript and Ask AI toolbar entry points.
- Preserve all existing transcript presentation states.

### Phase 6 - Note Chat UI

- Build the current-note context state, suggestion chips, conversation thread, source chips, and composer.
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
- Recent conversations and a full-history state are available within the Chat page.
- An active global conversation uses a full-page thread and remains read-only in its available actions.
- Opening a note exposes Transcript and Ask AI entry points into one shared right-side panel.
- The note side panel switches between Transcript and Chat tabs without opening overlapping panels.
- Note chat clearly identifies the current note as primary context.
- Note chat can represent current-note changes and never offers delete or cross-note modification actions.
- Shared chat components are reused across both surfaces.
- No floating `ChatWidget`, legacy widget provider, commented widget render, or widget-only styling remains after cleanup.

## Deferred backend phase

The later backend plan must define conversation persistence, streaming transport, model selection, attachments, retrieval scope, citations, authorization, current-note mutations, undo semantics, audit history, and hard enforcement of the global-read-only and current-note-only write boundaries.
