# Billing Usage Section

Status: UI scaffold implemented; backend usage data deferred

Add a compact **Usage** section near **Current plan** on the desktop Billing page.

## Display

- Transcription minutes used and plan allowance
- AI chats used and plan allowance
- Current usage-period reset date
- A progress bar for each limited resource
- An upgrade prompt when usage approaches the plan limit

## Behavior

- Load authoritative usage and allowances from the backend.
- Keep usage read-only in the desktop client.
- Clearly represent unlimited allowances without a misleading progress percentage.
- Refresh when Billing opens, the app regains focus, or a usage-changing action completes.
- Keep the current plan visible if usage is temporarily unavailable.

## Initial Scope

- Keep this inside Billing rather than adding a separate Usage tab.
- Do not add detailed history, analytics, exports, costs, organization usage, or usage editing.

The desktop Billing page currently uses isolated placeholder values to preview this layout. Replace those values with the backend response when usage retrieval is implemented.
