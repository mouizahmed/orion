create index integration_capabilities_connection_owner_idx
  on public.integration_capabilities (connection_id, user_id);
create index integration_webhook_subscriptions_capability_owner_idx
  on public.integration_webhook_subscriptions (user_id, connection_id, capability_key);
create index integration_jobs_capability_owner_idx
  on public.integration_jobs (user_id, connection_id, capability_key);
create index integration_webhook_receipts_capability_owner_idx
  on public.integration_webhook_receipts (user_id, connection_id, capability_key);

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
    execute format('drop policy backend_tenant_only on public.%I', table_name);
    execute format(
      'create policy backend_tenant_only on public.%I for all to orion_backend using (user_id = (select nullif(current_setting(''app.current_user_id'', true), '''')::uuid)) with check (user_id = (select nullif(current_setting(''app.current_user_id'', true), '''')::uuid))',
      table_name
    );
  end loop;
end $$;
