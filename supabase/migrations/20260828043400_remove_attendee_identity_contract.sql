-- CONTRACT MIGRATION: NOT ROLLING-COMPATIBLE.
-- Deployment sequence: stop and drain every old API and worker process; apply
-- the preceding display-name expand/backfill migration and then this contract;
-- after both succeed, deploy and start only the new binary. Old binaries write
-- owner_user_id/matched_user_id; new binaries require display_name and omit
-- those writes, so mixed-version operation is intentionally unsupported.

set lock_timeout = '5s';

drop policy backend_tenant_only on public.note_attendees;
drop policy backend_tenant_only on public.note_attendee_suppressions;

drop index public.note_attendees_matched_user_idx;
drop index public.note_attendees_note_owner_idx;
alter table public.note_attendees
  drop constraint note_attendees_matched_user_id_fkey,
  drop constraint note_attendees_note_owner_fkey,
  drop column matched_user_id,
  drop column owner_user_id;
alter table public.note_attendees
  add constraint note_attendees_note_id_fkey
  foreign key (note_id) references public.notes(id) on delete cascade
  not valid;
alter table public.note_attendees
  validate constraint note_attendees_note_id_fkey;
create index if not exists note_attendees_note_idx
  on public.note_attendees (note_id);

drop index public.note_attendee_suppressions_owner_idx;
drop index public.note_attendee_suppressions_note_owner_idx;
alter table public.note_attendee_suppressions
  drop constraint note_attendee_suppressions_note_id_user_id_fkey,
  drop column user_id;
alter table public.note_attendee_suppressions
  add constraint note_attendee_suppressions_note_id_fkey
  foreign key (note_id) references public.notes(id) on delete cascade
  not valid;
alter table public.note_attendee_suppressions
  validate constraint note_attendee_suppressions_note_id_fkey;
-- The existing (note_id, email) primary key is the FK-leading index.

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

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'note_attendees'
      and column_name in ('matched_user_id', 'owner_user_id')
  ) or exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'note_attendee_suppressions'
      and column_name = 'user_id'
  ) then
    raise exception 'attendee identity columns remain after contract migration';
  end if;

  if (
    select count(*)
    from pg_constraint
    where conrelid in (
      'public.note_attendees'::regclass,
      'public.note_attendee_suppressions'::regclass
    )
      and conname in (
        'note_attendees_note_id_fkey',
        'note_attendee_suppressions_note_id_fkey'
      )
      and contype = 'f'
      and convalidated
  ) <> 2 then
    raise exception 'attendee parent-note foreign keys are missing or unvalidated';
  end if;
end $$;

reset lock_timeout;
