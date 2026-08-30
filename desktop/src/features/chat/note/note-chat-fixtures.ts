import type { ChatConversationSummary, ChatMessageData, ChatNoteAction, ChatSource } from '@/features/chat/chat-ui-types'

export type NoteChatConversation = ChatConversationSummary & {
  messages: ChatMessageData[]
}

function currentNoteSource(noteId: string, noteTitle: string): ChatSource {
  return {
    id: `note-${noteId}`,
    kind: 'note',
    title: noteTitle,
    resourceId: noteId,
    locationLabel: 'Current note',
    citationIndex: 1,
  }
}

function transcriptSource(noteId: string, noteTitle: string): ChatSource {
  return {
    id: `transcript-${noteId}`,
    kind: 'transcript',
    title: `${noteTitle} transcript`,
    resourceId: noteId,
    locationLabel: '12:18–16:40',
    citationIndex: 2,
  }
}

const relatedNoteSource: ChatSource = {
  id: 'fixture-related-note',
  kind: 'note',
  title: 'Product roadmap and launch decisions',
  resourceId: 'fixture-related-note',
  locationLabel: 'Related note',
  citationIndex: 3,
}

const attendeeSources: ChatSource[] = [
  { id: 'fixture-attendee-amina', kind: 'attendee', title: 'Amina Patel', resourceId: 'fixture-amina', locationLabel: 'Attendee', citationIndex: 2 },
  { id: 'fixture-attendee-jules', kind: 'attendee', title: 'Jules Martin', resourceId: 'fixture-jules', locationLabel: 'Attendee', citationIndex: 3 },
]

function action(id: string, values: Omit<ChatNoteAction, 'id'>): ChatNoteAction {
  return { id, ...values }
}

export function createNoteFixtureResponse(
  messageId: string,
  prompt: string,
  noteId: string,
  noteTitle: string,
): ChatMessageData {
  const normalized = prompt.toLowerCase()
  const note = currentNoteSource(noteId, noteTitle)
  const transcript = transcriptSource(noteId, noteTitle)

  if (normalized.includes('summar') || normalized.includes('key decision')) {
    return {
      id: messageId,
      role: 'assistant',
      state: 'complete',
      content: 'I found the key decisions in the open note and its transcript. I prepared a concise summary for your review. [[1]] [[2]]',
      sources: [note, transcript],
      activities: [{ id: `${messageId}-read`, kind: 'reading', state: 'complete', label: 'Read current note and transcript' }],
      actions: [action(`${messageId}-summary`, {
        kind: 'summary',
        state: 'confirmation_required',
        title: 'Update summary',
        description: 'Replace the current summary with the decisions and next steps found in this note.',
        detail: 'Key decisions\n- Keep the first launch cohort intentionally small.\n- Complete onboarding before the next review.\n\nNext steps\n- Confirm owners and due dates.',
      })],
    }
  }

  if (normalized.includes('action item')) {
    return {
      id: messageId,
      role: 'assistant',
      state: 'complete',
      content: 'I found three action items: finish the onboarding checklist, confirm the launch cohort, and assign an owner to each account. [[1]] [[2]]',
      sources: [note, transcript],
      activities: [{ id: `${messageId}-read`, kind: 'reading', state: 'complete', label: 'Reviewed current note and transcript' }],
    }
  }

  if (normalized.includes('attend') || normalized.includes('who')) {
    return {
      id: messageId,
      role: 'assistant',
      state: 'complete',
      content: 'The attendees referenced for this note are **Amina Patel** and **Jules Martin**. [[2]] [[3]]',
      sources: [note, ...attendeeSources],
      activities: [{ id: `${messageId}-attendees`, kind: 'workspace_search', state: 'complete', label: 'Checked note attendees' }],
    }
  }

  if (normalized.includes('rename') || normalized.includes('title')) {
    return {
      id: messageId,
      role: 'assistant',
      state: 'complete',
      content: 'I can rename the open note. Review the proposed title before applying it.',
      actions: [action(`${messageId}-title`, {
        kind: 'title',
        state: 'proposed',
        title: 'Change title',
        description: 'Rename this note to “Beta launch decisions”.',
      })],
    }
  }

  if (normalized.includes('event') || normalized.includes('calendar')) {
    return {
      id: messageId,
      role: 'assistant',
      state: 'complete',
      content: 'I found the related calendar event, but the fixture could not apply the link.',
      actions: [action(`${messageId}-event`, {
        kind: 'event_link',
        state: 'failed',
        title: 'Could not link event',
        description: 'The selected calendar event is no longer available.',
      })],
    }
  }

  if (normalized.includes('other note') || normalized.includes('cross')) {
    return {
      id: messageId,
      role: 'assistant',
      state: 'complete',
      content: 'A related roadmap note also identifies onboarding as the critical path. I can reference that note, but I can only modify the note currently open. [[1]] [[3]]',
      sources: [note, relatedNoteSource],
      activities: [{ id: `${messageId}-search`, kind: 'workspace_search', state: 'complete', label: 'Searched related Orion notes' }],
    }
  }

  return {
    id: messageId,
    role: 'assistant',
    state: 'complete',
    content: 'I reviewed the open note first. I can answer questions about it, cross-reference other Orion information, or prepare changes for this note. [[1]]',
    sources: [note],
    activities: [{ id: `${messageId}-read`, kind: 'reading', state: 'complete', label: 'Read current note' }],
  }
}

export function createNoteChatHistoryFixtures(noteId: string, noteTitle: string): NoteChatConversation[] {
  const fixtures = [
    { id: 'decisions', title: 'Key decisions', prompt: 'Summarize key decisions', ageMs: 60 * 60 * 1000, updatedLabel: '1h' },
    { id: 'actions', title: 'Action items and owners', prompt: 'Find action items', ageMs: 24 * 60 * 60 * 1000, updatedLabel: '1d' },
    { id: 'attendees', title: 'Meeting attendees', prompt: 'Who attended?', ageMs: 5 * 24 * 60 * 60 * 1000, updatedLabel: '5d' },
  ]

  return fixtures.map((fixture) => {
    const conversationId = `note-${noteId}-${fixture.id}`
    const assistantMessageId = `${conversationId}-assistant`
    return {
      id: conversationId,
      title: fixture.title,
      updatedAt: new Date(Date.now() - fixture.ageMs).toISOString(),
      updatedLabel: fixture.updatedLabel,
      messages: [
        { id: `${conversationId}-user`, role: 'user', state: 'complete', content: fixture.prompt },
        createNoteFixtureResponse(assistantMessageId, fixture.prompt, noteId, noteTitle),
      ],
    }
  })
}
