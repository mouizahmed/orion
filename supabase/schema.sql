-- Orion canonical development schema.
-- The application uses managed Supabase Auth and a trusted Go backend. Supabase's
-- Data API roles intentionally have no access to application data.

begin;

drop schema if exists orion_internal cascade;
drop table if exists public.note_shares cascade;
drop table if exists public.note_attendees cascade;
drop table if exists public.calendar_sync_state cascade;
drop table if exists public.calendar_events cascade;
drop table if exists public.calendar_sources cascade;
drop table if exists public.calendar_preferences cascade;
drop table if exists public.integration_connections cascade;
drop table if exists public.note_attachments cascade;
drop table if exists public.note_recording_sessions cascade;
drop table if exists public.transcript_segments cascade;
drop table if exists public.note_versions cascade;
drop table if exists public.messages cascade;
drop table if exists public.conversations cascade;
drop table if exists public.notes cascade;
drop table if exists public.folders cascade;
drop table if exists public.user_auth_identities cascade;
drop table if exists public.users cascade;
drop type if exists public.user_plan cascade;
drop type if exists public.user_status cascade;

create type public.user_plan as enum ('free', 'professional', 'business');
create type public.user_status as enum ('active', 'suspended', 'deleted');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  avatar_url text,
  plan public.user_plan not null default 'free',
  api_quota_used integer not null default 0 check (api_quota_used >= 0),
  api_quota_limit integer not null default 1000 check (api_quota_limit >= 0),
  status public.user_status not null default 'active',
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint users_email_not_blank check (btrim(email) <> ''),
  constraint users_name_not_blank check (btrim(name) <> ''),
  constraint users_lifecycle_consistent check (
    (status = 'deleted' and deleted_at is not null)
    or (status <> 'deleted' and deleted_at is null)
  )
);
create index users_normalized_email_idx on public.users (lower(btrim(email)));

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id)
);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  provider_account_id text not null,
  provider_email text,
  display_name text,
  access_token text not null,
  refresh_token text,
  encryption_key_version integer not null default 1 check (encryption_key_version > 0),
  expires_at timestamptz,
  scopes text,
  metadata jsonb,
  status text not null default 'active' check (status in ('active', 'needs_reconnect', 'disconnected')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disconnected_at timestamptz,
  unique (user_id, provider, provider_account_id),
  unique (id, user_id)
);

create table public.calendar_preferences (
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid not null,
  calendar_id text not null,
  visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, connection_id, calendar_id),
  foreign key (connection_id, user_id)
    references public.integration_connections(id, user_id) on delete cascade
);

create table public.calendar_sources (
  user_id uuid not null,
  connection_id uuid not null,
  calendar_id text not null,
  provider text not null check (provider in ('google', 'microsoft')),
  account_email text,
  name text not null default '',
  color text,
  background_color text,
  foreground_color text,
  primary_calendar boolean not null default false,
  selected boolean not null default false,
  access_role text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sync_token text,
  sync_window_start timestamptz,
  sync_window_end timestamptz,
  primary key (user_id, connection_id, calendar_id),
  foreign key (connection_id, user_id)
    references public.integration_connections(id, user_id) on delete cascade
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  connection_id uuid not null,
  calendar_id text not null,
  provider_event_id text not null,
  provider text not null check (provider in ('google', 'microsoft')),
  account_email text,
  title text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  location text,
  description text,
  meeting_link text,
  calendar_name text,
  color text,
  organizer text,
  attendees jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  all_day boolean not null default false,
  event_link text,
  unique (user_id, connection_id, calendar_id, provider_event_id),
  unique (id, user_id),
  foreign key (user_id, connection_id, calendar_id)
    references public.calendar_sources(user_id, connection_id, calendar_id) on delete cascade
);
create index calendar_events_user_start_idx on public.calendar_events (user_id, start_at);

create table public.calendar_sync_state (
  user_id uuid not null,
  connection_id uuid not null,
  status text not null default 'idle' check (status in ('idle', 'syncing', 'success', 'error')),
  calendar_last_synced_at timestamptz,
  events_last_synced_at timestamptz,
  sync_started_at timestamptz,
  last_error text,
  events_window_start timestamptz,
  events_window_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, connection_id),
  foreign key (connection_id, user_id)
    references public.integration_connections(id, user_id) on delete cascade
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  folder_id uuid,
  title text not null default 'Untitled note',
  note_markdown text not null default '',
  transcript_text text not null default '',
  overview_json text not null default '',
  calendar_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (folder_id, user_id) references public.folders(id, user_id),
  foreign key (calendar_event_id, user_id) references public.calendar_events(id, user_id)
);
create index notes_user_updated_idx on public.notes (user_id, updated_at desc) where deleted_at is null;

create table public.note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  note_markdown text not null,
  created_at timestamptz not null default now()
);

create table public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  channel integer not null default 0,
  text text not null,
  start_time double precision,
  end_time double precision,
  segment_index integer not null,
  created_at timestamptz not null default now(),
  unique (note_id, channel, segment_index)
);

create table public.note_recording_sessions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'stopped')),
  started_at timestamptz not null default now(),
  paused_at timestamptz,
  stopped_at timestamptz,
  transcript_chunks jsonb not null default '[]'::jsonb,
  last_activity_at timestamptz not null default now(),
  foreign key (note_id, user_id) references public.notes(id, user_id) on delete cascade
);

create table public.note_attachments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  b2_file_id text not null,
  b2_file_name text not null,
  public_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (note_id, user_id) references public.notes(id, user_id) on delete cascade
);

