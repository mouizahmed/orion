import type { QueryClient } from '@tanstack/react-query'

import type { NoteDetail } from '@/features/notes/types'
import { noteQueryOptions } from '@/features/notes/queries/note-query-options'
import { queryKeys } from '@/lib/query-keys'

export async function resolveNoteRevision(
  queryClient: QueryClient,
  accountID: string,
  noteID: string,
): Promise<number> {
  const cached = queryClient.getQueryData<NoteDetail | null>(queryKeys.note(accountID, noteID))
  if (cached && Number.isSafeInteger(cached.revision) && cached.revision >= 1) return cached.revision

  const note = await queryClient.fetchQuery({
    ...noteQueryOptions(accountID, noteID),
    staleTime: 0,
  })
  if (!note) throw new Error('note not found')
  if (!Number.isSafeInteger(note.revision) || note.revision < 1) {
    throw new Error('Invalid note revision')
  }
  return note.revision
}
