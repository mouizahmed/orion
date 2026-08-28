alter table public.people
  add column email text not null default ''
  constraint people_email_valid check (email = btrim(email) and length(email) <= 320);

create unique index people_user_email_key
  on public.people (user_id, lower(btrim(email)))
  where btrim(email) <> '';
