-- Emortia · migration 002
-- Run this in Supabase → SQL Editor → New query, then Run.
-- Safe to run more than once.
--
-- WHY THIS EXISTS
-- The original brief modelled `sites` with eight typed columns (site_name,
-- latitude, longitude, access_notes, landowner, contact_no, batch). The real
-- Site Access sheet has twenty, and the twelve it left out are not spare:
-- Access_Permission_providing_Party and Time_Restrictions_final are what the
-- Project Update dashboard reads to flag MOD/SLA permission sites, and the
-- depot officer and contact fields are what the "Copy details" button prints.
-- Loading the sheet into the eight-column table would have dropped all of that
-- silently on the first upload.
--
-- Several of the real column names are also not valid unquoted Postgres
-- identifiers — "Depot_officer(FME_ID)", "Week_ends/Holydays_Access_Restricted_time".
-- Rather than rename them (which would break the lookup tool's labels, groups
-- and search config, all of which key off the sheet's own headings), the whole
-- row is kept as jsonb under its original headings, with the few fields worth
-- querying lifted out as generated columns.

-- ---------------------------------------------------------------- sites
alter table sites add column if not exists data jsonb not null default '{}'::jsonb;

-- Lift the fields that are actually searched or joined on. Generated, so they
-- can never drift from the jsonb they came out of.
alter table sites drop column if exists site_name;
alter table sites add column site_name text
  generated always as (data->>'Site_Name') stored;

alter table sites add column if not exists district text
  generated always as (data->>'District') stored;

alter table sites add column if not exists permission_party text
  generated always as (data->>'Access_Permission_providing_Party') stored;

create index if not exists sites_site_id_idx   on sites (site_id);
create index if not exists sites_district_idx  on sites (district);
create index if not exists sites_data_gin_idx  on sites using gin (data);

-- ------------------------------------------------------------- datasets
-- Column order matters: the lookup tools work on {cols, rows} where a row is a
-- plain array. Keeping the heading list here means a re-upload can add or move
-- a column without the client having to guess the order.
create table if not exists datasets (
  key        text primary key,          -- 'site_access'
  cols       jsonb not null,
  row_count  int,
  updated_at timestamptz default now(),
  updated_by uuid
);

alter table datasets enable row level security;

drop policy if exists "datasets_read"  on datasets;
drop policy if exists "datasets_write" on datasets;

create policy "datasets_read" on datasets
  for select using (true);

create policy "datasets_write" on datasets
  for all
  using      (auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid)
  with check (auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid);

-- Realtime, so an open tab on another device refreshes itself.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'datasets'
  ) then
    alter publication supabase_realtime add table datasets;
  end if;
end $$;

-- ----------------------------------------------------------------- check
-- After running, this should list sites, project_updates, imports, datasets
-- with rowsecurity = true on every one.
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' order by tablename;
