# Calendar Connections Plan

## Goal

Separate application sign-in from calendar account connection.

Orionly should let users sign in without granting calendar access, then explicitly connect one or more Google Calendar and Microsoft Outlook accounts from desktop settings.

## Current State

Calendar access is currently tied to Google login:

- `backend/internal/handlers/oauth.go` requests `https://www.googleapis.com/auth/calendar.readonly` during app authentication.
- OAuth credentials are stored in `user_oauth_tokens`.
- `user_oauth_tokens` is keyed by `(user_id, provider)`, so each app user can only have one Google token.
- `backend/internal/handlers/calendar.go` fetches all OAuth tokens for the user and reads calendar data from those tokens.
- `desktop/src/components/DashboardSettingsPage.tsx` already has a calendar settings surface and a placeholder `Disconnect calendar` button.

This is acceptable for one Google account, but it is the wrong long-term model because calendar access is an optional integration, not the user's app identity.

## Product Behavior

### App Login

App login should authenticate the user only.

Google login scopes should be reduced to:

```txt
openid
email
profile
```

Login should not request `calendar.readonly`.

### Calendar Connection

Calendar connection should be a separate OAuth flow started from Settings -> Calendar.

Current desktop behavior:

- Calendar settings shows an `Add` provider dropdown.
- Provider options are `Google Calendar` and `Outlook`.
- Connected accounts are shown separately from individual calendars.
- Each connected account can be disconnected independently.
- Individual calendars under a connected account can be shown or hidden.

### Disconnect

Disconnect should remove Orionly's access to that calendar account.

Minimum behavior:

- Set the connection to `status = 'disconnected'` and set `disconnected_at`.
- Stop using that account for `/calendar/upcoming`.
- Clear desktop calendar caches.
- Refresh the home/calendar/settings views.

Optional provider revocation:

- Google access can be revoked by calling `https://oauth2.googleapis.com/revoke`.
- Provider revocation should be best effort. The authoritative app-level disconnect is removing the local stored connection.

## Data Model

### Integration Model

`integration_connections` is designed to cover all provider integrations -- not just calendar. The key rules:

**One row per connected account, not per feature.** A user who connects their Google account once gets one row. That row can power Calendar, Drive, and Gmail. The `scopes` column records what was granted. When a new feature needs an additional scope, the OAuth flow runs again with `include_granted_scopes=true`, and the existing row is updated -- no second row is created.

**Provider model by type:**

| Provider | Account identity | Notes |
|---|---|---|
| `google` | Google user ID | One row covers Calendar, Drive, Gmail |
| `microsoft` | Microsoft user ID | One row covers Outlook Calendar, OneDrive |
| `notion` | Workspace/bot install ID | Use `provider_account_id` for the stable workspace/install ID and `metadata` for workspace name/bot details |
| `slack` | Slack user + team | `metadata` holds team ID and team name |
| CRMs (HubSpot etc.) | Account/portal ID | Standard OAuth |

**Feature tables reference the connection row by ID.** They never store tokens.

### New Table: `integration_connections`

Use a generic table for OAuth account/token ownership across all integrations. One connected Google account may eventually power both Calendar and Drive; one Microsoft account may power both Outlook Calendar and OneDrive. Keeping token ownership separate from feature-specific settings avoids a schema rename later.

```sql
create table integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  provider text not null,                    -- google, microsoft, notion
  provider_account_id text not null,
  provider_email text,
  display_name text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text,
  metadata jsonb,                            -- provider-specific extras (e.g. Notion workspace/bot)
  status text not null default 'active',      -- active, needs_reconnect, disconnected
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disconnected_at timestamptz,
  unique (user_id, provider, provider_account_id),
  check (status in ('active', 'needs_reconnect', 'disconnected')),
  check ((status = 'disconnected') = (disconnected_at is not null))
);
```

Provider values:

- `google`
- `microsoft`
- `notion` (later -- connection represents a workspace/bot install, not a normal email account; use `provider_account_id` for the install/workspace ID and `metadata` for workspace details)

`provider_account_id` is required for all providers. For providers that do not expose a normal user account ID, store the most stable provider-specific installation or workspace identifier instead. This avoids duplicate rows caused by nullable values in the `(user_id, provider, provider_account_id)` unique constraint.

`access_token` and `refresh_token` must be encrypted with the existing token encryption utilities before storage.

Feature-specific preferences reference `integration_connections(id)` rather than embedding OAuth state:

```
integration_connections   -- OAuth account/token ownership (this table)
calendar_preferences      -- calendar-specific visibility settings
drive_preferences         -- Drive/OneDrive-specific settings (later)
notion_workspace_preferences -- Notion-specific settings (later)
integration_sync_state    -- per-connection sync cursors/state (later)
```

### New Table: `calendar_preferences`

Use this table for per-calendar visibility.

```sql
create table calendar_preferences (
  user_id text not null references users(id) on delete cascade,
  connection_id uuid not null references integration_connections(id) on delete cascade,
  calendar_id text not null,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, connection_id, calendar_id)
);
```

This lets `/calendar/upcoming` skip calendars the user has hidden.

### RLS

Enable RLS on both tables.

Policies should allow a user to access rows where `user_id` matches the authenticated app user. The backend currently uses its own API and Firebase auth, so direct Supabase client access may not be used yet, but policies should still be defined to keep the schema safe if direct access is added later.

If direct Supabase access is added, the client JWT must include the Orionly/Firebase user ID in a stable claim such as `app_user_id`. Policies can then use `auth.jwt() ->> 'app_user_id' = user_id`. Do not rely on `auth.uid()` unless `users.id` is migrated to Supabase auth UUIDs.

## Repository Layer

Add a new repository rather than overloading `OAuthTokenRepository`.

Suggested files:

- `backend/internal/models/integration_connection.go`
- `backend/internal/repository/integration_connection.go`

Repository interface:

```go
type IntegrationConnectionRepository interface {
  CreateOrUpdate(connection *models.IntegrationConnection) error
  GetByID(userID, connectionID string) (*models.IntegrationConnection, error)
  GetActiveByUser(userID string) ([]*models.IntegrationConnection, error)
  GetActiveByUserAndProvider(userID, provider string) ([]*models.IntegrationConnection, error)
  SoftDisconnect(userID, connectionID string) error
  MarkNeedsReconnect(userID, connectionID string) error
  UpdateTokens(userID, connectionID string, updates *models.UpdateIntegrationConnectionTokensRequest) error
}
```

Preference repository:

```go
type CalendarPreferenceRepository interface {
  GetVisibleCalendarIDs(userID string, connectionID string) (map[string]bool, error)
  UpsertVisibility(userID string, connectionID string, calendarID string, visible bool) error
}
```

## Backend OAuth Flow

Keep existing `/auth/start` for login. Add a generic integration OAuth flow that all providers share.

Connection management is provider-agnostic. Feature data routes (calendar events, Notion pages, etc.) stay under their own namespaces.

Keep login OAuth and integration OAuth state separate:

- Login OAuth continues to use the existing `/auth/start` and `/auth/callback` flow.
- Integration OAuth uses `/api/integrations/connections/start` and `/integrations/oauth/callback`.
- Integration state must be server-validated and consumed from Redis.
- Use a distinct Redis key prefix, such as `integration_oauth_state:{state}`. Do not reuse the existing login `oauth_state:{state}` metadata key.
- Integration callbacks must reject any state whose payload does not include `purpose: integration_connect`.

### Routes

Unauthenticated browser callback:

```txt
GET /integrations/oauth/callback
```

Authenticated API routes for connection management:

```txt
POST   /api/integrations/connections/start
GET    /api/integrations/connections
DELETE /api/integrations/connections/:connectionID
POST   /api/integrations/connections/:connectionID/reconnect  (optional)
```

