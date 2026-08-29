alter table public.calendar_sync_state
  add column last_full_synced_at timestamptz;

drop function orion_internal.calendar_sync_connections_due(interval, integer);

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
  order by force_full desc,
    sync_state.events_last_synced_at nulls first,
    connection.user_id, connection.id
  limit greatest(1, least(coalesce(p_limit, 100), 1000))
$$;

revoke all on function orion_internal.calendar_sync_connections_due(interval, interval, integer)
  from public, anon, authenticated;
grant execute on function orion_internal.calendar_sync_connections_due(interval, interval, integer)
  to orion_backend;
