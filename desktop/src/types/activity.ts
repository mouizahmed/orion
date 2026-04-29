export type ActivityType = 'note_created' | 'note_updated' | 'recording_completed'

export type ActivityRecord = {
  id: string
  type: ActivityType
  title: string
  actorLabel?: string
  timestamp: number
  noteId?: string
  folderId?: string
  visibility?: 'private' | 'shared'
  createdAt: number
  updatedAt: number
}
