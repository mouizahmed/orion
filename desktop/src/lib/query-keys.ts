export const queryKeys = {
  account: (accountID: string) => ['account', accountID] as const,
  folders: (accountID: string) => ['account', accountID, 'folders'] as const,
  notes: (accountID: string) => ['account', accountID, 'notes'] as const,
  note: (accountID: string, noteID: string) => ['account', accountID, 'notes', 'detail', noteID] as const,
  notesByFolder: (accountID: string, folderID: string | null) =>
    ['account', accountID, 'notes', 'by-folder', folderID ?? 'unfiled'] as const,
  notesByEvent: (accountID: string, eventID: string) => ['account', accountID, 'notes', 'by-event', eventID] as const,
  noteTranscript: (accountID: string, noteID: string) => ['account', accountID, 'notes', 'transcript', noteID] as const,
  noteAttendees: (accountID: string, noteID: string) => ['account', accountID, 'notes', 'attendees', noteID] as const,
  activity: (accountID: string) => ['account', accountID, 'activity'] as const,
  activityFiltered: (accountID: string, filters: { sort: string; direction: string; scope: string }) =>
    ['account', accountID, 'activity', filters] as const,
  search: (accountID: string, normalizedQuery: string) => ['account', accountID, 'search', normalizedQuery] as const,
  calendarEventSearch: (accountID: string, noteID: string, normalizedQuery: string) =>
    ['account', accountID, 'calendar-event-search', noteID, normalizedQuery] as const,
  conversations: (accountID: string) => ['account', accountID, 'chat', 'conversations'] as const,
  conversationsScoped: (accountID: string, scope: { noteID: string | null; folderID: string | null }) =>
    ['account', accountID, 'chat', 'conversations', scope] as const,
  messages: (accountID: string, conversationID: string) =>
    ['account', accountID, 'chat', 'messages', conversationID] as const,
  vocabulary: (accountID: string) => ['account', accountID, 'vocabulary'] as const,
  calendarSettings: (accountID: string) => ['account', accountID, 'calendar-settings'] as const,
  calendarEvents: (accountID: string) => ['account', accountID, 'calendar-events'] as const,
  billingStatus: (accountID: string) => ['account', accountID, 'billing-status'] as const,
  extractFields: (accountID: string) => ['account', accountID, 'extract-fields'] as const,
  emailDraftSettings: (accountID: string) => ['account', accountID, 'email-draft-settings'] as const,
  summaryTemplates: (accountID: string) => ['account', accountID, 'summary-templates'] as const,
}
