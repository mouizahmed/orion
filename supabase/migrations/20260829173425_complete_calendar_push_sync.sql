alter table public.integration_webhook_subscriptions
  add column provider_resource_id text,
  add column supersedes_subscription_id uuid,
  add column generation integer not null default 1 check (generation > 0),
  add column next_attempt_at timestamptz,
  add column last_error_code text;

alter table public.integration_webhook_subscriptions
  drop constraint integration_webhook_subscriptions_status_check,
  add constraint integration_webhook_subscriptions_status_check
    check (status in ('pending', 'active', 'renewing', 'retiring', 'disabled', 'failed')),
  add constraint integration_webhook_subscriptions_supersedes_owner_fkey
    foreign key (supersedes_subscription_id, user_id)
    references public.integration_webhook_subscriptions(id, user_id)
    on delete set null (supersedes_subscription_id);

create index integration_webhook_subscriptions_resource_idx
  on public.integration_webhook_subscriptions (user_id, connection_id, watched_resource_id, generation desc)
  where direction = 'inbound';
create index integration_webhook_subscriptions_supersedes_owner_idx
  on public.integration_webhook_subscriptions (supersedes_subscription_id, user_id)
  where supersedes_subscription_id is not null;
create index integration_webhook_subscriptions_retry_idx
  on public.integration_webhook_subscriptions (next_attempt_at)
  where status in ('pending', 'renewing', 'failed') and next_attempt_at is not null;

create function orion_internal.calendar_sync_connections_due(
  p_stale_after interval default interval '5 minutes',
  p_limit integer default 100
)
returns table (user_id uuid, connection_id uuid)
language sql stable security definer set search_path = ''
as $$
  select connection.user_id, connection.id
  from public.integration_connections as connection
  join public.integration_capabilities as capability
    on capability.user_id = connection.user_id
   and capability.connection_id = connection.id
   and capability.capability_key = 'calendar.read'
   and capability.enabled and capability.status = 'active'
  left join public.calendar_sync_state as sync_state
    on sync_state.user_id = connection.user_id and sync_state.connection_id = connection.id
  where connection.status = 'active'
    and connection.provider in ('google', 'microsoft')
    and (sync_state.events_last_synced_at is null
      or sync_state.events_last_synced_at < now() - greatest(p_stale_after, interval '1 minute')
        - make_interval(secs => get_byte(uuid_send(connection.id), 0) % 60))
    and not exists (
      select 1 from public.integration_jobs as job
      where job.user_id = connection.user_id and job.connection_id = connection.id
        and job.job_kind = 'calendar.sync' and job.status in ('pending', 'running', 'failed')
        and (job.status <> 'failed' or job.available_at <= now() + interval '1 minute')
    )
  order by sync_state.events_last_synced_at nulls first, connection.user_id, connection.id
  limit greatest(1, least(coalesce(p_limit, 100), 1000))
$$;

create function orion_internal.resolve_calendar_webhook_subscription(
  p_provider text,
  p_provider_subscription_id text
)
returns table (
  subscription_id uuid, user_id uuid, connection_id uuid, capability_key text,
  watched_resource_id text, provider_resource_id text, verification_secret_hash text, status text, expires_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select subscription.id, subscription.user_id, subscription.connection_id,
    subscription.capability_key, subscription.watched_resource_id, subscription.provider_resource_id,
    subscription.verification_secret_hash, subscription.status, subscription.expires_at
  from public.integration_webhook_subscriptions as subscription
  join public.integration_connections as connection
    on connection.user_id = subscription.user_id and connection.id = subscription.connection_id
   and connection.status = 'active'
  where subscription.provider = lower(btrim(p_provider))
    and subscription.provider_subscription_id = btrim(p_provider_subscription_id)
    and subscription.direction = 'inbound'
    and subscription.status in ('pending', 'active', 'renewing', 'retiring')
  order by subscription.generation desc
  limit 1
$$;

revoke all on function orion_internal.calendar_sync_connections_due(interval, integer)
  from public, anon, authenticated;
grant execute on function orion_internal.calendar_sync_connections_due(interval, integer)
  to orion_backend;
revoke all on function orion_internal.resolve_calendar_webhook_subscription(text, text)
  from public, anon, authenticated;
grant execute on function orion_internal.resolve_calendar_webhook_subscription(text, text)
  to orion_backend;
