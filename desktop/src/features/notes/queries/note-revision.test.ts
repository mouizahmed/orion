import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteDetail } from '@/features/notes/types'
import { queryKeys } from '@/lib/query-keys'

const { getNoteMock } = vi.hoisted(() => ({
  getNoteMock: vi.fn(),
}))

vi.mock('@/features/notes/api/notes-client', () => ({
  getNote: getNoteMock,
  listNotesByEvent: vi.fn(),
  listNotesPage: vi.fn(),
  listVersions: vi.fn(),
}))

import { resolveNoteRevision } from '@/features/notes/queries/note-revision'

const accountID = 'account-a'
const noteID = 'note-a'
const note: NoteDetail = {
  id: noteID,
  title: 'Note',
  noteMarkdown: 'Body',
  revision: 4,
  createdAt: 1,
  updatedAt: 2,
  linkedEvent: null,
  attendees: [],
}

describe('resolveNoteRevision', () => {
  beforeEach(() => {
    getNoteMock.mockReset()
  })

  it('uses the canonical detail cache when it is available', async () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.note(accountID, noteID), note)

    await expect(resolveNoteRevision(client, accountID, noteID)).resolves.toBe(4)
    expect(getNoteMock).not.toHaveBeenCalled()
  })

  it('fetches detail before updating a note that has not been opened', async () => {
    const client = new QueryClient()
    getNoteMock.mockResolvedValue(note)

    await expect(resolveNoteRevision(client, accountID, noteID)).resolves.toBe(4)
    expect(getNoteMock).toHaveBeenCalledWith(accountID, noteID, expect.any(AbortSignal))
  })

  it('refetches legacy cached detail without a valid revision', async () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.note(accountID, noteID), { ...note, revision: undefined })
    getNoteMock.mockResolvedValue(note)

    await expect(resolveNoteRevision(client, accountID, noteID)).resolves.toBe(4)
    expect(getNoteMock).toHaveBeenCalledOnce()
  })

  it('does not permit an update when canonical detail is missing', async () => {
    const client = new QueryClient()
    getNoteMock.mockResolvedValue(null)

    await expect(resolveNoteRevision(client, accountID, noteID)).rejects.toThrow('note not found')
  })
})
