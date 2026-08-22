import { describe, expect, it } from 'vitest'

import { queryKeys } from '@/lib/query-keys'

describe('authenticated query keys', () => {
  it('keeps every server-state family under the account prefix', () => {
    const accountID = 'account-a'
    const keys = [
      queryKeys.folders(accountID),
      queryKeys.notes(accountID),
      queryKeys.note(accountID, 'note-a'),
      queryKeys.notesByFolder(accountID, null),
      queryKeys.notesByEvent(accountID, 'event-a'),
      queryKeys.noteTranscript(accountID, 'note-a'),
      queryKeys.noteVersions(accountID, 'note-a'),
      queryKeys.noteAttendees(accountID, 'note-a'),
      queryKeys.activity(accountID),
      queryKeys.activityFiltered(accountID, { sort: 'updated', direction: 'desc', scope: 'owned' }),
      queryKeys.search(accountID, 'query'),
      queryKeys.calendarEventSearch(accountID, 'note-a', 'query'),
      queryKeys.conversations(accountID),
      queryKeys.conversationsScoped(accountID, { noteID: null, folderID: null }),
      queryKeys.messages(accountID, 'conversation-a'),
      queryKeys.vocabulary(accountID),
      queryKeys.calendarSettings(accountID),
      queryKeys.calendarEvents(accountID),
      queryKeys.billingStatus(accountID),
      queryKeys.extractFields(accountID),
      queryKeys.emailDraftSettings(accountID),
      queryKeys.summaryTemplates(accountID),
    ]
    for (const key of keys) expect(key.slice(0, 2)).toEqual(['account', accountID])
  })
})
