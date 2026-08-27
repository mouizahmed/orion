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
revoke all on function orion_internal.integration_job_tenants_due(integer)
  from public, anon, authenticated;
grant execute on function orion_internal.integration_job_tenants_due(integer)
  to orion_backend;
