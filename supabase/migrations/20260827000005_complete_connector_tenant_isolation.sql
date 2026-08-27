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
    'integration_connections','integration_capabilities','integration_webhook_subscriptions',
    'integration_jobs','integration_webhook_receipts','integration_outbox_events',
    'integration_delivery_attempts','calendar_preferences','calendar_sources',
    'calendar_events','calendar_event_attendees','calendar_sync_state',
    'note_calendar_links','note_attendee_suppressions','note_attendees'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('drop policy if exists backend_only on public.%I', table_name);
    execute format('drop policy if exists backend_tenant_only on public.%I', table_name);
    execute format(
      'create policy backend_tenant_only on public.%I for all to orion_backend using (user_id = (select orion_internal.current_tenant_user_id())) with check (user_id = (select orion_internal.current_tenant_user_id()))',
      table_name
    );
  end loop;
end $$;
