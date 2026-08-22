import { MutationObserver, QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import type { FolderRecord } from '@/features/notes/folder-types'
import {
  patchNoteEverywhere,
  relocateNote,
  removeNoteEverywhere,
  restoreSnapshot,
  snapshotAccountNotes,
  type NotesInfiniteData,
} from '@/features/notes/queries/note-cache-transforms'
import type { NoteDetail, NoteSummary } from '@/features/notes/types'
import { queryKeys } from '@/lib/query-keys'

const accountID = 'account-a'
const note: NoteSummary = { id: 'note-a', title: 'A', folderId: 'folder-a', createdAt: 1, updatedAt: 2 }

function pages(notes: NoteSummary[]): NotesInfiniteData {
  return { pages: [{ notes, hasMore: false }], pageParams: [null] }
}

describe('note cache transforms', () => {
  it('patches list summaries and detail data without treating details as infinite pages', () => {
    const client = new QueryClient()
    client.setQueryData<NoteDetail>(queryKeys.note(accountID, note.id), {
      ...note,
      noteMarkdown: 'body',
      revision: 1,
      linkedEvent: null,
      attendees: [],
    })
    client.setQueryData(queryKeys.notesByFolder(accountID, 'folder-a'), pages([note]))

    expect(() => patchNoteEverywhere(client, accountID, note.id, { title: 'Updated' })).not.toThrow()
    expect(client.getQueryData<NoteDetail>(queryKeys.note(accountID, note.id))?.title).toBe('Updated')
    expect(client.getQueryData<NotesInfiniteData>(queryKeys.notesByFolder(accountID, 'folder-a'))?.pages[0].notes[0].title).toBe('Updated')
  })

  it('moves a note exactly once and adjusts folder counts safely', () => {
    const client = new QueryClient()
    const folders: FolderRecord[] = [
      { id: 'folder-a', name: 'A', noteCount: 1, createdAt: 1, updatedAt: 1 },
      { id: 'folder-b', name: 'B', noteCount: 0, createdAt: 1, updatedAt: 1 },
    ]
    client.setQueryData(queryKeys.folders(accountID), folders)
    client.setQueryData(queryKeys.notesByFolder(accountID, 'folder-a'), pages([note, note]))
    client.setQueryData(queryKeys.notesByFolder(accountID, 'folder-b'), pages([]))

    relocateNote(client, accountID, note, 'folder-a', 'folder-b')
    relocateNote(client, accountID, note, 'folder-a', 'folder-b')

    expect(client.getQueryData<NotesInfiniteData>(queryKeys.notesByFolder(accountID, 'folder-a'))?.pages[0].notes).toEqual([])
    expect(client.getQueryData<NotesInfiniteData>(queryKeys.notesByFolder(accountID, 'folder-b'))?.pages[0].notes.map((item) => item.id)).toEqual(['note-a'])
    expect(client.getQueryData<FolderRecord[]>(queryKeys.folders(accountID))?.map((folder) => folder.noteCount)).toEqual([0, 1])
  })

  it('does not create an unloaded destination page', () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.notesByFolder(accountID, 'folder-a'), pages([note]))
    relocateNote(client, accountID, note, 'folder-a', 'folder-b')
    expect(client.getQueryData(queryKeys.notesByFolder(accountID, 'folder-b'))).toBeUndefined()
  })

  it('removes deleted notes from all pages and the detail cache', () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.note(accountID, note.id), { ...note, noteMarkdown: '', revision: 1, linkedEvent: null, attendees: [] })
    client.setQueryData(queryKeys.notesByFolder(accountID, 'folder-a'), pages([note]))
    client.setQueryData(queryKeys.notesByEvent(accountID, 'event-a'), pages([note]))
    removeNoteEverywhere(client, accountID, note.id)
    expect(client.getQueryData(queryKeys.note(accountID, note.id))).toBeUndefined()
    expect(client.getQueryData<NotesInfiniteData>(queryKeys.notesByFolder(accountID, 'folder-a'))?.pages[0].notes).toEqual([])
    expect(client.getQueryData<NotesInfiniteData>(queryKeys.notesByEvent(accountID, 'event-a'))?.pages[0].notes).toEqual([])
  })

  it('restores the exact optimistic snapshot on failure', () => {
    const client = new QueryClient()
    client.setQueryData(queryKeys.notesByFolder(accountID, 'folder-a'), pages([note]))
    const snapshot = snapshotAccountNotes(client, accountID)
    relocateNote(client, accountID, note, 'folder-a', 'folder-b')
    restoreSnapshot(client, snapshot)
    expect(client.getQueryData<NotesInfiniteData>(queryKeys.notesByFolder(accountID, 'folder-a'))?.pages[0].notes).toEqual([note])
  })

  it('serializes note field mutations sharing the same scope', async () => {
    const client = new QueryClient()
    const started: string[] = []
    let releaseFirst: () => void = () => {}
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const first = new MutationObserver(client, {
      scope: { id: 'note-update:account-a' },
      mutationFn: async () => { started.push('title'); await firstGate },
    })
    const secondFn = vi.fn(async () => { started.push('body') })
    const second = new MutationObserver(client, {
      scope: { id: 'note-update:account-a' },
      mutationFn: secondFn,
    })
    const firstPromise = first.mutate()
    const secondPromise = second.mutate()
    await Promise.resolve()
    expect(started).toEqual(['title'])
    expect(secondFn).not.toHaveBeenCalled()
    releaseFirst()
    await Promise.all([firstPromise, secondPromise])
    expect(started).toEqual(['title', 'body'])
  })
})
