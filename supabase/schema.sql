-- Orion canonical development schema.
-- The application uses managed Supabase Auth and a trusted Go backend. Supabase's
-- Data API roles intentionally have no access to application data.

begin;

drop schema if exists orion_internal cascade;
create schema orion_internal;
revoke all on schema orion_internal from public, anon, authenticated;

create function orion_internal.vocabulary_terms_valid(p_terms text[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    cardinality(p_terms) <= 100
    and coalesce(array_ndims(p_terms), 1) = 1
    and not exists (
      select 1
      from unnest(p_terms) as term(value)
      where term.value is null
        or term.value = ''
        or term.value <> btrim(term.value)
        or length(term.value) > 50
    )
    and cardinality(p_terms) = (
      select count(distinct lower(term.value))
      from unnest(p_terms) as term(value)
    )
$$;

drop table if exists public.note_attendee_suppressions cascade;
drop table if exists public.note_attendees cascade;
drop table if exists public.note_calendar_links cascade;
drop table if exists public.calendar_event_attendees cascade;
drop table if exists public.calendar_sync_state cascade;
drop table if exists public.calendar_events cascade;
drop table if exists public.calendar_sources cascade;
drop table if exists public.calendar_preferences cascade;
drop table if exists public.integration_delivery_attempts cascade;
drop table if exists public.integration_outbox_events cascade;
drop table if exists public.integration_webhook_receipts cascade;
drop table if exists public.integration_jobs cascade;
drop table if exists public.integration_webhook_subscriptions cascade;
drop table if exists public.integration_capabilities cascade;
drop table if exists public.integration_connections cascade;
drop table if exists public.note_attachments cascade;
drop table if exists public.note_recording_sessions cascade;
drop table if exists public.transcript_segments cascade;
drop table if exists public.note_versions cascade;
drop table if exists public.messages cascade;
drop table if exists public.conversations cascade;
drop table if exists public.notes cascade;
drop table if exists public.account_extract_field_folders cascade;
drop table if exists public.account_extract_fields cascade;
drop table if exists public.account_summary_template_folders cascade;
drop table if exists public.account_summary_templates cascade;
drop table if exists public.folders cascade;
drop table if exists public.user_auth_identities cascade;
drop table if exists public.account_usage_operations cascade;
drop table if exists public.account_usage_periods cascade;
drop table if exists public.account_plan_changes cascade;
drop table if exists public.billing_webhook_events cascade;
drop table if exists public.subscriptions cascade;
drop table if exists public.billing_customers cascade;
drop table if exists public.account_email_draft_settings cascade;
drop table if exists public.account_vocabulary cascade;
drop table if exists public.accounts cascade;
drop table if exists public.users cascade;
drop type if exists public.user_plan;
drop type if exists public.user_status cascade;

create type public.user_status as enum ('active', 'suspended', 'deleted');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  avatar_url text,
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

create table public.accounts (
  id uuid primary key references public.users(id) on delete cascade,
  effective_plan_key text not null default 'free',
  plan_source text not null default 'default',
  plan_valid_until timestamptz,
  plan_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_effective_plan_key_not_blank check (btrim(effective_plan_key) <> ''),
  constraint accounts_plan_source_valid check (
    plan_source in ('default', 'subscription', 'promotion', 'admin')
  )
);

-- Provider-neutral spelling hints owned by an account. Provider-specific
-- prompting syntax is assembled only at the backend integration boundary.
create table public.account_vocabulary (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  terms text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_vocabulary_terms_valid check (
    orion_internal.vocabulary_terms_valid(terms)
  )
);

-- Account-owned instructions for future email-draft generation. Provider
-- delivery settings belong to the later Gmail/Outlook connector phase.
create table public.account_email_draft_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  enabled boolean not null default true,
  include_sharing_link boolean not null default true,
  draft_prompt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_email_draft_settings_prompt_valid check (
    char_length(draft_prompt) <= 1000
  )
);

create table public.account_plan_changes (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  previous_plan_key text,
  new_plan_key text not null,
  source text not null,
  source_reference text,
  changed_by_user_id uuid references public.users(id) on delete set null,
  reason text,
  changed_at timestamptz not null default now(),
  constraint account_plan_changes_previous_plan_key_not_blank check (
    previous_plan_key is null or btrim(previous_plan_key) <> ''
  ),
  constraint account_plan_changes_new_plan_key_not_blank check (
    btrim(new_plan_key) <> ''
  ),
  constraint account_plan_changes_plan_changed check (
    previous_plan_key is distinct from new_plan_key
  ),
  constraint account_plan_changes_source_valid check (
    source in ('default', 'subscription', 'promotion', 'admin', 'reconciliation')
  )
);
create index account_plan_changes_account_idx
  on public.account_plan_changes (account_id, changed_at desc, id desc);
create index account_plan_changes_changed_by_user_idx
  on public.account_plan_changes (changed_by_user_id)
  where changed_by_user_id is not null;

create table public.account_usage_periods (
  account_id uuid not null references public.accounts(id) on delete cascade,
  meter_key text not null,
  period_started_at timestamptz not null,
  period_ends_at timestamptz not null,
  consumed_quantity bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, meter_key, period_started_at),
  constraint account_usage_periods_meter_key_valid check (
    meter_key = btrim(meter_key)
    and meter_key <> ''
    and length(meter_key) <= 64
  ),
  constraint account_usage_periods_period_valid check (
    period_ends_at > period_started_at
  ),
  constraint account_usage_periods_consumed_quantity_valid check (
    consumed_quantity >= 0
  )
);
create index account_usage_periods_active_lookup_idx
  on public.account_usage_periods (account_id, meter_key, period_ends_at desc);

