-- Emortia · migration 005 — BOM Builder
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.

-- One row per site's bill of materials. The lines themselves live in jsonb
-- rather than their own table: a BOM is always read and written whole, never
-- queried line by line, so a join would buy nothing and cost a round trip.
create table if not exists boms (
  id         uuid primary key default gen_random_uuid(),
  site_id    text not null,
  site_name  text,
  tx_plan    text,
  sectors    int,
  rrus       int,
  note       text,
  lines      jsonb not null default '[]'::jsonb,   -- [{name, cat, unit, qty}]
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  updated_by uuid
);

-- The list is shown newest first, and a site is looked up by its ID.
create index if not exists boms_updated_idx on boms (updated_at desc);
create index if not exists boms_site_idx    on boms (site_id);

-- The port type of each antenna and RRU, so the jumper suggestion knows what
-- it is joining. Editable from the tool rather than baked into the page.
create table if not exists bom_port_types (
  name       text primary key,            -- the antenna or RRU as it is written
  kind       text not null,               -- 'antenna' | 'rru'
  port       text not null,               -- '22', '32', or whatever comes next
  updated_at timestamptz default now(),
  updated_by uuid
);

alter table boms           enable row level security;
alter table bom_port_types enable row level security;

drop policy if exists "boms_read"  on boms;
drop policy if exists "boms_write" on boms;
drop policy if exists "ports_read"  on bom_port_types;
drop policy if exists "ports_write" on bom_port_types;

create policy "boms_read" on boms
  for select using (true);

create policy "boms_write" on boms
  for all
  using      (auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid)
  with check (auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid);

create policy "ports_read" on bom_port_types
  for select using (true);

create policy "ports_write" on bom_port_types
  for all
  using      (auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid)
  with check (auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid);
