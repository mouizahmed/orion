export type ActivitySort = 'updated' | 'created' | 'title'
export type ActivitySortDirection = 'asc' | 'desc'
export type ActivityScope = 'all' | 'owned' | 'shared'

export type ActivityRecord = {
  id: string
  title: string
  actorLabel?: string
  timestamp: number
  noteId?: string
  folderId?: string
  visibility?: 'private' | 'shared'
  createdAt: number
  updatedAt: number
}
