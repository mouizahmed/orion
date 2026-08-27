alter table public.integration_connections
  drop constraint integration_connections_provider_check,
  add constraint integration_connections_provider_check check (btrim(provider) <> '');

alter table public.calendar_sync_state
  add column calendar_status text not null default 'idle'
    check (calendar_status in ('idle', 'syncing', 'success', 'partial', 'error')),
  add column events_status text not null default 'idle'
    check (events_status in ('idle', 'syncing', 'success', 'partial', 'error')),
  add column calendar_sync_started_at timestamptz,
  add column events_sync_started_at timestamptz,
  add column calendar_last_error text,
  add column events_last_error text;

update public.calendar_sync_state
set calendar_status = status,
    events_status = status,
    calendar_sync_started_at = sync_started_at,
    events_sync_started_at = sync_started_at,
    calendar_last_error = last_error,
    events_last_error = last_error;

alter table public.calendar_sync_state
  drop column status,
  drop column sync_started_at,
  drop column last_error;

create table public.integration_capabilities (
  user_id uuid not null,
  connection_id uuid not null,
  capability_key text not null check (btrim(capability_key) <> ''),
  enabled boolean not null default true,
  required_scopes text[] not null default '{}'::text[],
  granted_scopes text[] not null default '{}'::text[],
  status text not null default 'active'
    check (status in ('active', 'disabled', 'consent_required', 'needs_reconnect', 'error')),
  last_success_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, connection_id, capability_key),
  foreign key (connection_id, user_id)
    references public.integration_connections(id, user_id) on delete cascade
);

insert into public.integration_capabilities (
  user_id, connection_id, capability_key, enabled, required_scopes,
  granted_scopes, status, last_success_at
)
select c.user_id,
       c.id,
       'calendar.read',
       c.status = 'active',
       case when nullif(btrim(c.scopes), '') is null then '{}'::text[]
            else regexp_split_to_array(btrim(c.scopes), E'\\s+') end,
       case when nullif(btrim(c.scopes), '') is null then '{}'::text[]
            else regexp_split_to_array(btrim(c.scopes), E'\\s+') end,
       case c.status
         when 'active' then 'active'
         when 'needs_reconnect' then 'needs_reconnect'
         else 'disabled'
       end,
       c.updated_at
from public.integration_connections c
where c.provider in ('google', 'microsoft');

create table public.integration_webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid,
  provider text not null check (btrim(provider) <> ''),
  capability_key text not null check (btrim(capability_key) <> ''),
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  provider_subscription_id text,
  watched_resource_id text,
  callback_url text,
  verification_secret_ciphertext text,
  verification_secret_hash text,
  status text not null default 'active'
    check (status in ('pending', 'active', 'renewing', 'disabled', 'failed')),
  expires_at timestamptz,
  renewal_attempted_at timestamptz,
  last_notification_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (connection_id, user_id)
    references public.integration_connections(id, user_id) on delete cascade,
  foreign key (user_id, connection_id, capability_key)
    references public.integration_capabilities(user_id, connection_id, capability_key) on delete cascade,
  check (connection_id is not null or direction = 'outbound')
);
create unique index integration_webhook_subscriptions_provider_key
  on public.integration_webhook_subscriptions (user_id, provider, provider_subscription_id)
  where provider_subscription_id is not null;
create index integration_webhook_subscriptions_renewal_idx
  on public.integration_webhook_subscriptions (status, expires_at)
  where status in ('active', 'renewing') and expires_at is not null;
create index integration_webhook_subscriptions_tenant_renewal_idx
  on public.integration_webhook_subscriptions (user_id, expires_at)
  where status in ('active', 'renewing') and expires_at is not null;
create index integration_webhook_subscriptions_connection_owner_idx
  on public.integration_webhook_subscriptions (connection_id, user_id)
  where connection_id is not null;

create table public.integration_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid,
  capability_key text not null check (btrim(capability_key) <> ''),
  provider_resource_key text not null default '',
  job_kind text not null check (btrim(job_kind) <> ''),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  leased_by text,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_kind, idempotency_key),
  foreign key (connection_id, user_id)
    references public.integration_connections(id, user_id) on delete cascade,
  foreign key (user_id, connection_id, capability_key)
    references public.integration_capabilities(user_id, connection_id, capability_key) on delete cascade
);
create index integration_jobs_due_idx
  on public.integration_jobs (available_at, created_at)
  where status in ('pending', 'failed');
