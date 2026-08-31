import { describe, expect, it } from 'vitest'

import { shareAttendeesFromNote } from '@/features/notes/dialogs/ShareNoteDialog'
import type { NoteDetail } from '@/features/notes/types'

function note(overrides: Partial<NoteDetail> = {}): NoteDetail {
  return {
    id: 'note-1',
    title: 'Note',
    noteMarkdown: '',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    linkedEvent: null,
    attendees: [],
    ...overrides,
  }
}

describe('shareAttendeesFromNote', () => {
  it('uses the canonical note attendees without another lookup', () => {
    const result = shareAttendeesFromNote(note({
      attendees: [{
        id: 'attendee-1',
        noteId: 'note-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        source: 'manual',
        createdAt: '2026-08-29T00:00:00Z',
      }],
      linkedEvent: {
        id: 'event-1',
        providerEventId: 'provider-event-1',
        connectionId: 'connection-1',
        calendarId: 'calendar-1',
        provider: 'google',
        title: 'Meeting',
        start: '2026-08-29T12:00:00Z',
        color: '#9f73f2',
        historical: false,
        attendees: [{ name: 'Grace Hopper', email: 'grace@example.com' }],
      },
    }))

    expect(result).toEqual([{ name: 'Ada Lovelace', email: 'ada@example.com' }])
  })

  it('drops blank emails and de-duplicates normalized addresses', () => {
    const result = shareAttendeesFromNote(note({
      attendees: [
        {
          id: 'attendee-1',
          noteId: 'note-1',
          name: 'Ada',
          email: ' Ada@Example.com ',
          source: 'calendar',
          createdAt: '2026-08-29T00:00:00Z',
        },
        {
          id: 'attendee-2',
          noteId: 'note-1',
          name: 'Duplicate',
          email: 'ada@example.com',
          source: 'manual',
          createdAt: '2026-08-29T00:00:01Z',
        },
        {
          id: 'attendee-3',
          noteId: 'note-1',
          name: 'No email',
          email: '   ',
          source: 'manual',
          createdAt: '2026-08-29T00:00:02Z',
        },
      ],
    }))

    expect(result).toEqual([{ name: 'Ada', email: 'Ada@Example.com' }])
  })
})
