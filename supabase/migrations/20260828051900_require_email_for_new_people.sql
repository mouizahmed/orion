alter table public.people
  alter column name set default '';

alter table public.people
  drop constraint people_name_check,
  add constraint people_name_valid check (name = btrim(name) and length(name) <= 120);

alter table public.people
  alter column email drop default,
  alter column email drop not null;

update public.people
set email = null
where email = '';

alter table public.people
  drop constraint people_email_valid,
  add constraint people_email_valid check (
    email is null
    or (email = btrim(email) and email <> '' and length(email) <= 320)
  );

drop index public.people_user_email_key;
create unique index people_user_email_key
  on public.people (user_id, lower(btrim(email)))
  where email is not null;