create index integration_jobs_tenant_due_idx
  on public.integration_jobs (user_id, available_at, created_at)
  where status in ('pending', 'failed');
create index integration_jobs_lease_idx
  on public.integration_jobs (lease_expires_at)
  where status = 'running';
create index integration_jobs_connection_owner_idx
  on public.integration_jobs (connection_id, user_id)
  where connection_id is not null;

create table public.integration_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid,
  provider text not null check (btrim(provider) <> ''),
  capability_key text not null check (btrim(capability_key) <> ''),
  provider_event_id text not null check (btrim(provider_event_id) <> ''),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'rejected', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_code text,
  unique (user_id, provider, capability_key, provider_event_id),
  foreign key (connection_id, user_id)
    references public.integration_connections(id, user_id) on delete cascade,
  foreign key (user_id, connection_id, capability_key)
    references public.integration_capabilities(user_id, connection_id, capability_key) on delete cascade
);
create index integration_webhook_receipts_connection_owner_idx
  on public.integration_webhook_receipts (connection_id, user_id)
  where connection_id is not null;
create index integration_webhook_receipts_unprocessed_idx
  on public.integration_webhook_receipts (received_at)
  where status in ('received', 'failed');
create index integration_webhook_receipts_tenant_unprocessed_idx
  on public.integration_webhook_receipts (user_id, received_at)
  where status in ('received', 'failed');

create table public.integration_outbox_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  subscription_id uuid,
  event_type text not null check (btrim(event_type) <> ''),
  aggregate_type text not null check (btrim(aggregate_type) <> ''),
  aggregate_id text not null check (btrim(aggregate_id) <> ''),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'delivering', 'delivered', 'failed', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 12 check (max_attempts > 0),
  available_at timestamptz not null default now(),
  leased_by text,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  unique (id, user_id),
  foreign key (subscription_id, user_id)
    references public.integration_webhook_subscriptions(id, user_id) on delete cascade
);
create index integration_outbox_events_due_idx
  on public.integration_outbox_events (available_at, created_at)
  where status in ('pending', 'failed');
create index integration_outbox_events_tenant_due_idx
  on public.integration_outbox_events (user_id, available_at, created_at)
  where status in ('pending', 'failed');
create index integration_outbox_events_subscription_owner_idx
  on public.integration_outbox_events (subscription_id, user_id)
  where subscription_id is not null;

create table public.integration_delivery_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  outbox_event_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  outcome text not null
    check (outcome in ('delivered', 'retryable_failure', 'permanent_failure')),
  response_status integer check (response_status between 100 and 599),
  error_code text,
  attempted_at timestamptz not null default now(),
  unique (outbox_event_id, attempt_number),
  foreign key (outbox_event_id, user_id)
    references public.integration_outbox_events(id, user_id) on delete cascade
);
create index integration_delivery_attempts_owner_idx
  on public.integration_delivery_attempts (user_id, outbox_event_id);
create index integration_delivery_attempts_event_owner_idx
  on public.integration_delivery_attempts (outbox_event_id, user_id);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'integration_connections','integration_capabilities','integration_webhook_subscriptions',
    'integration_jobs','integration_webhook_receipts','integration_outbox_events',
    'integration_delivery_attempts','calendar_preferences','calendar_sources',
    'calendar_events','calendar_event_attendees','calendar_sync_state',
    'note_calendar_links','note_attendee_suppressions'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('drop policy if exists backend_only on public.%I', table_name);
    execute format('drop policy if exists backend_tenant_only on public.%I', table_name);
    execute format(
      'create policy backend_tenant_only on public.%I for all to orion_backend using (user_id = nullif(current_setting(''app.current_user_id'', true), '''')::uuid) with check (user_id = nullif(current_setting(''app.current_user_id'', true), '''')::uuid)',
      table_name
    );
  end loop;
end $$;

grant select, insert, update, delete on
  public.integration_capabilities,
  public.integration_webhook_subscriptions,
  public.integration_jobs,
  public.integration_webhook_receipts,
  public.integration_outbox_events,
  public.integration_delivery_attempts
to orion_backend;
grant usage on sequence public.integration_delivery_attempts_id_seq to orion_backend;
