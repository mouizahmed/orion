import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { NoteAttendee, NoteDetail, NoteRecord } from '@/features/notes/types'
import type { NotesInfiniteData } from '@/features/notes/queries/note-cache-transforms'
import { queryKeys } from '@/lib/query-keys'
import { setActiveServerStateAccount } from '@/lib/query-client'

const { addNoteAttendeeMock, createNoteMock, removeNoteAttendeeMock, useMutationMock, useQueryClientMock } = vi.hoisted(() => ({
  addNoteAttendeeMock: vi.fn(),
  createNoteMock: vi.fn(),
  removeNoteAttendeeMock: vi.fn(),
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
  addNoteAttendee: addNoteAttendeeMock,
  removeNoteAttendee: removeNoteAttendeeMock,
  revertToVersion: vi.fn(),
  updateCalendarLink: vi.fn(),
  updateNote: vi.fn(),
}))

import {
  useAddNoteAttendeeMutation,
  useCreateNoteMutation,
  useRemoveNoteAttendeeMutation,
} from '@/features/notes/queries/useNoteMutations'

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

function createdNote(id: string, folderId?: string, attendees: NoteAttendee[] = []): NoteDetail {
  return {
    ...note(id, folderId),
    linkedEvent: null,
    attendees,
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
    const created = createdNote('note-created', 'folder-a')
    client.setQueryData(queryKeys.notesByFolder(accountID, 'folder-a'), pages([created, existing]))

    useCreateNoteMutation(accountID)
    const options = useMutationMock.mock.calls[0][0] as { onSuccess: (created: NoteDetail) => void }
    options.onSuccess(created)

    expect(client.getQueryData<NotesInfiniteData>(queryKeys.notesByFolder(accountID, 'folder-a'))?.pages[0].notes.map((item) => item.id))
      .toEqual(['note-created', 'note-existing'])
  })

  it('prepends a created note to the loaded unfiled cache', () => {
    const created = createdNote('note-created')
    client.setQueryData(queryKeys.notesByFolder(accountID, null), pages([]))

    useCreateNoteMutation(accountID)
    const options = useMutationMock.mock.calls[0][0] as { onSuccess: (created: NoteDetail) => void }
    options.onSuccess(created)

    expect(client.getQueryData<NotesInfiniteData>(queryKeys.notesByFolder(accountID, null))?.pages[0].notes.map((item) => item.id))
      .toEqual(['note-created'])
  })

  it('caches creator attendees returned with a newly created note', () => {
    const creator: NoteAttendee = {
      id: 'attendee-creator',
      noteId: 'note-created',
      email: 'creator@example.com',
      name: 'Creator',
      source: 'manual',
      createdAt: '2026-08-28T00:00:00Z',
    }
    const created = createdNote('note-created', undefined, [creator])

    useCreateNoteMutation(accountID)
    const options = useMutationMock.mock.calls[0][0] as { onSuccess: (created: NoteDetail) => void }
    options.onSuccess(created)

    expect(client.getQueryData<NoteDetail>(queryKeys.note(accountID, created.id))?.attendees).toEqual([creator])
  })
})

describe('useAddNoteAttendeeMutation', () => {
  beforeEach(() => {
    useMutationMock.mockClear()
    addNoteAttendeeMock.mockClear()
    useQueryClientMock.mockReturnValue(new QueryClient())
  })

  it('passes an optional manually entered name to the attendee API', async () => {
    addNoteAttendeeMock.mockResolvedValue({
      id: 'attendee-a',
      noteId: 'note-a',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      source: 'manual',
      createdAt: 1,
    })

    useAddNoteAttendeeMutation(accountID)
    const options = useMutationMock.mock.calls[0][0] as {
      mutationFn: (variables: { noteID: string; email: string; name?: string }) => Promise<unknown>
    }
    await options.mutationFn({ noteID: 'note-a', email: 'ada@example.com', name: 'Ada Lovelace' })

    expect(addNoteAttendeeMock).toHaveBeenCalledWith('note-a', 'ada@example.com', 'Ada Lovelace')
  })
})

describe('useRemoveNoteAttendeeMutation', () => {
  let client: QueryClient

  beforeEach(() => {
    client = new QueryClient()
    useMutationMock.mockClear()
    removeNoteAttendeeMock.mockClear()
    useQueryClientMock.mockReturnValue(client)
    setActiveServerStateAccount(accountID)
  })

  afterEach(() => {
    setActiveServerStateAccount(null)
  })

  it('removes an attendee immediately and restores the cache if deletion fails', async () => {
    const attendee: NoteAttendee = {
      id: 'attendee-a',
      noteId: 'note-a',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      source: 'manual',
      createdAt: '2026-08-28T00:00:00Z',
    }
    const detail = createdNote('note-a', undefined, [attendee])
    const queryKey = queryKeys.note(accountID, detail.id)
    client.setQueryData(queryKey, detail)

    useRemoveNoteAttendeeMutation(accountID)
    const options = useMutationMock.mock.calls[0][0] as {
      onMutate: (variables: { noteID: string; email: string }) => Promise<unknown>
      onError: (error: Error, variables: { noteID: string; email: string }, context: unknown) => void
    }
    const variables = { noteID: detail.id, email: 'ADA@example.com' }
    const context = await options.onMutate(variables)

    expect(client.getQueryData<NoteDetail>(queryKey)?.attendees).toEqual([])

    options.onError(new Error('request failed'), variables, context)
    expect(client.getQueryData<NoteDetail>(queryKey)?.attendees).toEqual([attendee])
  })
})
