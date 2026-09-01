export type ChatMessageRole = 'user' | 'assistant'
export type ChatMessageState = 'complete' | 'streaming' | 'failed'

export type ChatActivityKind =
  | 'thinking'
  | 'workspace_search'
  | 'calendar_search'
  | 'web_search'
  | 'reading'
  | 'updating'

export type ChatActivityState = 'running' | 'complete' | 'failed'

export type ChatActivity = {
  id: string
  kind: ChatActivityKind
  state: ChatActivityState
  label: string
  detail?: string
}

export type ChatSourceKind =
  | 'note'
  | 'summary'
  | 'transcript'
  | 'meeting'
  | 'calendar_event'
  | 'attendee'
  | 'folder'
  | 'web'

export type ChatSourceAvailability = 'available' | 'missing' | 'deleted' | 'inaccessible'

export type ChatSource = {
  id: string
  kind: ChatSourceKind
  title: string
  citationIndex?: number
  citationIndices?: number[]
  excerpt?: string
  locationLabel?: string
  resourceId?: string
  availability?: ChatSourceAvailability
  url?: string
  domain?: string
  faviconUrl?: string
  publicationDate?: string
  eventStart?: string
  eventEnd?: string
  calendarName?: string
  eventStatus?: 'confirmed' | 'tentative' | 'cancelled'
  allDay?: boolean
  recurring?: boolean
  timezone?: string
}

export type ChatNoteActionKind =
  | 'title'
  | 'body'
  | 'summary'
  | 'attendees'
  | 'event_link'
  | 'folder'
  | 'metadata'

export type ChatNoteActionState =
  | 'proposed'
  | 'confirmation_required'
  | 'running'
  | 'complete'
  | 'failed'
  | 'stale'
  | 'permission_denied'
  | 'undone'
  | 'undo_unavailable'

export type ChatNoteAction = {
  id: string
  kind: ChatNoteActionKind
  state: ChatNoteActionState
  title: string
  description: string
  detail?: string
}

export type ChatAttachmentKind = 'document' | 'image' | 'audio' | 'unsupported'
export type ChatAttachmentState = 'queued' | 'uploading' | 'ready' | 'failed' | 'rejected'

export type ChatAttachment = {
  id: string
  kind: ChatAttachmentKind
  state: ChatAttachmentState
  name: string
  sizeBytes?: number
  progress?: number
  error?: string
}

export type ChatInternetAccessState = 'enabled' | 'disabled' | 'unavailable'

export type ChatMessageData = {
  id: string
  role: ChatMessageRole
  state: ChatMessageState
  content: string
  error?: string
  sources?: ChatSource[]
  activities?: ChatActivity[]
  actions?: ChatNoteAction[]
}

export type ChatComposerLimits = {
  maxPromptLength?: number
  maxAttachments?: number
  maxAttachmentSizeBytes?: number
}

export type ChatConversationSummary = {
  id: string
  title: string
  updatedAt: string
  updatedLabel: string
}
