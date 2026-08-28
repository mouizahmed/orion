import { describe, expect, it } from 'vitest'
import { attendeeInitials, isCurrentUserAttendee } from '@/features/notes/NoteAttendeesDropdown'

describe('attendeeInitials', () => {
  it('uses the first and last words of a display name', () => {
    expect(attendeeInitials('  Ada Lovelace  ', 'ada@example.com')).toBe('AL')
    expect(attendeeInitials('Prince', 'prince@example.com')).toBe('P')
  })

  it('falls back deterministically to the attendee email', () => {
    expect(attendeeInitials('', 'grace@example.com')).toBe('G')
    expect(attendeeInitials('   ', '')).toBe('?')
  })
})

describe('isCurrentUserAttendee', () => {
  it('matches the signed-in email without case or surrounding whitespace', () => {
    expect(isCurrentUserAttendee(' Creator@Example.com ', 'creator@example.com')).toBe(true)
  })

  it('does not label other attendees or users without an email', () => {
    expect(isCurrentUserAttendee('guest@example.com', 'creator@example.com')).toBe(false)
    expect(isCurrentUserAttendee('creator@example.com')).toBe(false)
  })
})