Calendar-specific data routes (unchanged namespace):

```txt
GET    /api/calendar/calendars
GET    /api/calendar/upcoming
PATCH  /api/calendar/connections/:connectionID/calendars/:calendarID
```

Future feature routes follow the same pattern:

```txt
GET    /api/notion/pages
GET    /api/drive/files
```

### Start Connection

`POST /api/integrations/connections/start`

Request:

```json
{
  "provider": "google",
  "feature": "calendar",
  "platform": "desktop"
}
```

The `feature` field tells the handler which scopes to request. For Google, `feature: "calendar"` requests `calendar.readonly`; `feature: "drive"` requests Drive scopes. If the user already has a Google connection, the handler should check whether the existing connection already has the required scope before starting a new OAuth flow.

Response:

```json
{
  "status": "success",
  "auth_url": "https://accounts.google.com/..."
}
```

The handler should:

- Require Firebase authentication.
- Generate a secure random state.
- Store state metadata in Redis for 10 minutes.
- Include `purpose: integration_connect`.
- Include `user_id`.
- Include `provider`.
- Include `feature`.
- Include `platform`.
- Return the provider auth URL.

State payload:

```json
{
  "purpose": "integration_connect",
  "user_id": "firebase-or-linked-user-id",
  "provider": "google",
  "feature": "calendar",
  "platform": "desktop",
  "created_at": "2026-05-01T00:00:00Z"
}
```

#### Scopes by provider and feature

Google -- calendar:

```txt
openid
email
profile
https://www.googleapis.com/auth/calendar.readonly
```

Google -- drive (later):

```txt
openid
email
profile
https://www.googleapis.com/auth/drive.readonly
```

Microsoft -- calendar (later):

```txt
openid
email
profile
offline_access
Calendars.Read
```

Notion (later) -- workspace bot install, no user-level scopes; uses Notion OAuth app flow.

Use `access_type=offline` and `include_granted_scopes=true` for Google. This means connecting Google Calendar and later adding Drive scope re-uses the same account row and merges scopes rather than creating a second row.

### Callback

`GET /integrations/oauth/callback`

The callback should:

- Validate and consume state from Redis.
- Reject states that are missing, expired, or not `integration_connect`.
- Exchange the provider authorization code for tokens.
- Fetch provider account identity.
- Upsert into `integration_connections` on `(user_id, provider, provider_account_id)` -- this ensures one row per account even if the user connects the same Google account for a second feature.
- Store the token in `integration_connections`.
- Redirect to the frontend callback page or app deep link with a success status.

Google identity source:

```txt
https://www.googleapis.com/oauth2/v2/userinfo
```

Store:

- `provider = google`
- `provider_account_id = googleUser.ID`
- `provider_email = googleUser.Email`
- `display_name = googleUser.Name`
- encrypted `access_token`
- encrypted `refresh_token`
- `expires_at`
- `scopes`
- `status = active`
- `disconnected_at = null`

### Desktop Completion

Reuse the existing desktop browser/deep-link completion pattern where practical.

The desktop app does not need a new Firebase token after a calendar connection. It only needs to know that the connection finished, then refresh calendar state.

Recommended desktop callback shape:

```txt
orionly://integrations/callback?success=true&provider=google&feature=calendar
```

Implementation mapping:

- Backend callback redirects desktop integrations to the `orionly://integrations/callback` deep link instead of issuing a login one-time code.
- `desktop/electron/protocol-handler.ts` should add an `integrations/callback` branch alongside the existing auth callback branch.
- The protocol handler sends an IPC event such as `integration:connection-completed` to the renderer with `{ success, provider, feature, error? }`.
- `desktop/electron/preload.ts` exposes a listener such as `onIntegrationConnectionCompleted`.
- `DashboardSettingsPage.tsx` listens for completion, clears calendar caches, dispatches `dashboard-calendar-refresh`, and reloads connections/calendars.

Suggested event payload:

```json
{
  "type": "integration_connection_completed",
  "success": true,
  "provider": "google",
  "feature": "calendar"
}
```

## Calendar API Changes

### List Connections

`GET /api/integrations/connections`

Response:

```json
{
  "status": "success",
  "connections": [
    {
      "id": "uuid",
      "provider": "google",
      "provider_email": "person@example.com",
      "display_name": "Person Name",
      "status": "active",
      "connected_at": "2026-05-01T00:00:00Z"
    }
  ]
}
```

Never return access tokens or refresh tokens.

### List Calendars

Keep `GET /api/calendar/calendars`, but change the response shape to include connection context.

```go
type CalendarSource struct {
  ID              string `json:"id"`
  ConnectionID    string `json:"connection_id"`
  AccountEmail    string `json:"account_email,omitempty"`
  Name            string `json:"name"`
  Provider        string `json:"provider"`
  Color           string `json:"color,omitempty"`
  BackgroundColor string `json:"background_color,omitempty"`
  ForegroundColor string `json:"foreground_color,omitempty"`
  Primary         bool   `json:"primary"`
  Selected        bool   `json:"selected"`
  Visible         bool   `json:"visible"`
  AccessRole      string `json:"access_role,omitempty"`
}
```

The backend should fetch calendars for every active connection.

`Visible` should be derived from `calendar_preferences`; default to true for selected/primary calendars and false for unselected calendars unless product decides all calendars should default visible.

### Upcoming Events

Keep `GET /api/calendar/upcoming?limit=...`.

Change implementation to:

- Load active calendar connections.
- Refresh expired tokens by connection ID.
- Fetch calendars for each connection.
- Apply visibility preferences.
- Fetch events only for visible calendars.
- Normalize events across providers.
- Sort by start time.
- Limit after merging results from all connections.

Event response should include connection context:

```go
type CalendarEvent struct {
  ID           string `json:"id"`
  ProviderID   string `json:"provider_id"`
  ConnectionID string `json:"connection_id"`
  AccountEmail string `json:"account_email,omitempty"`
  CalendarID   string `json:"calendar_id,omitempty"`
  CalendarName string `json:"calendar_name,omitempty"`
}
```

`ID` should be a stable Orionly event ID, not just the provider event ID:

```txt
google:{connectionID}:{calendarID}:{providerEventID}
```

This prevents collisions when two connected Google accounts contain the same calendar or event ID.

## Token Refresh

Move token refresh from `(userID, provider)` to `(userID, connectionID)`.

Current code in `calendar.go` refreshes by provider:

```go
refreshTokenIfNeeded(userID, token.Provider)
```

New behavior:

```go
refreshConnectionTokenIfNeeded(userID, connectionID)
```

Provider-specific refresh config:

- Google token URL: `https://oauth2.googleapis.com/token`
- Microsoft token URL later: `https://login.microsoftonline.com/common/oauth2/v2.0/token`

If refresh fails with an invalid grant:

- Mark the connection as `needs_reconnect`.
- Do not fail the whole calendar response if other connections are valid.

If a connection is `needs_reconnect`, keep the row and token history metadata for auditability, but stop using it for calendar reads until reconnect succeeds. Reconnect should run the same provider OAuth flow and update the existing `(user_id, provider, provider_account_id)` row back to `active`.

## Desktop Implementation

### Electron API

Add IPC methods:

```ts
connectIntegration(provider: 'google' | 'microsoft' | 'notion', feature: string): Promise<{ success: boolean; error?: string }>
disconnectIntegration(connectionID: string): Promise<{ success: boolean; error?: string }>
```

`connectIntegration` should:

- Get the current Firebase ID token from the renderer or accept it as an argument.
- Call `POST /api/integrations/connections/start` with `{ provider, feature, platform: 'desktop' }`.
- Open the returned `auth_url` with `shell.openExternal`.

