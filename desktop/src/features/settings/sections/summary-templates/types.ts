export const MAX_SUMMARY_TEMPLATES = 100

export type SummaryTemplateFolder = {
  id: string
  name: string | null
  available: boolean
}

export type SummaryTemplate = {
  id: string
  name: string
  prompt: string
  folders: SummaryTemplateFolder[]
  createdAt: string
  updatedAt: string
}

export type SummaryTemplateInput = {
  name: string
  prompt: string
  folderIds: string[]
}
