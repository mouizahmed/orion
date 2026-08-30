import type { ChatConversationSummary, ChatMessageData, ChatSource } from '@/features/chat/chat-ui-types'

export type GlobalConversationFixture = ChatConversationSummary & {
  messages: ChatMessageData[]
}

const launchNoteSource: ChatSource = {
  id: 'global-launch-note',
  kind: 'note',
  title: 'Product roadmap and launch decisions',
  citationIndex: 1,
  resourceId: 'note-1',
  locationLabel: 'Action items',
}

const productReviewSource: ChatSource = {
  id: 'global-product-event',
  kind: 'calendar_event',
  title: 'Weekly product review',
  citationIndex: 2,
  resourceId: 'event-1',
  eventStart: '2026-08-27T14:00:00-04:00',
  eventEnd: '2026-08-27T14:45:00-04:00',
  calendarName: 'Product',
  eventStatus: 'confirmed',
  timezone: 'America/Toronto',
}

export const globalConversationFixtures: GlobalConversationFixture[] = [
  {
    id: 'meeting-actions', title: 'Meeting notes action item extraction', updatedAt: '2026-08-29T19:45:00-04:00', updatedLabel: 'now',
    messages: [
      { id: 'meeting-actions-user', role: 'user', state: 'complete', content: 'What action items came out of the launch meeting?' },
      {
        id: 'meeting-actions-assistant', role: 'assistant', state: 'complete',
        content: 'The launch meeting produced three main action items:\n\n1. **Amina** will finish the onboarding checklist.\n2. **Jules** will confirm the five design partners in the first cohort.\n3. The team will review readiness at the next product meeting. [[1]] [[2]]',
        activities: [
          { id: 'meeting-actions-search', kind: 'workspace_search', state: 'complete', label: 'Searched 12 notes' },
          { id: 'meeting-actions-calendar', kind: 'calendar_search', state: 'complete', label: 'Referenced 1 calendar event' },
        ],
        sources: [launchNoteSource, productReviewSource],
      },
    ],
  },
  {
    id: 'general-inquiry', title: 'General inquiry Aug 27', updatedAt: '2026-08-28T16:20:00-04:00', updatedLabel: '1d',
    messages: [
      { id: 'general-user', role: 'user', state: 'complete', content: 'Who did I meet with about the beta launch?' },
      { id: 'general-assistant', role: 'assistant', state: 'complete', content: 'You met with **Amina Patel** and **Jules Martin** during the weekly product review. [[2]]', sources: [productReviewSource] },
    ],
  },
  {
    id: 'note-editing', title: 'Note editing', updatedAt: '2026-08-28T10:05:00-04:00', updatedLabel: '1d',
    messages: [
      { id: 'note-editing-user', role: 'user', state: 'complete', content: 'Summarize the launch decision.' },
      { id: 'note-editing-assistant', role: 'assistant', state: 'complete', content: 'The team moved the beta launch to **September 14** and kept the first cohort intentionally small. [[1]]', sources: [launchNoteSource] },
    ],
  },
  {
    id: 'beta-launch', title: 'Beta launch decisions', updatedAt: '2026-08-26T14:30:00-04:00', updatedLabel: '3d',
    messages: [
      { id: 'beta-launch-user', role: 'user', state: 'complete', content: 'What did we decide about the beta launch?' },
      { id: 'beta-launch-assistant', role: 'assistant', state: 'complete', content: 'The team chose **September 14** for the beta launch and limited the initial cohort to five design partners. [[1]]', sources: [launchNoteSource] },
    ],
  },
  {
    id: 'customer-follow-up', title: 'Customer follow-up questions', updatedAt: '2026-08-24T09:15:00-04:00', updatedLabel: '5d',
    messages: [
      { id: 'customer-follow-up-user', role: 'user', state: 'complete', content: 'What should I ask in the next customer follow-up?' },
      { id: 'customer-follow-up-assistant', role: 'assistant', state: 'complete', content: 'Ask whether onboarding is clear, which workflow creates the most friction, and what would make the beta immediately useful. These questions align with the launch action items. [[1]]', sources: [launchNoteSource] },
    ],
  },
  {
    id: 'weekly-review', title: 'Weekly review summary', updatedAt: '2026-08-21T11:00:00-04:00', updatedLabel: '1w',
    messages: [
      { id: 'weekly-review-user', role: 'user', state: 'complete', content: 'Summarize the weekly product review.' },
      {
        id: 'weekly-review-assistant', role: 'assistant', state: 'complete',
        content: 'The review focused on launch readiness, onboarding, and the first customer cohort. The next checkpoint is the upcoming weekly product review. [[1]] [[2]]',
        activities: [{ id: 'weekly-review-search', kind: 'workspace_search', state: 'complete', label: 'Referenced 2 Orion sources' }],
        sources: [launchNoteSource, productReviewSource],
      },
    ],
  },
]
