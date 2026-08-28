import { describe, expect, it } from 'vitest'

import { hasPersonEmail } from '@/features/people/PeopleView'

describe('hasPersonEmail', () => {
  const people = [{ email: 'existing@example.com' }]

  it('matches duplicate emails without case or surrounding whitespace', () => {
    expect(hasPersonEmail(people, ' Existing@Example.com ')).toBe(true)
  })

  it('allows a different email', () => {
    expect(hasPersonEmail(people, 'new@example.com')).toBe(false)
  })
})
