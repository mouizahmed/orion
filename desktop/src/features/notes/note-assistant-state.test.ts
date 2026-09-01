import { describe, expect, it } from 'vitest'

import {
  getNoteAssistantChatLabel,
  noteAssistantReducer,
} from '@/features/notes/note-assistant-state'

describe('note assistant state', () => {
  it('describes fresh and active chats differently', () => {
    expect(getNoteAssistantChatLabel(false)).toBe('Ask anything')
    expect(getNoteAssistantChatLabel(true)).toBe('Continue chat')
  })

  it('opens, closes, and completes surface transitions', () => {
    const opening = noteAssistantReducer(null, { type: 'toggle', mode: 'transcript' })
    expect(opening).toEqual({ mode: 'transcript', phase: 'opening' })

    const open = noteAssistantReducer(opening, { type: 'animation-complete' })
    expect(open).toEqual({ mode: 'transcript', phase: 'open' })

    const closing = noteAssistantReducer(open, { type: 'close' })
    expect(closing).toEqual({ mode: 'transcript', phase: 'closing' })
    expect(noteAssistantReducer(closing, { type: 'animation-complete' })).toBeNull()
  })

  it('reverses an in-progress transition when toggled repeatedly', () => {
    const opening = { mode: 'transcript', phase: 'opening' } as const
    const closing = noteAssistantReducer(opening, { type: 'toggle', mode: 'transcript' })
    expect(closing).toEqual({ mode: 'transcript', phase: 'closing' })
    expect(noteAssistantReducer(closing, { type: 'toggle', mode: 'transcript' })).toEqual(opening)
  })

  it('ignores another mode while a surface is active', () => {
    const open = { mode: 'chat', phase: 'open' } as const
    expect(noteAssistantReducer(open, { type: 'toggle', mode: 'transcript' })).toBe(open)
  })
})
