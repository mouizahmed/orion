import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteRecord } from '@/features/notes/types'
import type { NotesInfiniteData } from '@/features/notes/queries/note-cache-transforms'
import { queryKeys } from '@/lib/query-keys'
import { setActiveServerStateAccount } from '@/lib/query-client'

const { createNoteMock, useMutationMock, useQueryClientMock } = vi.hoisted(() => ({
  createNoteMock: vi.fn(),
  useMutationMock: vi.fn((options) => options),
  useQueryClientMock: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useMutation: useMutationMock,
    useQueryClient: useQueryClientMock,
  }
})

vi.mock('@/features/notes/api/notes-client', () => ({
  createFolder: vi.fn(),
  deleteFolder: vi.fn(),
  renameFolder: vi.fn(),
  createNote: createNoteMock,
  deleteNote: vi.fn(),
  enhanceNote: vi.fn(),
  addNoteAttendee: vi.fn(),
  removeNoteAttendee: vi.fn(),
  revertToVersion: vi.fn(),
  updateCalendarLink: vi.fn(),
  updateNote: vi.fn(),
}))

import { useCreateNoteMutation } from '@/features/notes/queries/useNoteMutations'

const accountID = 'account-a'

function pages(notes: NoteRecord[]): NotesInfiniteData {
  return { pages: [{ notes, hasMore: false }], pageParams: [null] }
}

function note(id: string, folderId?: string): NoteRecord {
  return {
    id,
    title: id,
    folderId,
    createdAt: 1,
    updatedAt: 2,
    noteMarkdown: '',
    revision: 1,
  }
}

describe('useCreateNoteMutation', () => {
  let client: QueryClient

  beforeEach(() => {
    client = new QueryClient()
    useMutationMock.mockClear()
    useQueryClientMock.mockReturnValue(client)
    setActiveServerStateAccount(accountID)
  })

  afterEach(() => {
    setActiveServerStateAccount(null)
  })

  it('prepends a created note to its loaded folder cache without duplicating it', () => {
    const existing = note('note-existing', 'folder-a')
    const created = note('note-created', 'folder-a')
    client.setQueryData(queryKeys.notesByFolder(accountID, 'folder-a'), pages([created, existing]))

    useCreateNoteMutation(accountID)
    const options = useMutationMock.mock.calls[0][0] as { onSuccess: (created: NoteRecord) => void }
    options.onSuccess(created)

    expect(client.getQueryData<NotesInfiniteData>(queryKeys.notesByFolder(accountID, 'folder-a'))?.pages[0].notes.map((item) => item.id))
      .toEqual(['note-created', 'note-existing'])
  })

  it('prepends a created note to the loaded unfiled cache', () => {
    const created = note('note-created')
    client.setQueryData(queryKeys.notesByFolder(accountID, null), pages([]))

    useCreateNoteMutation(accountID)
    const options = useMutationMock.mock.calls[0][0] as { onSuccess: (created: NoteRecord) => void }
    options.onSuccess(created)

    expect(client.getQueryData<NotesInfiniteData>(queryKeys.notesByFolder(accountID, null))?.pages[0].notes.map((item) => item.id))
      .toEqual(['note-created'])
  })
})
