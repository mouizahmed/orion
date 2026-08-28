create table public.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (name = btrim(name) and name <> '' and length(name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index people_user_name_idx
  on public.people (user_id, lower(name), id);

revoke all on table public.people from public, anon, authenticated;
grant select, insert, update, delete on table public.people to orion_backend;
grant all on table public.people to service_role;

alter table public.people enable row level security;
alter table public.people force row level security;

create policy backend_tenant_only on public.people
  for all to orion_backend
  using (user_id = (select orion_internal.current_tenant_user_id()))
  with check (user_id = (select orion_internal.current_tenant_user_id()));
