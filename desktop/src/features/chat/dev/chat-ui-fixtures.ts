import type {
  ChatActivity,
  ChatAttachment,
  ChatMessageData,
  ChatNoteAction,
  ChatSource,
} from '@/features/chat/chat-ui-types'

export const orionSources: ChatSource[] = [
  { id: 'note-roadmap', kind: 'note', title: 'Product roadmap and launch decisions', citationIndex: 1, resourceId: 'note-1', locationLabel: 'Decisions section', excerpt: 'The team agreed to move the beta launch to September 14.' },
  { id: 'summary-roadmap', kind: 'summary', title: 'Product roadmap summary', citationIndex: 2, resourceId: 'note-1', locationLabel: 'Key outcomes', excerpt: 'Beta launch moved to September 14 with onboarding as the critical path.' },
  { id: 'transcript-roadmap', kind: 'transcript', title: 'Product roadmap transcript', citationIndex: 3, resourceId: 'transcript-1', locationLabel: '18:42–19:17', excerpt: 'Let us use September 14 and keep the first cohort intentionally small.' },
  { id: 'attendee-amina', kind: 'attendee', title: 'Amina Patel', citationIndex: 4, resourceId: 'attendee-1', locationLabel: 'Attendee' },
  { id: 'attendee-jules', kind: 'attendee', title: 'Jules Martin', citationIndex: 5, resourceId: 'attendee-2', locationLabel: 'Attendee' },
  { id: 'meeting-launch', kind: 'meeting', title: 'Beta launch review', citationIndex: 6, resourceId: 'meeting-1', locationLabel: '45 minutes' },
  { id: 'folder-planning', kind: 'folder', title: 'Planning and strategy', citationIndex: 7, resourceId: 'folder-1', locationLabel: '12 notes' },
]

export const calendarSources: ChatSource[] = [
  { id: 'event-review', kind: 'calendar_event', title: 'Weekly product review', citationIndex: 8, resourceId: 'event-1', eventStart: '2026-09-02T14:00:00-04:00', eventEnd: '2026-09-02T14:45:00-04:00', calendarName: 'Product', eventStatus: 'confirmed', timezone: 'America/Toronto', recurring: true },
  { id: 'event-offsite', kind: 'calendar_event', title: 'Company offsite', citationIndex: 9, resourceId: 'event-2', eventStart: '2026-09-18T00:00:00-04:00', eventEnd: '2026-09-19T00:00:00-04:00', calendarName: 'Company', eventStatus: 'tentative', allDay: true, timezone: 'America/Toronto' },
  { id: 'event-cancelled', kind: 'calendar_event', title: 'Cancelled customer check-in', citationIndex: 10, resourceId: 'event-3', eventStart: '2026-09-04T10:00:00+01:00', eventEnd: '2026-09-04T10:30:00+01:00', calendarName: 'Customers', eventStatus: 'cancelled', timezone: 'Europe/London' },
]

export const webSources: ChatSource[] = [
  { id: 'web-release', kind: 'web', title: 'Designing dependable AI interfaces', citationIndex: 11, url: 'https://example.com/dependable-ai-interfaces', domain: 'example.com', faviconUrl: '/orion-mark.svg', publicationDate: '2026-08-20', excerpt: 'Clear source attribution and reversible actions increase user confidence.' },
  { id: 'web-long-title', kind: 'web', title: 'An intentionally very long article title used to verify truncation inside a narrow note-chat side panel without allowing horizontal overflow', citationIndex: 12, url: 'https://example.org/long-title', domain: 'example.org', publicationDate: '2026-08-18' },
]

export const unavailableSources: ChatSource[] = [
  { id: 'deleted-note', kind: 'note', title: 'Deleted planning note', citationIndex: 13, availability: 'deleted' },
  { id: 'private-note', kind: 'note', title: 'Restricted note', citationIndex: 14, availability: 'inaccessible' },
  { id: 'missing-web', kind: 'web', title: 'Missing web result', citationIndex: 15, availability: 'missing' },
]

export const activities: ChatActivity[] = [
  { id: 'thinking', kind: 'thinking', state: 'running', label: 'Thinking' },
  { id: 'workspace', kind: 'workspace_search', state: 'complete', label: 'Searched 18 notes', detail: 'Matched roadmap, launch, and onboarding notes.' },
  { id: 'calendar', kind: 'calendar_search', state: 'complete', label: 'Found 3 calendar events', detail: 'Searched Product, Company, and Customers calendars.' },
  { id: 'web', kind: 'web_search', state: 'running', label: 'Searching the web' },
  { id: 'web-failed', kind: 'web_search', state: 'failed', label: 'Web search failed', detail: 'The search provider could not be reached.' },
]

