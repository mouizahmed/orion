create index integration_jobs_terminal_retention_idx
  on public.integration_jobs (updated_at, id)
  where status in ('succeeded', 'dead');
create index integration_webhook_receipts_terminal_retention_idx
  on public.integration_webhook_receipts ((coalesce(processed_at, received_at)), id)
  where status in ('processed', 'rejected');
create index integration_outbox_events_terminal_retention_idx
  on public.integration_outbox_events (updated_at, id)
  where status in ('delivered', 'dead');

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
revoke all on function orion_internal.purge_integration_control_plane(integer)
  from public, anon, authenticated;
grant execute on function orion_internal.purge_integration_control_plane(integer)
  to orion_backend;
