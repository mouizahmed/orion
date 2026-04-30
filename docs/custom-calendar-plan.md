# Custom Calendar Plan

## Goal

Build a native, read-only Orionly calendar surface instead of embedding Google Calendar. The calendar should help users see meetings, start notes/transcripts, and connect calendar events to Orionly workflows without becoming a full calendar app.

## Data Shape

Normalize provider events into one frontend type:

```ts
type CalendarEvent = {
  id: string
  title: string
  start: string
  end: string
  calendarId: string
  calendarName: string
  color: string
  attendees?: string[]
  meetingLink?: string
  location?: string
  organizer?: string
  provider: string
  isMeeting: boolean
}
```

## Shared Calendar Utilities

Create helpers for:

- start/end of week
- month grid days
- event grouping by day
- overlap layout for week view
- formatting times
- current-day detection

## Calendar Shell

Add a native Orionly calendar page with:

- view switcher: `Agenda`, `Week`, `Month`
- previous / next buttons
- today button
- visible date range title
- calendar filters later

## Agenda View

Show upcoming events as rows grouped by day:

- meeting title
- time range
- calendar color
- join link if present
- click row opens event details and Orionly actions

## Week View

Build a read-only time grid:

- 7 columns
- hourly rows
- current time marker
- events positioned by start/end time
- basic overlap handling
- click event opens event details

## Month View

Build a date grid:

- 6 rows x 7 days
- current day highlight
- out-of-month muted days
- show first 2-4 events
- `+ more` opens that day in agenda/detail later

## Event Actions

On event click:

- open event detail panel/popover
- actions: `Start note`, `Start transcript`, `Join meeting`
- attach resulting note/transcript to calendar event id later

## Backend/API

Use the current Google Calendar fetch path first:

- fetch upcoming events with a larger limit
- cache per user
- refresh on manual button or app focus
- normalize server response before rendering

Later, add a real date-range endpoint so month/week can include past events and exact range boundaries.

## Empty, Loading, And Error States

Add polished states:

- no connected calendar
- no events in range
- loading skeleton
- failed to refresh calendar

## Later Enhancements

- keyboard navigation
- search events
- mini month picker
- multiple timezone display
- auto-suggest meeting context from memory
- day view if week gets too dense
