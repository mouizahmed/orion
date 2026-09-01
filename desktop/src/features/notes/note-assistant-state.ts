export type NoteAssistantMode = 'closed' | 'transcript' | 'chat'
export type ActiveNoteAssistantMode = Exclude<NoteAssistantMode, 'closed'>
export type NoteAssistantPhase = 'opening' | 'open' | 'closing'

export type NoteAssistantState = {
  mode: ActiveNoteAssistantMode
  phase: NoteAssistantPhase
} | null

export type NoteAssistantAction =
  | { type: 'toggle'; mode: ActiveNoteAssistantMode }
  | { type: 'close' }
  | { type: 'animation-complete' }
  | { type: 'reset' }

export function noteAssistantReducer(
  state: NoteAssistantState,
  action: NoteAssistantAction,
): NoteAssistantState {
  switch (action.type) {
    case 'toggle':
      if (!state) return { mode: action.mode, phase: 'opening' }
      if (state.mode !== action.mode) return state
      return {
        ...state,
        phase: state.phase === 'closing' ? 'opening' : 'closing',
      }
    case 'close':
      if (!state || state.phase === 'closing') return state
      return { ...state, phase: 'closing' }
    case 'animation-complete':
      if (!state) return state
      if (state.phase === 'opening') return { ...state, phase: 'open' }
      if (state.phase === 'closing') return null
      return state
    case 'reset':
      return null
  }
}

export function getNoteAssistantChatLabel(hasMessages: boolean): string {
  return hasMessages ? 'Continue chat' : 'Ask anything'
}
