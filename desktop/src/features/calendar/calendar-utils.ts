export function dateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export function isSameDay(first: Date, second: Date): boolean {
  return dateKey(first) === dateKey(second)
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export type CalendarErrorPresentation = 'none' | 'blocking' | 'inline'

export function calendarErrorPresentation(error: string | null, eventCount: number): CalendarErrorPresentation {
  if (!error) return 'none'
  return eventCount > 0 ? 'inline' : 'blocking'
}
