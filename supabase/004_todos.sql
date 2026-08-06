-- Emortia Musix · migration 004 — What To Do
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.

create table if not exists todos (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  note       text,
  due        timestamptz,                 -- null means no deadline
  done       boolean not null default false,
  done_at    timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  updated_by uuid
);

-- The dashboard only ever asks for what is still pending, so index that.
create index if not exists todos_pending_idx on todos (done, due nulls last, created_at);

alter table todos enable row level security;

drop policy if exists "todos_read"  on todos;
drop policy if exists "todos_write" on todos;

create policy "todos_read" on todos
  for select using (true);

create policy "todos_write" on todos
  for all
  using      (auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid)
  with check (auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid);

-- so a task ticked off on the phone leaves the laptop's dashboard too
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'todos'
  ) then
    alter publication supabase_realtime add table todos;
  end if;
end $$;
