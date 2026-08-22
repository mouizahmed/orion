alter table public.notes
  add column revision bigint not null default 1,
  add constraint notes_revision_positive check (revision > 0);