create table public.note_attendees (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  email text not null,
  user_id uuid references public.users(id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'calendar')),
  created_at timestamptz not null default now()
);
create unique index note_attendees_note_email_key on public.note_attendees (note_id, lower(btrim(email)));

create table public.note_shares (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null,
  shared_by uuid not null references public.users(id) on delete cascade,
  email text not null,
  user_id uuid references public.users(id) on delete set null,
  role text not null check (role in ('viewer', 'editor')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (note_id, shared_by) references public.notes(id, user_id) on delete cascade
);
create unique index note_shares_note_email_key on public.note_shares (note_id, lower(btrim(email)));

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null default 'New conversation',
  summary text not null default '',
  summary_through_message_id uuid,
  note_id uuid,
  folder_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id),
  foreign key (note_id, user_id) references public.notes(id, user_id),
  foreign key (folder_id, user_id) references public.folders(id, user_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null default '',
  tool_calls jsonb,
  tool_call_id text,
  token_count integer not null default 0 check (token_count >= 0),
  thinking text not null default '',
  thinking_duration integer not null default 0 check (thinking_duration >= 0),
  created_at timestamptz not null default now()
);
alter table public.conversations
  add foreign key (summary_through_message_id) references public.messages(id) on delete set null;

create index folders_user_idx on public.folders (user_id) where deleted_at is null;
create index folders_user_fk_idx on public.folders (user_id);
create index integration_connections_active_idx on public.integration_connections (user_id, provider) where status = 'active';
create index calendar_preferences_connection_owner_idx on public.calendar_preferences (connection_id, user_id);
create index calendar_sources_connection_owner_idx on public.calendar_sources (connection_id, user_id);
create index calendar_sync_state_connection_owner_idx on public.calendar_sync_state (connection_id, user_id);
create index notes_user_fk_idx on public.notes (user_id);
create index notes_folder_owner_idx on public.notes (folder_id, user_id);
create index notes_calendar_event_owner_idx on public.notes (calendar_event_id, user_id);
create index note_versions_note_idx on public.note_versions (note_id);
create index recording_sessions_note_owner_idx on public.note_recording_sessions (note_id, user_id);
create index recording_sessions_user_idx on public.note_recording_sessions (user_id);
create index note_attachments_note_owner_idx on public.note_attachments (note_id, user_id);
create index note_attachments_user_idx on public.note_attachments (user_id);
create index note_attendees_user_idx on public.note_attendees (user_id);
create index note_shares_note_owner_idx on public.note_shares (note_id, shared_by);
create index note_shares_shared_by_idx on public.note_shares (shared_by);
create index note_shares_user_idx on public.note_shares (user_id);
create index conversations_user_idx on public.conversations (user_id);
create index conversations_note_owner_idx on public.conversations (note_id, user_id);
create index conversations_folder_owner_idx on public.conversations (folder_id, user_id);
create index conversations_summary_message_idx on public.conversations (summary_through_message_id);
create index transcript_segments_note_idx on public.transcript_segments (note_id, segment_index);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);

-- Defense in depth: even table owners must respect RLS if a future policy is
-- introduced. No policies exist because application access is backend-only.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'users','folders','integration_connections',
    'calendar_preferences','calendar_sources','calendar_events','calendar_sync_state',
    'notes','note_versions','transcript_segments','note_recording_sessions',
    'note_attachments','note_attendees','note_shares','conversations','messages'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'orion_backend') then
    create role orion_backend login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  else
    alter role orion_backend login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
  end if;
end $$;

-- Supabase access tokens can remain valid until their JWT expiry after logout.
-- This deliberately tiny security-definer function lets only the backend
-- confirm that the token's session_id still exists, without granting it broad
-- access to the managed auth schema.
create schema orion_internal;
revoke all on schema orion_internal from public, anon, authenticated;

create function orion_internal.is_auth_session_active(
  p_user_id uuid,
  p_session_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.sessions as session
    where session.user_id = p_user_id
      and session.id = p_session_id
      and (session.not_after is null or session.not_after > now())
  )
$$;

revoke all on function orion_internal.is_auth_session_active(uuid, uuid)
  from public, anon, authenticated;
grant usage on schema orion_internal to orion_backend;
grant execute on function orion_internal.is_auth_session_active(uuid, uuid)
  to orion_backend;

revoke all on schema public from public, anon, authenticated;
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
grant usage on schema public to orion_backend;
grant select, insert, update, delete on all tables in schema public to orion_backend;
grant usage, select on all sequences in schema public to orion_backend;
-- Set or rotate this LOGIN role's strong password outside tracked SQL, then
-- configure DATABASE_URL to authenticate directly as it. The backend rejects
-- owner/admin sessions and does not use SET ROLE.
revoke orion_backend from postgres;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'users','folders','integration_connections',
    'calendar_preferences','calendar_sources','calendar_events','calendar_sync_state',
    'notes','note_versions','transcript_segments','note_recording_sessions',
    'note_attachments','note_attendees','note_shares','conversations','messages'
  ] loop
    execute format(
      'create policy backend_only on public.%I for all to orion_backend using (true) with check (true)',
      table_name
    );
  end loop;
end $$;

-- service_role stays available for Supabase administration but is not used by
-- the desktop application. The Go backend authenticates directly as
-- orion_backend and verifies both session_user and current_user at startup.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to orion_backend;
alter default privileges in schema public grant usage, select on sequences to orion_backend;
alter default privileges in schema orion_internal revoke execute on functions from public;

commit;