export const noteActions: ChatNoteAction[] = [
  { id: 'action-draft', kind: 'title', state: 'proposed', title: 'Rename note', description: 'Rename this note to “Beta launch decisions”.' },
  { id: 'action-proposed', kind: 'summary', state: 'confirmation_required', title: 'Update summary', description: 'Replace the current summary with a concise decisions and next-steps format.', detail: 'Decisions\n- Move beta launch to September 14\n\nNext steps\n- Finish onboarding checklist' },
  { id: 'action-running', kind: 'attendees', state: 'running', title: 'Add 2 attendees', description: 'Adding Amina Patel and Jules Martin to this note.' },
  { id: 'action-complete', kind: 'body', state: 'complete', title: 'Updated note body', description: 'Added the decisions and action items discussed in the transcript.' },
  { id: 'action-failed', kind: 'event_link', state: 'failed', title: 'Could not link event', description: 'The selected calendar event is no longer available.' },
  { id: 'action-stale', kind: 'title', state: 'stale', title: 'Rename note', description: 'The note changed after this proposal was created. Refresh the proposal before applying it.' },
  { id: 'action-denied', kind: 'metadata', state: 'permission_denied', title: 'Edit another note', description: 'Note chat can only modify the note currently open.' },
  { id: 'action-undone', kind: 'folder', state: 'undone', title: 'Folder change undone', description: 'The note was returned to its previous folder.' },
  { id: 'action-undo-unavailable', kind: 'summary', state: 'undo_unavailable', title: 'Undo unavailable', description: 'A newer edit replaced this version of the summary.' },
]

export const attachments: ChatAttachment[] = [
  { id: 'attachment-queued', kind: 'document', state: 'queued', name: 'research-notes.txt', sizeBytes: 42_000 },
  { id: 'attachment-ready', kind: 'document', state: 'ready', name: 'launch-brief.pdf', sizeBytes: 384_000 },
  { id: 'attachment-uploading', kind: 'audio', state: 'uploading', name: 'customer-call.m4a', sizeBytes: 4_200_000, progress: 62 },
  { id: 'attachment-failed', kind: 'image', state: 'failed', name: 'whiteboard.png', sizeBytes: 1_200_000, error: 'Upload failed' },
  { id: 'attachment-rejected', kind: 'unsupported', state: 'rejected', name: 'archive.exe', sizeBytes: 900_000, error: 'This file type is not supported' },
]

export const shortMessages: ChatMessageData[] = [
  { id: 'short-user', role: 'user', state: 'complete', content: 'Who did I meet with about the beta launch?' },
  { id: 'short-assistant', role: 'assistant', state: 'complete', content: 'You discussed the beta launch with **Amina Patel** and **Jules Martin**. [[1]] [[4]] [[5]]', sources: [orionSources[0], orionSources[3], orionSources[4]] },
]

export const longMarkdownMessage: ChatMessageData = {
  id: 'long-markdown', role: 'assistant', state: 'complete',
  content: `## Launch review

The team moved the beta launch to **September 14** and identified onboarding as the critical path. [[1]] [[2]]

> Keep the first cohort intentionally small so support can respond quickly.

### Priorities

1. Finish the onboarding checklist.
2. Confirm the launch cohort.
   - Include five design partners.
   - Assign an owner to each account.
3. Review progress at the next product meeting. [[8]]

| Owner | Task | Status |
| --- | --- | --- |
| Amina | Onboarding | In progress |
| Jules | Cohort list | Ready |

Use \`launchWindow\` for the configured date:

\`\`\`ts
const launchWindow = { date: '2026-09-14', cohortSize: 5 }
\`\`\`

Long-token stress test: this-is-an-intentionally-long-unbroken-token-that-must-never-force-the-message-container-beyond-its-available-width-1234567890.

[Read the external interface guidance](https://example.com/dependable-ai-interfaces). [[11]]`,
  sources: [orionSources[0], orionSources[1], calendarSources[0], webSources[0]],
}

export const streamingMessage: ChatMessageData = { id: 'streaming', role: 'assistant', state: 'streaming', content: 'I found three meetings connected to the launch plan. The most recent one', activities: [activities[1], activities[2]] }
export const failedMessage: ChatMessageData = { id: 'failed', role: 'assistant', state: 'failed', content: 'I started reviewing the launch notes but could not finish.', error: 'The response was interrupted. Your message was preserved.' }
