import { describe, expect, it } from 'vitest'

import {
  getNoteAssistantChatLabel,
  toggleNoteAssistantMode,
} from '@/features/notes/note-assistant-state'

describe('note assistant state', () => {
  it('keeps transcript and chat mutually exclusive', () => {
    expect(toggleNoteAssistantMode('closed', 'transcript')).toBe('transcript')
    expect(toggleNoteAssistantMode('transcript', 'chat')).toBe('chat')
    expect(toggleNoteAssistantMode('chat', 'transcript')).toBe('transcript')
  })

  it('closes the currently selected mode when it is selected again', () => {
    expect(toggleNoteAssistantMode('transcript', 'transcript')).toBe('closed')
    expect(toggleNoteAssistantMode('chat', 'chat')).toBe('closed')
  })

  it('describes fresh and active chats differently', () => {
    expect(getNoteAssistantChatLabel(false)).toBe('Ask anything')
    expect(getNoteAssistantChatLabel(true)).toBe('Continue chat')
  })
})
