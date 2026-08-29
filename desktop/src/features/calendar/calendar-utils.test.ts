import { describe, expect, it } from 'vitest'

import { calendarErrorPresentation } from '@/features/calendar/calendar-utils'

describe('calendarErrorPresentation', () => {
  it('uses a blocking error only when no cached events are available', () => {
    expect(calendarErrorPresentation('Calendar unavailable', 0)).toBe('blocking')
  })

  it('keeps cached events visible when a background refresh fails', () => {
    expect(calendarErrorPresentation('Calendar unavailable', 2)).toBe('inline')
  })

  it('does not show an error state without an error', () => {
    expect(calendarErrorPresentation(null, 0)).toBe('none')
  })
})