-- Mutable operation totals are retained only with their usage period. They are
-- deduplication state, not an immutable or customer-facing usage-event ledger.
create table public.account_usage_operations (
  account_id uuid not null,
  meter_key text not null,
  period_started_at timestamptz not null,
  operation_key text not null,
  consumed_quantity bigint not null default 0,
  period_consumed_after bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, meter_key, period_started_at, operation_key),
  foreign key (account_id, meter_key, period_started_at)
    references public.account_usage_periods(account_id, meter_key, period_started_at)
    on delete cascade,
  constraint account_usage_operations_operation_key_valid check (
    operation_key = btrim(operation_key)
    and operation_key <> ''
    and length(operation_key) <= 200
  ),
  constraint account_usage_operations_consumed_quantity_valid check (
    consumed_quantity >= 0
  ),
  constraint account_usage_operations_period_consumed_after_valid check (
    period_consumed_after >= consumed_quantity
  )
);

-- Provider customer identities are billing integration state, not account
-- entitlement state. Runtime access is limited to the billing repository.
create table public.billing_customers (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider text not null default 'stripe',
  provider_customer_id text not null,
  livemode boolean not null,
  provider_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint billing_customers_provider_valid check (provider = 'stripe'),
  constraint billing_customers_provider_customer_id_valid check (
    provider_customer_id = btrim(provider_customer_id)
    and provider_customer_id <> ''
    and length(provider_customer_id) <= 255
  ),
  constraint billing_customers_account_provider_mode_key
    unique (account_id, provider, livemode),
  constraint billing_customers_provider_customer_mode_key
    unique (provider, provider_customer_id, livemode)
);

-- Local projection and history of provider subscription state. Stripe remains
-- authoritative; the backend may only select, insert, and update projections.
create table public.subscriptions (
  id bigint generated always as identity primary key,
  billing_customer_id bigint not null
    references public.billing_customers(id) on delete cascade,
  provider_subscription_id text not null,
  provider_subscription_item_id text not null,
  provider_price_id text not null,
  provider_latest_invoice_id text,
  plan_key text not null,
  status text not null,
  is_current boolean not null default true,
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  ended_at timestamptz,
  provider_created_at timestamptz not null,
  last_synced_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_provider_subscription_id_valid check (
    provider_subscription_id = btrim(provider_subscription_id)
    and provider_subscription_id <> ''
    and length(provider_subscription_id) <= 255
  ),
  constraint subscriptions_provider_subscription_item_id_valid check (
    provider_subscription_item_id = btrim(provider_subscription_item_id)
    and provider_subscription_item_id <> ''
    and length(provider_subscription_item_id) <= 255
  ),
  constraint subscriptions_provider_price_id_valid check (
    provider_price_id = btrim(provider_price_id)
    and provider_price_id <> ''
    and length(provider_price_id) <= 255
  ),
  constraint subscriptions_provider_latest_invoice_id_valid check (
    provider_latest_invoice_id is null
    or (
      provider_latest_invoice_id = btrim(provider_latest_invoice_id)
      and provider_latest_invoice_id <> ''
      and length(provider_latest_invoice_id) <= 255
    )
  ),
  constraint subscriptions_plan_key_valid check (
    plan_key = btrim(plan_key)
    and plan_key <> ''
    and length(plan_key) <= 64
  ),
  constraint subscriptions_status_valid check (status in (
    'incomplete',
    'incomplete_expired',
    'trialing',
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'paused'
  )),
  constraint subscriptions_customer_provider_subscription_key
    unique (billing_customer_id, provider_subscription_id),
  constraint subscriptions_current_period_valid check (
    current_period_started_at is null
    or current_period_ends_at is null
    or current_period_ends_at > current_period_started_at
  ),
  constraint subscriptions_trial_period_valid check (
    trial_started_at is null
    or trial_ends_at is null
    or trial_ends_at > trial_started_at
  )
);
create index subscriptions_customer_history_idx
  on public.subscriptions (billing_customer_id, provider_created_at desc);
create unique index subscriptions_one_current_per_customer_idx
  on public.subscriptions (billing_customer_id)
  where is_current;

-- Durable receipt inbox for verified provider events. Only the backend can
-- receive, process, retain, and purge verified Stripe event payloads.
create table public.billing_webhook_events (
  id bigint generated always as identity primary key,
  provider text not null default 'stripe',
  provider_event_id text not null,
  event_type text not null,
  livemode boolean not null,
  provider_created_at timestamptz not null,
  payload jsonb not null,
  processing_status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text,
  purge_after timestamptz not null,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_webhook_events_provider_valid check (provider = 'stripe'),
  constraint billing_webhook_events_provider_event_id_valid check (
    provider_event_id = btrim(provider_event_id)
    and provider_event_id <> ''
    and length(provider_event_id) <= 255
  ),
  constraint billing_webhook_events_event_type_valid check (
    event_type = btrim(event_type)
    and event_type <> ''
    and length(event_type) <= 255
  ),
  constraint billing_webhook_events_payload_valid check (
    jsonb_typeof(payload) = 'object'
  ),
  constraint billing_webhook_events_processing_status_valid check (
    processing_status in ('pending', 'processing', 'processed', 'failed', 'ignored')
  ),
  constraint billing_webhook_events_attempt_count_valid check (attempt_count >= 0),
  constraint billing_webhook_events_processing_started_at_valid check (
    processing_started_at is null or processing_started_at >= received_at
  ),
  constraint billing_webhook_events_processed_at_valid check (
    processed_at is null or processed_at >= received_at
  ),
  constraint billing_webhook_events_last_error_valid check (
    last_error is null or last_error in ('subscription_sync_failed')
  ),
  constraint billing_webhook_events_purge_after_valid check (
    purge_after > received_at
  ),
  constraint billing_webhook_events_provider_event_key
    unique (provider, provider_event_id)
);
create index billing_webhook_events_pending_idx
  on public.billing_webhook_events (next_attempt_at, received_at)
  where processing_status in ('pending', 'failed');

insert into public.accounts (id)
select id
from public.users
where status = 'active' and deleted_at is null;