`disconnectIntegration` can either call the backend directly from the renderer or through Electron. Keeping it in the renderer is acceptable because other authenticated API calls already happen there.

### Renderer Settings

Update `DashboardSettingsPage.tsx`:

- Load `/api/integrations/connections`.
- Load `/api/calendar/calendars`.
- Group calendars by connection.
- Add an `Add` provider dropdown for Google Calendar and Outlook.
- Wire `Disconnect` to `DELETE /api/integrations/connections/:connectionID`.
- Wire calendar toggles to `PATCH /api/calendar/connections/:connectionID/calendars/:calendarID`.
- Disable buttons while requests are in flight.
- Show concise error states.

Suggested UI structure:

```txt
Calendar accounts
  Google Calendar - person@company.com
    Disconnect
  Microsoft Outlook - person@company.com
    Disconnect

Visible calendars
  person@company.com
    Work Calendar      toggle
    Holidays           toggle
  personal@gmail.com
    Personal           toggle
```

After connect/disconnect/toggle:

- Clear `calendar_events_${user.id}` from localStorage.
- Dispatch `dashboard-calendar-refresh`.
- Refresh settings state.

### Home And Calendar Views

Update consumers in:

- `desktop/src/components/UpcomingMeetings.tsx`
- `desktop/src/components/DashboardCalendar.tsx`

They should tolerate:

- no connected accounts
- multiple accounts
- event IDs with provider/connection/calendar prefixes
- account email display when useful

## Migration Strategy

### Phase 1: Add New Model Without Removing Old Tokens

- Add `integration_connections`.
- Add `calendar_preferences`.
- Add repository and handlers.
- Keep `user_oauth_tokens` untouched for login compatibility.

### Phase 2: Remove Calendar Scope From Login

- Change Google login scopes in `backend/internal/handlers/oauth.go`.
- Keep app login working exactly as before.
- New users will not have calendar access until they connect from settings.

### Phase 3: Calendar Reads Prefer New Connections

- Update `calendar.go` to use active calendar-capable `integration_connections` for `provider in ('google', 'microsoft')`.
- Optionally fall back to old `user_oauth_tokens` while migration is in progress.

Fallback behavior:

- If active calendar-capable `integration_connections` exist, use only those.
- If none exist but a legacy Google token exists in `user_oauth_tokens`, optionally surface it as a legacy connection or show a reconnect prompt.

Recommended behavior:

- Do not silently migrate legacy login tokens because users did not explicitly connect calendar under the new model.
- Show the `Add` dropdown and let them grant calendar access intentionally.

### Phase 4: Wire Desktop Settings

- Add connect button.
- Add account list.
- Wire disconnect.
- Wire visibility toggles.

### Phase 5: Clean Up Legacy Coupling

- Stop calendar handlers from reading `user_oauth_tokens`.
- Keep `user_oauth_tokens` only for providers where it is still needed, or remove it if app login no longer stores provider tokens.

## Supabase Migration Plan

Apply one migration for tables and indexes:

```sql
create table if not exists integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  provider text not null,
  provider_account_id text not null,
  provider_email text,
  display_name text,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scopes text,
  metadata jsonb,
  status text not null default 'active',
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disconnected_at timestamptz,
  constraint integration_connections_provider_check check (provider in ('google', 'microsoft', 'notion')),
  constraint integration_connections_status_check check (status in ('active', 'needs_reconnect', 'disconnected')),
  constraint integration_connections_disconnected_at_check check ((status = 'disconnected') = (disconnected_at is not null)),
  constraint integration_connections_unique_account unique (user_id, provider, provider_account_id)
);

create index if not exists integration_connections_user_active_idx
  on integration_connections (user_id, provider)
  where status = 'active';

create table if not exists calendar_preferences (
  user_id text not null references users(id) on delete cascade,
  connection_id uuid not null references integration_connections(id) on delete cascade,
  calendar_id text not null,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, connection_id, calendar_id)
);

alter table integration_connections enable row level security;
alter table calendar_preferences enable row level security;

create policy integration_connections_user_select
  on integration_connections
  for select
  using (auth.jwt() ->> 'app_user_id' = user_id);

create policy calendar_preferences_user_select
  on calendar_preferences
  for select
  using (auth.jwt() ->> 'app_user_id' = user_id);

create policy calendar_preferences_user_write
  on calendar_preferences
  for all
  using (auth.jwt() ->> 'app_user_id' = user_id)
  with check (auth.jwt() ->> 'app_user_id' = user_id);
```

