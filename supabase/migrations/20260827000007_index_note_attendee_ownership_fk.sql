drop index public.note_attendees_owner_note_idx;
create index note_attendees_note_owner_idx
  on public.note_attendees (note_id, owner_user_id);