insert into public.account_plan_changes (
  account_id,
  previous_plan_key,
  new_plan_key,
  source,
  reason,
  changed_at
)
select
  id,
  null,
  effective_plan_key,
  plan_source,
  'Initial account state',
  plan_changed_at
from public.accounts;

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id)
);

-- User-defined extraction settings. These rows are configuration only; no
-- transcript processing reads them until the extraction feature is added.
create table public.account_extract_fields (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  prompt text not null,
  insight_cardinality text not null default 'multiple',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_extract_fields_name_valid check (
    name = btrim(name) and name <> '' and length(name) <= 100
  ),
  constraint account_extract_fields_prompt_valid check (
    prompt = btrim(prompt) and prompt <> '' and length(prompt) <= 4000
  ),
  constraint account_extract_fields_cardinality_valid check (
    insight_cardinality in ('single', 'multiple')
  ),
  unique (id, account_id)
);
create unique index account_extract_fields_account_name_idx
  on public.account_extract_fields (account_id, lower(name));
create index account_extract_fields_account_created_idx
  on public.account_extract_fields (account_id, created_at, id);

-- No rows means all meetings. One or more rows means the field targets exactly
-- those folders. account_id is repeated so both sides are ownership-enforced.
create table public.account_extract_field_folders (
  extract_field_id uuid not null,
  account_id uuid not null,
  folder_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (extract_field_id, folder_id),
  constraint account_extract_field_folders_field_owner_fk
    foreign key (extract_field_id, account_id)
    references public.account_extract_fields(id, account_id)
    on delete cascade,
  constraint account_extract_field_folders_folder_owner_fk
    foreign key (folder_id, account_id)
    references public.folders(id, user_id)
);
create index account_extract_field_folders_account_folder_idx
  on public.account_extract_field_folders (account_id, folder_id);
create index account_extract_field_folders_field_owner_idx
  on public.account_extract_field_folders (extract_field_id, account_id);
create index account_extract_field_folders_folder_owner_idx
  on public.account_extract_field_folders (folder_id, account_id);

-- User-defined summary templates. These rows are configuration only; no
-- meeting processing reads them until summary template execution is added.
create table public.account_summary_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  prompt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_summary_templates_name_valid check (
    name = btrim(name) and name <> '' and length(name) <= 100
  ),
  constraint account_summary_templates_prompt_valid check (
    prompt = btrim(prompt) and prompt <> '' and length(prompt) <= 4000
  ),
  unique (id, account_id)
);
create unique index account_summary_templates_account_name_idx
  on public.account_summary_templates (account_id, lower(name));
create index account_summary_templates_account_created_idx
  on public.account_summary_templates (account_id, created_at, id);

-- A template may target many folders, but each folder may be assigned to at
-- most one summary template. account_id enforces ownership across both FKs.
create table public.account_summary_template_folders (
  summary_template_id uuid not null,
  account_id uuid not null,
  folder_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (summary_template_id, folder_id),
  constraint account_summary_template_folders_template_owner_fk
    foreign key (summary_template_id, account_id)
    references public.account_summary_templates(id, account_id)
    on delete cascade,
  constraint account_summary_template_folders_folder_owner_fk
    foreign key (folder_id, account_id)
    references public.folders(id, user_id),
  constraint account_summary_template_folders_one_template_per_folder
    unique (account_id, folder_id)
);
create index account_summary_template_folders_template_owner_idx
  on public.account_summary_template_folders (summary_template_id, account_id);
create index account_summary_template_folders_folder_owner_idx
  on public.account_summary_template_folders (folder_id, account_id);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (btrim(provider) <> ''),
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

create table public.integration_capabilities (
  user_id uuid not null,
  connection_id uuid not null,
  capability_key text not null check (btrim(capability_key) <> ''),
  enabled boolean not null default true,
  required_scopes text[] not null default '{}'::text[],
  granted_scopes text[] not null default '{}'::text[],
  status text not null default 'active' check (status in ('active', 'disabled', 'consent_required', 'needs_reconnect', 'error')),
  last_success_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, connection_id, capability_key),
  foreign key (connection_id, user_id)
    references public.integration_connections(id, user_id) on delete cascade
);
create index integration_capabilities_connection_owner_idx
  on public.integration_capabilities (connection_id, user_id);

create table public.integration_webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid,
  provider text not null check (btrim(provider) <> ''),
  capability_key text not null check (btrim(capability_key) <> ''),
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  provider_subscription_id text,
  watched_resource_id text,
  provider_resource_id text,
  supersedes_subscription_id uuid,
  generation integer not null default 1 check (generation > 0),
  callback_url text,
  verification_secret_ciphertext text,
  verification_secret_hash text,
  status text not null default 'active' check (status in ('pending', 'active', 'renewing', 'retiring', 'disabled', 'failed')),
  expires_at timestamptz,
  renewal_attempted_at timestamptz,
  next_attempt_at timestamptz,
  last_notification_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (connection_id, user_id)
    references public.integration_connections(id, user_id) on delete cascade,
  foreign key (user_id, connection_id, capability_key)
    references public.integration_capabilities(user_id, connection_id, capability_key) on delete cascade,
  foreign key (supersedes_subscription_id, user_id)
    references public.integration_webhook_subscriptions(id, user_id)
    on delete set null (supersedes_subscription_id),
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
create index integration_webhook_subscriptions_capability_owner_idx
  on public.integration_webhook_subscriptions (user_id, connection_id, capability_key);
create index integration_webhook_subscriptions_resource_idx
  on public.integration_webhook_subscriptions (user_id, connection_id, watched_resource_id, generation desc)
  where direction = 'inbound';
create index integration_webhook_subscriptions_supersedes_owner_idx
  on public.integration_webhook_subscriptions (supersedes_subscription_id, user_id)
  where supersedes_subscription_id is not null;
