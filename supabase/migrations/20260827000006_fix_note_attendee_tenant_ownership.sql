alter table public.note_attendees
  rename column user_id to matched_user_id;
alter table public.note_attendees
  rename constraint note_attendees_user_id_fkey to note_attendees_matched_user_id_fkey;
alter index public.note_attendees_user_idx
  rename to note_attendees_matched_user_idx;

alter table public.note_attendees
  add column owner_user_id uuid;
update public.note_attendees as attendee
set owner_user_id = note.user_id
from public.notes as note
where note.id = attendee.note_id;
alter table public.note_attendees
  alter column owner_user_id set not null;

alter table public.note_attendees
  drop constraint note_attendees_note_id_fkey;
alter table public.note_attendees
  add constraint note_attendees_note_owner_fkey
  foreign key (note_id, owner_user_id)
  references public.notes(id, user_id) on delete cascade;
create index note_attendees_owner_note_idx
  on public.note_attendees (owner_user_id, note_id);

drop policy backend_tenant_only on public.note_attendees;
create policy backend_tenant_only on public.note_attendees
  for all to orion_backend
  using (owner_user_id = (select orion_internal.current_tenant_user_id()))
  with check (owner_user_id = (select orion_internal.current_tenant_user_id()));
