# Orionly v2 Data Model (2025 Refresh)

This document describes the streamlined PostgreSQL schema that supports the current desktop application and the upcoming Gemini-powered assistant. It focuses on the essentials we need today while leaving space for live “insights” mode and future automation.

---

## At a Glance

| Table | Purpose |
|-------|---------|
| `users` | Core user profile and status |
| `user_oauth_tokens` | Encrypted OAuth credentials (Google Calendar, future providers) |
| `conversation_sessions` | Threads in both regular and live modes |
| `conversation_messages` | Sequenced message history within a session |
| `conversation_actions` | Structured log of model-triggered actions (e.g. calendar ops) |
| `live_session_events` | Optional audit trail of detected live-mode events |
| `model_usage_logs` | Token and cost tracking per model invocation |

Additional tables can be layered on later (analytics, BYOK keys, usage logs, etc.), but these provide a solid baseline.

---

## 1. `users`

Matches the table currently deployed by the backend.

```sql
CREATE TABLE users (
    id          varchar(255) PRIMARY KEY,
    email       varchar(255) UNIQUE NOT NULL,
    name        varchar(255) NOT NULL,
    avatar_url  varchar(500),
    plan        text DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
    status      text DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
    created_at  timestamptz DEFAULT now(),
    updated_at  timestamptz DEFAULT now(),
    deleted_at  timestamptz
);
```

---

## 2. `user_oauth_tokens`

Stores encrypted Google OAuth credentials so downstream services (Gemini) can call the Calendar API without re-authenticating the user.

```sql
CREATE TABLE user_oauth_tokens (
    user_id       varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider      text NOT NULL,                                   -- 'google'
    access_token  text NOT NULL,                                   -- encrypted
    refresh_token text,
    expires_at    timestamptz,
    scopes        text,                                            -- comma-delimited
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now(),
    PRIMARY KEY (user_id, provider)
);
```

---

## 3. `conversation_sessions`

One row per session, regardless of whether the user is in traditional conversation mode or live “insights” mode. The `mode` column captures which experience is active.

```sql
CREATE TABLE conversation_sessions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode              text NOT NULL CHECK (mode IN ('conversation', 'live')),
    title             text,
    model_provider    text,                         -- e.g. 'gemini'
    model_name        text,                         -- e.g. 'gemini-2.5-flash' or '-flash-live'
    live_status       text CHECK (live_status IN ('active', 'ended', 'cancelled')),
    created_at        timestamptz DEFAULT now(),
    updated_at        timestamptz DEFAULT now()
);
CREATE INDEX idx_conversation_sessions_user ON conversation_sessions(user_id, created_at DESC);
CREATE INDEX idx_conversation_sessions_live_active ON conversation_sessions(user_id)
    WHERE live_status = 'active' AND mode = 'live';
```

**Live mode behavior**  
Live sessions stay active until the user (or the desktop client) explicitly stops them. Because there is no automatic timeout, make sure the UI surfaces a clear “Stop live session” control and that back-end processors respect `conversation_sessions.live_status` when deciding whether to emit additional insights. The initial `created_at` timestamp effectively marks when the live experience began, and the polling cadence can live in application config; no per-session override is stored.

---

## 4. `conversation_messages`

Chronological message log for both user prompts and model responses.

```sql
CREATE TABLE conversation_messages (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    uuid NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
    sender        text NOT NULL CHECK (sender IN ('user', 'assistant', 'system')),
    content       text NOT NULL,
    token_count   integer,
    metadata      jsonb,                           -- e.g. {"auto_reply": true}
    created_at    timestamptz DEFAULT now()
);
CREATE INDEX idx_conversation_messages_session ON conversation_messages(session_id, created_at);
```

Use the `metadata` column to flag auto-generated live replies (`{"auto_reply": true}`), attach Gemini trace IDs, or store other rendering hints.

### Attachments

Messages can include zero or more binary attachments (images, audio snippets, raw files). The raw payloads live in a Backblaze B2 bucket; the database stores retrieval metadata and audit information.

```sql
CREATE TABLE conversation_message_attachments (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id        uuid NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
    kind              text NOT NULL CHECK (kind IN ('image', 'audio', 'file')),
    original_name     text,
    content_type      text NOT NULL,
    size_bytes        bigint NOT NULL CHECK (size_bytes >= 0),
    b2_bucket         text NOT NULL,                   -- e.g. 'orionly-production-attachments'
    b2_object_key     text NOT NULL,                   -- full path within the bucket
    b2_file_id        text,                            -- optional: Backblaze fileId for delete/version ops
    preview_url       text,                            -- signed URL or CDN link for quick rendering
    extra_metadata    jsonb,                           -- thumbnails, waveform data, etc.
    created_at        timestamptz DEFAULT now()
);
CREATE INDEX idx_message_attachments_message ON conversation_message_attachments(message_id);
CREATE INDEX idx_message_attachments_bucket_key ON conversation_message_attachments(b2_bucket, b2_object_key);
```

**Storage workflow**

1. The desktop client uploads the binary to B2 (directly or via an application proxy) following the naming convention `user/{user_id}/sessions/{session_id}/{message_id}/{uuid}` to keep objects unique.
2. Once the upload succeeds, the client (or API layer) inserts a `conversation_message_attachments` row with the B2 bucket/key, MIME type, and size.
3. When deleting a message, the application should _also_ delete the referenced B2 objects using the stored `b2_file_id` (if present) or `b2_bucket` + `b2_object_key`.