create index integration_webhook_subscriptions_retry_idx
  on public.integration_webhook_subscriptions (next_attempt_at)
  where status in ('pending', 'renewing', 'failed') and next_attempt_at is not null;

create table public.integration_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid,
  capability_key text not null check (btrim(capability_key) <> ''),
  provider_resource_key text not null default '',
  job_kind text not null check (btrim(job_kind) <> ''),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed', 'dead')),
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
create index integration_jobs_capability_owner_idx
  on public.integration_jobs (user_id, connection_id, capability_key);
create index integration_jobs_terminal_retention_idx
  on public.integration_jobs (updated_at, id)
  where status in ('succeeded', 'dead');

create table public.integration_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid,
  provider text not null check (btrim(provider) <> ''),
  capability_key text not null check (btrim(capability_key) <> ''),
  provider_event_id text not null check (btrim(provider_event_id) <> ''),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'received' check (status in ('received', 'processing', 'processed', 'rejected', 'failed')),
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
create index integration_webhook_receipts_capability_owner_idx
  on public.integration_webhook_receipts (user_id, connection_id, capability_key);
create index integration_webhook_receipts_unprocessed_idx
  on public.integration_webhook_receipts (received_at)
  where status in ('received', 'failed');
create index integration_webhook_receipts_tenant_unprocessed_idx
  on public.integration_webhook_receipts (user_id, received_at)
  where status in ('received', 'failed');
create index integration_webhook_receipts_terminal_retention_idx
  on public.integration_webhook_receipts ((coalesce(processed_at, received_at)), id)
  where status in ('processed', 'rejected');

create table public.integration_outbox_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  subscription_id uuid,
  event_type text not null check (btrim(event_type) <> ''),
  aggregate_type text not null check (btrim(aggregate_type) <> ''),
  aggregate_id text not null check (btrim(aggregate_id) <> ''),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'delivering', 'delivered', 'failed', 'dead')),
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
create index integration_outbox_events_terminal_retention_idx
  on public.integration_outbox_events (updated_at, id)
  where status in ('delivered', 'dead');

create table public.integration_delivery_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  outbox_event_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  outcome text not null check (outcome in ('delivered', 'retryable_failure', 'permanent_failure')),
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
  organizer_name text,
  organizer_email text,
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

create table public.calendar_event_attendees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  calendar_event_id uuid not null,
  provider_attendee_id text,
  email text not null check (btrim(email) <> ''),
  display_name text not null default '',
  response_status text not null default 'unknown',
  attendee_type text not null default 'required',
  optional boolean not null default false,
  organizer boolean not null default false,
  self_attendee boolean not null default false,
  resource boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (calendar_event_id, user_id)
    references public.calendar_events(id, user_id) on delete cascade
);
create unique index calendar_event_attendees_event_email_key
  on public.calendar_event_attendees (calendar_event_id, lower(btrim(email)));
create index calendar_event_attendees_owner_idx
  on public.calendar_event_attendees (user_id, calendar_event_id);
create index calendar_event_attendees_event_owner_idx
  on public.calendar_event_attendees (calendar_event_id, user_id);

create table public.calendar_sync_state (
  user_id uuid not null,
  connection_id uuid not null,
  calendar_status text not null default 'idle' check (calendar_status in ('idle', 'syncing', 'success', 'partial', 'error')),
  events_status text not null default 'idle' check (events_status in ('idle', 'syncing', 'success', 'partial', 'error')),
  calendar_last_synced_at timestamptz,
  events_last_synced_at timestamptz,
  calendar_sync_started_at timestamptz,
  events_sync_started_at timestamptz,
  calendar_last_error text,
  events_last_error text,
  events_window_start timestamptz,
  events_window_end timestamptz,
  last_full_synced_at timestamptz,
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
  revision bigint not null default 1,
  calendar_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint notes_revision_positive check (revision > 0),
  unique (id, user_id),
  foreign key (folder_id, user_id) references public.folders(id, user_id),
  constraint notes_calendar_event_owner_fk
    foreign key (calendar_event_id, user_id)
    references public.calendar_events(id, user_id)
    on delete set null (calendar_event_id)
);
create index notes_user_updated_idx on public.notes (user_id, updated_at desc) where deleted_at is null;
create unique index notes_one_per_event_idx
  on public.notes (user_id, calendar_event_id)
  where calendar_event_id is not null and deleted_at is null;

create table public.note_calendar_links (
  note_id uuid primary key,
  user_id uuid not null,
  calendar_event_id uuid,
  snapshot_event_id uuid not null,
  provider_event_id text not null,
  connection_id uuid not null,
  calendar_id text not null,
  provider text not null check (provider in ('google', 'microsoft')),
  account_email text,
  title text not null default '',
  start_at timestamptz not null,
  end_at timestamptz not null,
  all_day boolean not null default false,
  location text,
  meeting_link text,
  event_link text,
  calendar_name text,
  color text,
  organizer_name text,
  organizer_email text,
  attendees_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (note_id, user_id) references public.notes(id, user_id) on delete cascade,
  foreign key (calendar_event_id, user_id)
    references public.calendar_events(id, user_id)
    on delete set null (calendar_event_id)
);
create index note_calendar_links_owner_idx on public.note_calendar_links (user_id, note_id);
create index note_calendar_links_note_owner_idx on public.note_calendar_links (note_id, user_id);
create index note_calendar_links_live_event_idx
  on public.note_calendar_links (calendar_event_id, user_id)
  where calendar_event_id is not null;
create index note_calendar_links_connection_idx on public.note_calendar_links (user_id, connection_id);

create table public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.notes(id) on delete cascade,
  channel integer not null default 0,
  text text not null,
  start_time double precision,
  end_time double precision,
  segment_index integer not null,
  session_id uuid,
  words jsonb,
  provider text,
  provider_segment_id text,
  created_at timestamptz not null default now(),
  unique (session_id, channel, segment_index)
);

