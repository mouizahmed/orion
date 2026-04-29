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
