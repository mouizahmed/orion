export type ActivitySort = 'updated' | 'created' | 'title'
export type ActivitySortDirection = 'asc' | 'desc'

export type ActivityRecord = {
  id: string
  title: string
  actorLabel?: string
  timestamp: number
  noteId?: string
  folderId?: string
  createdAt: number
  updatedAt: number
}