create table public.note_recording_sessions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'starting'
    check (status in ('starting', 'recording', 'finalizing', 'complete', 'failed', 'abandoned')),
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  last_activity_at timestamptz not null default now(),
  client_session_id text not null unique,
  finalized_at timestamptz,
  audio_stored text not null default 'none'
    check (audio_stored in ('none', 'local', 'uploaded')),
  foreign key (note_id, user_id) references public.notes(id, user_id) on delete cascade
);

alter table public.transcript_segments
  add foreign key (session_id) references public.note_recording_sessions(id);

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
  display_name text not null default '',
  source text not null default 'manual' check (source in ('manual', 'calendar')),
  created_at timestamptz not null default now()
);
create unique index note_attendees_note_email_key on public.note_attendees (note_id, lower(btrim(email)));

create table public.note_attendee_suppressions (
  note_id uuid not null references public.notes(id) on delete cascade,
  email text not null check (btrim(email) <> ''),
  created_at timestamptz not null default now(),
  primary key (note_id, email)
);
create unique index note_attendee_suppressions_normalized_key
  on public.note_attendee_suppressions (note_id, lower(btrim(email)));

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
create index note_attendees_note_idx on public.note_attendees (note_id);
create index recording_sessions_note_owner_idx on public.note_recording_sessions (note_id, user_id);
create index recording_sessions_user_idx on public.note_recording_sessions (user_id);
create unique index one_active_recording_per_user
  on public.note_recording_sessions (user_id)
  where status in ('starting', 'recording', 'finalizing');
create index note_attachments_note_owner_idx on public.note_attachments (note_id, user_id);
create index note_attachments_user_idx on public.note_attachments (user_id);
create index conversations_user_idx on public.conversations (user_id);
create index conversations_note_owner_idx on public.conversations (note_id, user_id);
create index conversations_folder_owner_idx on public.conversations (folder_id, user_id);
create index conversations_summary_message_idx on public.conversations (summary_through_message_id);
create index transcript_segments_note_idx on public.transcript_segments (note_id, segment_index);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at);

-- Defense in depth: even table owners must respect RLS. There are no client
-- policies; only the dedicated backend role receives application-data access.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'users','accounts','account_vocabulary','account_email_draft_settings','account_extract_fields',
    'account_extract_field_folders','account_summary_templates','account_summary_template_folders',
    'account_plan_changes','account_usage_periods',
    'account_usage_operations','billing_customers','subscriptions',
    'billing_webhook_events','folders','integration_connections','integration_capabilities',
    'integration_webhook_subscriptions','integration_jobs','integration_webhook_receipts',
    'integration_outbox_events','integration_delivery_attempts',
    'calendar_preferences','calendar_sources','calendar_events','calendar_event_attendees','calendar_sync_state',
    'notes','transcript_segments','note_recording_sessions',
    'note_attachments','note_calendar_links','note_attendees','note_attendee_suppressions','conversations','messages'
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

-- Narrow coordinator function for the durable integration worker. It exposes
-- only tenant IDs that currently have due work; job payloads remain behind RLS.
create function orion_internal.integration_job_tenants_due(p_limit integer default 100)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select job.user_id
  from public.integration_jobs as job
  where job.attempts < job.max_attempts
    and job.available_at <= now()
    and (
      job.status in ('pending', 'failed')
      or (job.status = 'running' and job.lease_expires_at < now())
    )
  group by job.user_id
  order by min(job.available_at), job.user_id
  limit greatest(1, least(coalesce(p_limit, 100), 1000))
$$;

