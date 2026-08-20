export type LiveInsightSource = 'audio' | 'unknown'

export type LiveInsightCategory = 'error' | 'suggestion' | 'observation' | 'note'

export type LiveInsightAction = {
  id: string
  label: string
  description?: string
  payload?: Record<string, unknown>
}

export type LiveInsight = {
  id: string
  title: string
  summary: string
  summaryPoints?: string[]
  details?: string
  createdAt: number
  source?: LiveInsightSource
  category?: LiveInsightCategory
  actions?: LiveInsightAction[]
}

export type LiveInsightEvent = {
  insight: LiveInsight
}

export type LiveResponseSuggestion = {
  id: string
  title?: string
  description?: string
  prompts: string[]
  createdAt: number
}

export type LiveTranscriptSegment = {
  id: string
  text: string
  createdAt: number
  pending?: boolean
  channel?: number
  startTime?: number
  endTime?: number
}