These RLS policies assume direct clients receive a Supabase-compatible JWT with an `app_user_id` claim containing the Orionly/Firebase user ID. If only the Go backend accesses the database with the service connection, RLS documents intent but is not the main enforcement layer. If direct client writes to `integration_connections` are ever needed, add narrowly scoped write policies; do not let clients write provider tokens directly.

## Security And Privacy

- Calendar access must be explicit and optional.
- Login should not request calendar scopes.
- Do not return tokens to desktop.
- Encrypt tokens before storage.
- Validate OAuth state server-side.
- Bind calendar OAuth state to the authenticated app user.
- Use short state expiration, around 10 minutes.
- Disconnect must verify row ownership by `user_id`.
- Logs must not include access tokens, refresh tokens, auth codes, or full callback URLs with codes.

## Error Handling

Calendar endpoints should degrade gracefully:

- One failed connection should not break all calendar results.
- Expired token with successful refresh should be invisible to the user.
- Expired token with failed refresh should mark the connection as needing reconnect.
- Disconnected accounts should never be fetched.
- Provider API failures should return a useful but non-sensitive error in settings.

Possible connection statuses:

```txt
active
needs_reconnect
disconnected
```

Implement `needs_reconnect` in the first release. It gives the UI a clear state for expired/revoked credentials without conflating reconnectable accounts with intentionally disconnected accounts.

## Testing Plan

Backend tests:

- Start calendar connection requires Firebase auth.
- Callback rejects invalid state.
- Callback stores connection with provider account identity.
- Duplicate account upserts the same `(user_id, provider, provider_account_id)`.
- Disconnect only affects owned connections.
- Upcoming events merges and sorts multiple connections.
- Token refresh updates by connection ID, not provider.
- Hidden calendars are excluded.

Desktop tests/manual checks:

- New user can sign in without calendar permissions.
- Empty settings state shows the `Add` provider dropdown.
- Connect opens browser OAuth.
- Successful connect refreshes settings and upcoming meetings.
- Multiple Google accounts appear separately.
- Multiple Outlook accounts appear separately.
- Disconnect removes one account without affecting the other.
- Calendar visibility toggle affects upcoming meetings.
- Calendar page handles no connected calendars.

## Suggested Implementation Order

1. Add Supabase migration for `integration_connections` and `calendar_preferences`.
2. Add Go models and repositories.
3. Add calendar connection OAuth start/callback handlers.
4. Remove calendar scope from app login.
5. Update calendar fetch code to use active connections.
6. Add disconnect endpoint.
7. Add visibility preference endpoint.
8. Add Electron `connectIntegration` / `disconnectIntegration` IPC.
9. Update desktop calendar settings UI.
10. Update home/calendar event consumers for connection-aware IDs.
11. Run backend build/tests and desktop typecheck.

## Open Decisions

- Legacy `user_oauth_tokens` calendar tokens should be ignored or shown as reconnect prompts. Recommendation below: show the `Add` dropdown and do not silently migrate them.
- Provider token revocation during disconnect can be best-effort in the first release. Local disconnect remains authoritative.

## Recommendation

Use soft disconnect with `status = 'disconnected'` and `disconnected_at`, support `needs_reconnect` immediately, do not silently migrate legacy calendar tokens, and default visible calendars from provider `selected || primary`.

This gives users clear consent, supports multiple Google and Outlook accounts, preserves auditability, and keeps calendar access separate from app login.