-- Returns only the tenant/connection coordinates needed by the autonomous
-- scheduler. Event data, credentials, and job payloads remain tenant-isolated.
create function orion_internal.calendar_sync_connections_due(
  p_stale_after interval default interval '5 minutes',
  p_full_after interval default interval '7 days',
  p_limit integer default 100
)
returns table (user_id uuid, connection_id uuid, force_full boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select connection.user_id, connection.id,
    (sync_state.last_full_synced_at is null
      or sync_state.last_full_synced_at < now() - greatest(p_full_after, interval '1 day')
        - make_interval(secs => get_byte(uuid_send(connection.id), 1) % 60)) as force_full
  from public.integration_connections as connection
  join public.integration_capabilities as capability
    on capability.user_id = connection.user_id
   and capability.connection_id = connection.id
   and capability.capability_key = 'calendar.read'
   and capability.enabled
   and capability.status = 'active'
  left join public.calendar_sync_state as sync_state
    on sync_state.user_id = connection.user_id
   and sync_state.connection_id = connection.id
  where connection.status = 'active'
    and connection.provider in ('google', 'microsoft')
    and (
      sync_state.events_last_synced_at is null
      or sync_state.events_last_synced_at < now() - greatest(p_stale_after, interval '1 minute')
        - make_interval(secs => get_byte(uuid_send(connection.id), 0) % 60)
      or sync_state.last_full_synced_at is null
      or sync_state.last_full_synced_at < now() - greatest(p_full_after, interval '1 day')
        - make_interval(secs => get_byte(uuid_send(connection.id), 1) % 60)
    )
    and not exists (
      select 1
      from public.integration_jobs as job
      where job.user_id = connection.user_id
        and job.connection_id = connection.id
        and job.job_kind = 'calendar.sync'
        and job.status in ('pending', 'running', 'failed')
        and (job.status <> 'failed' or job.available_at <= now() + interval '1 minute')
    )
  order by force_full desc, sync_state.events_last_synced_at nulls first,
    connection.user_id, connection.id
  limit greatest(1, least(coalesce(p_limit, 100), 1000))
$$;

-- Public webhooks carry provider subscription identifiers rather than Orion
-- tenant identity. This backend-only resolver returns the minimum routing and
-- verification material required to re-enter a tenant-scoped transaction.
create function orion_internal.resolve_calendar_webhook_subscription(
  p_provider text,
  p_provider_subscription_id text
)
returns table (
  subscription_id uuid,
  user_id uuid,
  connection_id uuid,
  capability_key text,
  watched_resource_id text,
  provider_resource_id text,
  verification_secret_hash text,
  status text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select subscription.id, subscription.user_id, subscription.connection_id,
    subscription.capability_key, subscription.watched_resource_id, subscription.provider_resource_id,
    subscription.verification_secret_hash, subscription.status, subscription.expires_at
  from public.integration_webhook_subscriptions as subscription
  join public.integration_connections as connection
    on connection.user_id = subscription.user_id
   and connection.id = subscription.connection_id
   and connection.status = 'active'
  where subscription.provider = lower(btrim(p_provider))
    and subscription.provider_subscription_id = btrim(p_provider_subscription_id)
    and subscription.direction = 'inbound'
    and subscription.status in ('pending', 'active', 'renewing', 'retiring')
  order by subscription.generation desc
  limit 1
$$;

-- Purges bounded batches of terminal control-plane data after 30 days. Outbox
-- deletion cascades its immutable delivery attempts; pending/retryable work is
-- never selected.
create function orion_internal.purge_integration_control_plane(p_limit integer default 1000)
returns table (jobs_deleted bigint, webhook_receipts_deleted bigint, outbox_events_deleted bigint)
language sql
volatile
security definer
set search_path = ''
as $$
  with deleted_jobs as (
    delete from public.integration_jobs
    where id in (
      select id from public.integration_jobs
      where status in ('succeeded', 'dead')
        and updated_at < now() - interval '30 days'
      order by updated_at, id
      limit greatest(1, least(coalesce(p_limit, 1000), 10000))
    )
    returning 1
  ), deleted_receipts as (
    delete from public.integration_webhook_receipts
    where id in (
      select id from public.integration_webhook_receipts
      where status in ('processed', 'rejected')
        and coalesce(processed_at, received_at) < now() - interval '30 days'
      order by coalesce(processed_at, received_at), id
      limit greatest(1, least(coalesce(p_limit, 1000), 10000))
    )
    returning 1
  ), deleted_outbox as (
    delete from public.integration_outbox_events
    where id in (
      select id from public.integration_outbox_events
      where status in ('delivered', 'dead')
        and updated_at < now() - interval '30 days'
      order by updated_at, id
      limit greatest(1, least(coalesce(p_limit, 1000), 10000))
    )
    returning 1
  )
  select
    (select count(*) from deleted_jobs),
    (select count(*) from deleted_receipts),
    (select count(*) from deleted_outbox)
$$;

-- Atomically creates/locks a usage period, applies only the unconsumed part of
-- a cumulative operation total, enforces the trusted backend-supplied limit,
-- and returns a stable result for exact retries. Static limits deliberately
-- remain in backend code rather than being copied into usage rows.
create function orion_internal.consume_account_usage(
  p_account_id uuid,
  p_meter_key text,
  p_period_started_at timestamptz,
  p_period_ends_at timestamptz,
  p_operation_key text,
  p_operation_total_quantity bigint,
  p_effective_limit bigint
)
returns table (
  allowed boolean,
  period_consumed_quantity bigint,
  limit_quantity bigint,
  operation_consumed_quantity bigint,
  replayed boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_existing_period_end timestamptz;
  v_previous_operation_quantity bigint;
  v_previous_period_result bigint;
  v_delta bigint;
  v_period_consumed bigint;
begin
  if p_account_id is null then
    raise exception using errcode = '22023', message = 'account_id is required';
  end if;
  if p_meter_key is null
    or p_meter_key <> btrim(p_meter_key)
    or p_meter_key = ''
    or length(p_meter_key) > 64 then
    raise exception using errcode = '22023', message = 'meter_key is invalid';
  end if;
  if p_operation_key is null
    or p_operation_key <> btrim(p_operation_key)
    or p_operation_key = ''
    or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'operation_key is invalid';
  end if;
  if p_period_started_at is null
    or p_period_ends_at is null
    or p_period_ends_at <= p_period_started_at then
    raise exception using errcode = '22023', message = 'usage period is invalid';
  end if;
  if p_operation_total_quantity is null or p_operation_total_quantity <= 0 then
    raise exception using errcode = '22023', message = 'operation total must be positive';
  end if;
  if p_effective_limit is null or p_effective_limit < 0 then
    raise exception using errcode = '22023', message = 'effective limit must be nonnegative';
  end if;
  if not exists (
    select 1
    from public.accounts as account
    join public.users as app_user on app_user.id = account.id
    where account.id = p_account_id
      and app_user.status = 'active'
      and app_user.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'active account does not exist';
  end if;

  insert into public.account_usage_periods (
    account_id,
    meter_key,
    period_started_at,
    period_ends_at
  ) values (
    p_account_id,
    p_meter_key,
    p_period_started_at,
    p_period_ends_at
  )
  on conflict (account_id, meter_key, period_started_at) do nothing;

  select usage_period.period_ends_at
  into strict v_existing_period_end
  from public.account_usage_periods as usage_period
  where usage_period.account_id = p_account_id
    and usage_period.meter_key = p_meter_key
    and usage_period.period_started_at = p_period_started_at
  for update;

  if v_existing_period_end is distinct from p_period_ends_at then
    raise exception using errcode = '22023', message = 'usage period end does not match';
  end if;

  insert into public.account_usage_operations (
    account_id,
    meter_key,
    period_started_at,
    operation_key
  ) values (
    p_account_id,
    p_meter_key,
    p_period_started_at,
    p_operation_key
  )
  on conflict (account_id, meter_key, period_started_at, operation_key) do nothing;

  select
    usage_operation.consumed_quantity,
    usage_operation.period_consumed_after
  into strict
    v_previous_operation_quantity,
    v_previous_period_result
  from public.account_usage_operations as usage_operation
  where usage_operation.account_id = p_account_id
    and usage_operation.meter_key = p_meter_key
    and usage_operation.period_started_at = p_period_started_at
    and usage_operation.operation_key = p_operation_key
  for update;

  if p_operation_total_quantity < v_previous_operation_quantity then
    raise exception using errcode = '22023', message = 'operation total cannot decrease';
  end if;

  v_delta := p_operation_total_quantity - v_previous_operation_quantity;
  if v_delta = 0 then
    return query select
      true,
      v_previous_period_result,
      p_effective_limit,
      v_previous_operation_quantity,
      true;
    return;
  end if;

  update public.account_usage_periods as usage_period
  set
    consumed_quantity = usage_period.consumed_quantity + v_delta,
    updated_at = v_now
  where usage_period.account_id = p_account_id
    and usage_period.meter_key = p_meter_key
    and usage_period.period_started_at = p_period_started_at
    and usage_period.consumed_quantity <= p_effective_limit - v_delta
  returning usage_period.consumed_quantity into v_period_consumed;

  if not found then
    select usage_period.consumed_quantity
    into strict v_period_consumed
    from public.account_usage_periods as usage_period
    where usage_period.account_id = p_account_id
      and usage_period.meter_key = p_meter_key
      and usage_period.period_started_at = p_period_started_at;

    return query select
      false,
      v_period_consumed,
      p_effective_limit,
      v_previous_operation_quantity,
      false;
    return;
  end if;

  update public.account_usage_operations as usage_operation
  set
    consumed_quantity = p_operation_total_quantity,
    period_consumed_after = v_period_consumed,
    updated_at = v_now
  where usage_operation.account_id = p_account_id
    and usage_operation.meter_key = p_meter_key
    and usage_operation.period_started_at = p_period_started_at
    and usage_operation.operation_key = p_operation_key;

  return query select
    true,
    v_period_consumed,
    p_effective_limit,
    p_operation_total_quantity,
    false;
end
$$;

-- Expired temporary overrides fail closed unless a verified, mode-matched
-- current subscription projection still grants access. Reconciliation later
-- materializes the same subscription state back into public.accounts.
create function orion_internal.resolve_account_plan(
  p_account_id uuid,
  p_billing_enabled boolean,
  p_livemode boolean
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when account.plan_valid_until is null or account.plan_valid_until > now()
      then account.effective_plan_key
    when account.plan_source not in ('promotion', 'admin') or not p_billing_enabled
      then 'free'
    else coalesce((
      select subscription.plan_key
      from public.billing_customers as customer
      join public.subscriptions as subscription
        on subscription.billing_customer_id = customer.id
       and subscription.is_current
      where customer.account_id = account.id
        and customer.provider = 'stripe'
        and customer.livemode = p_livemode
        and customer.deleted_at is null
        and (
          (subscription.status = 'trialing' and
            least(subscription.trial_ends_at, subscription.cancel_at) > now())
          or
          (subscription.status = 'active' and
            least(subscription.current_period_ends_at, subscription.cancel_at) > now())
          or
          (subscription.status = 'past_due' and
            subscription.current_period_started_at + interval '72 hours' > now())
        )
      order by subscription.provider_created_at desc
      limit 1
    ), 'free')
  end
  from public.accounts as account
  where account.id = p_account_id
$$;

revoke all on function orion_internal.is_auth_session_active(uuid, uuid)
  from public, anon, authenticated;
grant usage on schema orion_internal to orion_backend;
revoke all on function orion_internal.vocabulary_terms_valid(text[])
  from public, anon, authenticated;
grant execute on function orion_internal.vocabulary_terms_valid(text[])
  to orion_backend;
grant execute on function orion_internal.is_auth_session_active(uuid, uuid)
  to orion_backend;
revoke all on function orion_internal.integration_job_tenants_due(integer)
  from public, anon, authenticated;
grant execute on function orion_internal.integration_job_tenants_due(integer)
  to orion_backend;
revoke all on function orion_internal.calendar_sync_connections_due(interval, interval, integer)
  from public, anon, authenticated;
grant execute on function orion_internal.calendar_sync_connections_due(interval, interval, integer)
  to orion_backend;
revoke all on function orion_internal.resolve_calendar_webhook_subscription(text, text)
  from public, anon, authenticated;
grant execute on function orion_internal.resolve_calendar_webhook_subscription(text, text)
  to orion_backend;
revoke all on function orion_internal.purge_integration_control_plane(integer)
  from public, anon, authenticated;
grant execute on function orion_internal.purge_integration_control_plane(integer)
  to orion_backend;
revoke all on function orion_internal.consume_account_usage(
  uuid, text, timestamptz, timestamptz, text, bigint, bigint
) from public, anon, authenticated;
grant execute on function orion_internal.consume_account_usage(
  uuid, text, timestamptz, timestamptz, text, bigint, bigint
) to orion_backend;
revoke all on function orion_internal.resolve_account_plan(uuid, boolean, boolean)
  from public, anon, authenticated;
grant execute on function orion_internal.resolve_account_plan(uuid, boolean, boolean)
  to orion_backend;

revoke all on schema public from public, anon, authenticated;
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
grant usage on schema public to orion_backend;
grant select, insert, update, delete on all tables in schema public to orion_backend;
grant usage on all sequences in schema public to orion_backend;
revoke all on table public.accounts from orion_backend;
grant select, insert, update on table public.accounts to orion_backend;
revoke all on table public.account_vocabulary from orion_backend;
grant select, insert, update on table public.account_vocabulary to orion_backend;
revoke all on table public.account_email_draft_settings from orion_backend;
grant select, insert, update on table public.account_email_draft_settings to orion_backend;
revoke all on table public.account_extract_fields from orion_backend;
grant select, insert, update, delete on table public.account_extract_fields to orion_backend;
revoke all on table public.account_extract_field_folders from orion_backend;
grant select, insert, delete on table public.account_extract_field_folders to orion_backend;
revoke all on table public.account_summary_templates from orion_backend;
grant select, insert, update, delete on table public.account_summary_templates to orion_backend;
revoke all on table public.account_summary_template_folders from orion_backend;
grant select, insert, delete on table public.account_summary_template_folders to orion_backend;
revoke all on table public.account_plan_changes from orion_backend;
grant insert on table public.account_plan_changes to orion_backend;
revoke all on table public.account_usage_periods from orion_backend;
revoke all on table public.account_usage_operations from orion_backend;
revoke all on table public.billing_customers from orion_backend;
grant select, insert on table public.billing_customers to orion_backend;
revoke all on sequence public.billing_customers_id_seq from orion_backend;
grant usage on sequence public.billing_customers_id_seq to orion_backend;
revoke all on table public.subscriptions from orion_backend;
grant select, insert, update on table public.subscriptions to orion_backend;
revoke all on sequence public.subscriptions_id_seq from orion_backend;
grant usage on sequence public.subscriptions_id_seq to orion_backend;
revoke all on table public.billing_webhook_events from orion_backend;
grant select, insert, update on table public.billing_webhook_events to orion_backend;
revoke all on sequence public.billing_webhook_events_id_seq from orion_backend;
grant usage on sequence public.billing_webhook_events_id_seq to orion_backend;
-- Set or rotate this LOGIN role's strong password outside tracked SQL, then
-- configure DATABASE_URL to authenticate directly as it. The backend rejects
-- owner/admin sessions and does not use SET ROLE.
revoke orion_backend from postgres;

-- Keep tenant resolution in one stable, narrowly granted function. Referencing
-- it through a scalar subquery lets Postgres initialize the value once per
-- statement instead of evaluating current_setting for every candidate row.
create function orion_internal.current_tenant_user_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;
revoke all on function orion_internal.current_tenant_user_id()
  from public, anon, authenticated;
grant execute on function orion_internal.current_tenant_user_id()
  to orion_backend;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'users','folders','account_extract_fields','account_extract_field_folders',
    'account_summary_templates','account_summary_template_folders',
    'notes','transcript_segments','note_recording_sessions',
    'note_attachments','conversations','messages'
  ] loop
    execute format(
      'create policy backend_only on public.%I for all to orion_backend using (true) with check (true)',
      table_name
    );
  end loop;
end $$;

-- Calendar and connector data is additionally restricted to the tenant bound
-- by the backend at transaction start. An unset setting matches no rows, so
-- an accidentally unscoped query fails closed; application input is UUID-validated.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'integration_connections','integration_capabilities','integration_webhook_subscriptions',
    'integration_jobs','integration_webhook_receipts','integration_outbox_events',
    'integration_delivery_attempts','calendar_preferences','calendar_sources',
    'calendar_events','calendar_event_attendees','calendar_sync_state',
    'note_calendar_links'
  ] loop
    execute format('drop policy if exists backend_only on public.%I', table_name);
    execute format(
      'create policy backend_tenant_only on public.%I for all to orion_backend using (user_id = (select orion_internal.current_tenant_user_id())) with check (user_id = (select orion_internal.current_tenant_user_id()))',
      table_name
    );
  end loop;
end $$;

create policy backend_tenant_only on public.note_attendees
  for all to orion_backend
  using (exists (
    select 1 from public.notes as note
    where note.id = note_attendees.note_id
      and note.user_id = (select orion_internal.current_tenant_user_id())
  ))
  with check (exists (
    select 1 from public.notes as note
    where note.id = note_attendees.note_id
      and note.user_id = (select orion_internal.current_tenant_user_id())
  ));

create policy backend_tenant_only on public.note_attendee_suppressions
  for all to orion_backend
  using (exists (
    select 1 from public.notes as note
    where note.id = note_attendee_suppressions.note_id
      and note.user_id = (select orion_internal.current_tenant_user_id())
  ))
  with check (exists (
    select 1 from public.notes as note
    where note.id = note_attendee_suppressions.note_id
      and note.user_id = (select orion_internal.current_tenant_user_id())
  ));

create policy backend_select on public.accounts
  for select to orion_backend using (true);
create policy backend_insert on public.accounts
  for insert to orion_backend with check (true);
create policy backend_update on public.accounts
  for update to orion_backend using (true) with check (true);

create policy backend_select on public.account_vocabulary
  for select to orion_backend using (true);
create policy backend_insert on public.account_vocabulary
  for insert to orion_backend with check (true);
create policy backend_update on public.account_vocabulary
  for update to orion_backend using (true) with check (true);

create policy backend_select on public.account_email_draft_settings
  for select to orion_backend using (true);
create policy backend_insert on public.account_email_draft_settings
  for insert to orion_backend with check (true);
create policy backend_update on public.account_email_draft_settings
  for update to orion_backend using (true) with check (true);

create policy backend_insert on public.account_plan_changes
  for insert to orion_backend with check (true);

create policy backend_select on public.billing_customers
  for select to orion_backend using (true);
create policy backend_insert on public.billing_customers
  for insert to orion_backend with check (true);

create policy backend_select on public.subscriptions
  for select to orion_backend using (true);
create policy backend_insert on public.subscriptions
  for insert to orion_backend with check (true);
create policy backend_update on public.subscriptions
  for update to orion_backend using (true) with check (true);

create policy backend_insert on public.billing_webhook_events
  for insert to orion_backend with check (true);
create policy backend_select on public.billing_webhook_events
  for select to orion_backend using (true);
create policy backend_update on public.billing_webhook_events
  for update to orion_backend using (true) with check (true);

-- service_role stays available for Supabase administration but is not used by
-- the desktop application. The Go backend authenticates directly as
-- orion_backend and verifies both session_user and current_user at startup.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to orion_backend;
alter default privileges in schema public grant usage on sequences to orion_backend;
alter default privileges in schema orion_internal revoke execute on functions from public;

commit;