The front end can render attachments alongside the message by fetching `conversation_message_attachments` ordered by `created_at`. Use `preview_url` for cached thumbnails/CDN access and fall back to generating new signed B2 download URLs when needed.

### Live panel vs. chat panel

- **Chat panel:** filter `conversation_messages` by `metadata->>'auto_reply' IS NULL` (plus user/system turns) to render the traditional conversation thread.
- **Live panel:** filter where `metadata->>'auto_reply' = 'true'` (or whatever convention you choose) to show the proactive responses the live detector generated. You can also annotate the trigger source (`metadata->>'trigger' = 'audio'` vs. `'screen'`) if the UI needs to style them differently.

Because both panels read from the same table, all messages remain in chronological order and are easy to audit, while the front end simply renders them in different views.

---

## 5. `conversation_actions`

Captures structured operations the assistant performs—ideal for calendar access, task creation, or other integrations.

```sql
CREATE TABLE conversation_actions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      uuid NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
    action_type     text NOT NULL,                 -- e.g. 'calendar.lookup', 'calendar.create'
    target_resource text,                          -- calendar event id, doc url, etc.
    payload_in      jsonb,                         -- parameters provided to the action
    payload_out     jsonb,                         -- response obtained from the external API
    status          text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error', 'pending')),
    error_message   text,
    created_at      timestamptz DEFAULT now()
);
CREATE INDEX idx_conversation_actions_session ON conversation_actions(session_id, created_at DESC);
```

---

## 6. `live_session_events` (optional)

Live mode produces autonomous “insights” even when the user isn’t actively prompting the model. Capture those so the UI (and audit trail) can display what happened and why.

```sql
CREATE TABLE live_session_events (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id     uuid NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE,
    event_type     text NOT NULL,                 -- 'insight', 'status', 'error'
    summary        text NOT NULL,                 -- short description for UI
    detail         jsonb,                         -- arbitrary structured data
    created_at     timestamptz DEFAULT now()
);
CREATE INDEX idx_live_events_session ON live_session_events(session_id, created_at DESC);
```

Examples of `event_type`:
- `insight` – proactive information surfaced to the user  
- `status` – heartbeat / “still monitoring” notifications  
- `error` – failures while pulling context (e.g. calendar temporarily unavailable)

---

## 7. `model_usage_logs`

Track prompt/completion tokens and costs for every interaction with Gemini (conversation or live). This supports analytics, billing, and guardrails.

```sql
CREATE TABLE model_usage_logs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          varchar(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id       uuid REFERENCES conversation_sessions(id) ON DELETE SET NULL,
    message_id       uuid REFERENCES conversation_messages(id) ON DELETE SET NULL,
    mode             text CHECK (mode IN ('conversation', 'live')),
    model_provider   text NOT NULL,               -- 'gemini'
    model_name       text NOT NULL,               -- e.g. 'gemini-2.5-flash'
    prompt_tokens    integer NOT NULL DEFAULT 0,
    completion_tokens integer NOT NULL DEFAULT 0,
    total_tokens     integer NOT NULL DEFAULT 0,
    cost_cents       numeric(12,4),
    metadata         jsonb,                       -- optional: request id, latency, etc.
    created_at       timestamptz DEFAULT now()
);
CREATE INDEX idx_model_usage_by_user ON model_usage_logs(user_id, created_at DESC);
CREATE INDEX idx_model_usage_by_session ON model_usage_logs(session_id, created_at DESC);
```

Populate this table right after each model response. For live mode, log periodic updates or aggregated intervals (e.g. every N seconds) depending on how granular you want billing/analytics to be.

---

## Lifecycle and Timing Considerations

1. **Starting live mode**  
   - Create `conversation_sessions` row with `mode = 'live'`; `created_at` captures the start time automatically.  
   - Store the user’s latest OAuth token in `user_oauth_tokens` so the live agent can call Google Calendar as needed.  

2. **During live mode**  
   - When Gemini Live wants to answer proactively, insert a new row in `conversation_messages` with `metadata` indicating it was auto-generated.  
   - Record structured work (API calls, insights) in `conversation_actions` and optionally `live_session_events`.  
   - Insert a row in `model_usage_logs` for each model call (conversation prompts or live auto-response).  

3. **Ending live mode**  
   - Update `conversation_sessions.live_status` to `ended` when the user (or desktop client) explicitly stops the session.  
   - Optionally write a closing `live_session_events` entry summarizing the session.  

4. **Conversation mode**  
   - Use the same tables but set `mode = 'conversation'; live_*` columns stay NULL.  

---

## Migration Notes

1. Deploy the updated `users` table if you have not already migrated to the stripped-down schema.  
2. Create `conversation_sessions`, `conversation_messages`, and `conversation_actions` first—they power both modes.  
3. Add `live_session_events` when you want an audit trail of detected events.  
4. Create `model_usage_logs` to capture token usage from the outset.  
5. Keep `user_oauth_tokens`; any new provider just adds a row keyed by `(user_id, provider)`.  

All tables share the same UUID-based primary keys (except `users` and `user_oauth_tokens`, which reuse the string ids defined by Firebase/OAuth). Trigger-based `updated_at` maintenance is optional but easy to add later.

---

## Future Extensions

- **Usage analytics** (per-user token usage, billing) → new `usage_logs` table.  
- **BYOK / API key storage** → `user_api_keys`.  
- **Vector search / RAG** → add embedding tables as needed.  
- **Audit policies** → row-level security once we expose APIs directly to end users.  

These layers build on top of the core schema presented here, so there’s no need to introduce them until the product requires it.

---

*Last updated:* 2025-11-14  
*Owner:* Backend Team (Orionly v2)

