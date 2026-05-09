export type NoteRecord = {
  id: string
  title: string
  folderId?: string
  noteMarkdown: string
  createdAt: number
  updatedAt: number
  calendarEventId?: string
}

export type NoteVersion = {
  id: string
  note_id: string
  note_markdown: string
  created_at: string
}
