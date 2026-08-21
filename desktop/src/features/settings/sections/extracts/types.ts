export const MAX_EXTRACT_FIELDS = 100

export type ExtractFieldFolder = {
  id: string
  name: string | null
  available: boolean
}

export type ExtractFieldScope =
  | { type: 'allMeetings'; folders: [] }
  | { type: 'folders'; folders: ExtractFieldFolder[] }

export type ExtractField = {
  id: string
  name: string
  prompt: string
  insightCardinality: 'single' | 'multiple'
  scope: ExtractFieldScope
  createdAt: string
  updatedAt: string
}

export type ExtractFieldInput = {
  name: string
  prompt: string
  insightCardinality: 'single' | 'multiple'
  scope:
    | { type: 'allMeetings' }
    | { type: 'folders'; folderIds: string[] }
}
