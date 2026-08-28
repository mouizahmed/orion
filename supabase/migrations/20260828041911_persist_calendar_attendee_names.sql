set lock_timeout = '5s';

alter table public.note_attendees
  add column display_name text not null default '';

-- Retain names supplied by eligible linked calendar attendees for every
-- matching row, including manual rows that steady-state reconciliation would
-- update on conflict. Profile-derived identity is intentionally not carried
-- forward.
with note_events as (
  select note.id as note_id, note.user_id, note.calendar_event_id
  from public.notes as note
  where note.calendar_event_id is not null
  union
  select link.note_id, link.user_id, link.calendar_event_id
  from public.note_calendar_links as link
  where link.calendar_event_id is not null
), provider_names as (
  select distinct on (attendee.id)
    attendee.id as attendee_id,
    event_attendee.display_name
  from public.note_attendees as attendee
  join note_events as event
    on event.note_id = attendee.note_id
  join public.calendar_event_attendees as event_attendee
    on event_attendee.calendar_event_id = event.calendar_event_id
   and event_attendee.user_id = event.user_id
   and lower(btrim(event_attendee.email)) = lower(btrim(attendee.email))
  where btrim(event_attendee.display_name) <> ''
    and event_attendee.resource = false
    and event_attendee.self_attendee = false
    and event_attendee.organizer = false
    and event_attendee.response_status <> 'declined'
    and not exists (
      select 1
      from public.note_attendee_suppressions as suppression
      where suppression.note_id = attendee.note_id
        and lower(btrim(suppression.email)) = lower(btrim(event_attendee.email))
    )
  order by attendee.id, event_attendee.updated_at desc, event_attendee.id
)
update public.note_attendees as attendee
set display_name = provider.display_name
from provider_names as provider
where provider.attendee_id = attendee.id;

-- The legacy automatic creator insert ran in the same transaction as note
-- creation, so the timestamps are equal. Requiring that timestamp equality in
-- addition to identity, email, and source preserves ambiguous manual self-adds.
delete from public.note_attendees as attendee
using public.notes as note, public.users as owner
where attendee.note_id = note.id
  and owner.id = note.user_id
  and attendee.source = 'manual'
  and attendee.owner_user_id = note.user_id
  and attendee.matched_user_id = note.user_id
  and attendee.created_at = note.created_at
  and lower(btrim(attendee.email)) = lower(btrim(owner.email));

reset lock_timeout;
