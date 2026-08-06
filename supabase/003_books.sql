-- Emortia Musix · migration 003 — Project Update workbooks
-- Idempotent: if you already created `books`, the table statement is a no-op
-- and this just makes sure the policies and realtime are in place.
--
-- One row per dataset. Unlike the lookup tables this is not a table of records:
-- a workbook is many sheets of different shapes, and the two datasets do not
-- even agree on which sheets exist — Ongoing has eleven, Master eight with
-- different names. So the parsed {sheets, order} goes in whole, and the sheet
-- list travels with it rather than being assumed anywhere.

create table if not exists books (
  key         text primary key,          -- 'book:ongoing' | 'book:master'
  sheets      jsonb not null,
  sheet_order jsonb not null default '[]'::jsonb,
  saved_at    date,
  bytes       int,
  updated_at  timestamptz default now(),
  updated_by  uuid
);

alter table books enable row level security;

drop policy if exists "books_read"  on books;
drop policy if exists "books_write" on books;

create policy "books_read" on books
  for select using (true);

create policy "books_write" on books
  for all
  using      (auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid)
  with check (auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'books'
  ) then
    alter publication supabase_realtime add table books;
  end if;
end $$;
