export type NoteAssistantMode = 'closed' | 'transcript' | 'chat'

export function toggleNoteAssistantMode(
  currentMode: NoteAssistantMode,
  requestedMode: Exclude<NoteAssistantMode, 'closed'>,
): NoteAssistantMode {
  return currentMode === requestedMode ? 'closed' : requestedMode
}

export function getNoteAssistantChatLabel(hasMessages: boolean): string {
  return hasMessages ? 'Continue chat' : 'Ask anything'
}
