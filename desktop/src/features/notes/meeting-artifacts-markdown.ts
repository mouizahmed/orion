import type { MeetingArtifactsResult } from '@/features/notes/api/meeting-artifacts-client'

const MAX_MEETING_ARTIFACT_MARKDOWN_LENGTH = 256 << 10

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]{}()#+\-.!|>])/g, '\\$1')
}

export function formatMeetingArtifactsMarkdown(result: MeetingArtifactsResult): string {
  const sections = [`## Summary\n\n${escapeMarkdown(result.artifacts.summary)}`]

  if (result.artifacts.decisions.length > 0) {
    sections.push(`## Decisions\n\n${result.artifacts.decisions
      .map((decision) => `- ${escapeMarkdown(decision.text)}`)
      .join('\n')}`)
  }

  if (result.artifacts.actionItems.length > 0) {
    sections.push(`## Action items\n\n${result.artifacts.actionItems
      .map((item) => {
        const metadata = [
          item.owner ? `Owner: ${escapeMarkdown(item.owner)}` : '',
          item.dueDate ? `Due: ${escapeMarkdown(item.dueDate)}` : '',
        ].filter(Boolean)
        const suffix = metadata.length > 0 ? ` — ${metadata.join(' · ')}` : ''
        return `- [ ] ${escapeMarkdown(item.description)}${suffix}`
      })
      .join('\n')}`)
  }

  const markdown = sections.join('\n\n')
  if (markdown.length > MAX_MEETING_ARTIFACT_MARKDOWN_LENGTH) {
    throw new Error('Generated meeting notes are too large to insert.')
  }
  return markdown
}
