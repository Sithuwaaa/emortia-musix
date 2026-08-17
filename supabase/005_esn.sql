-- Emortia · migration 005 — ESN sharing
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- What this is for: someone on the team opens the ESN tool, types a site ID,
-- pastes the screenshots, types the card serials and saves. The record and the
-- images land here. They never see Supabase and never need an invitation to
-- it — signing up on the site is a Supabase account, and that is what these
-- policies check.
--
-- The rule below is "anyone signed in may add and may read". That is what
-- makes the tool usable by a team. Nobody signed out can read a thing, and
-- only the owner can delete or change what has been filed.

-- ─────────────────────────────────────────────────────────────── the records

create table if not exists esn_records (
  id            uuid primary key default gen_random_uuid(),
  site_id       text not null,
  site_name     text,
  run_om        boolean not null default false,

  -- paths inside the `esn` storage bucket, not the images themselves
  esn_photo     text,
  esn_full      text,
  om_ip_photo   text,

  -- [{ "type": "…", "serial": "…" }, …] — the card type is free text on
  -- purpose: every batch brings a card nobody listed in advance
  cards         jsonb not null default '[]'::jsonb,

  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  created_email text
);

-- The tool lists newest first and searches by site, so index both.
create index if not exists esn_records_created_idx on esn_records (created_at desc);
create index if not exists esn_records_site_idx    on esn_records (upper(site_id));

alter table esn_records enable row level security;

drop policy if exists "esn_read"   on esn_records;
drop policy if exists "esn_insert" on esn_records;
drop policy if exists "esn_update" on esn_records;
drop policy if exists "esn_delete" on esn_records;

-- signed in: may read everything the team has filed
create policy "esn_read" on esn_records
  for select using (auth.role() = 'authenticated');

-- signed in: may file new ones, stamped with who did it
create policy "esn_insert" on esn_records
  for insert with check (auth.role() = 'authenticated' and created_by = auth.uid());

-- your own until someone else needs to fix it: the filer or the owner
create policy "esn_update" on esn_records
  for update
  using      (auth.uid() = created_by or auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid)
  with check (auth.uid() = created_by or auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid);

-- deleting is the owner's alone
create policy "esn_delete" on esn_records
  for delete using (auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid);

-- keep updated_at honest
create or replace function esn_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists esn_touch_trg on esn_records;
create trigger esn_touch_trg before update on esn_records
  for each row execute function esn_touch();

-- so a record filed on a phone appears on the laptop without a refresh
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'esn_records'
  ) then
    alter publication supabase_realtime add table esn_records;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────── the images

-- A private bucket. Private matters: a public one would put every ESN
-- screenshot on a guessable URL, which is the thing this whole gate exists to
-- avoid. The tool asks for a signed link when it needs to show one, and those
-- expire.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('esn', 'esn', false, 15728640,
        array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 15728640,
      allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists "esn_obj_read"   on storage.objects;
drop policy if exists "esn_obj_insert" on storage.objects;
drop policy if exists "esn_obj_delete" on storage.objects;

create policy "esn_obj_read" on storage.objects
  for select using (bucket_id = 'esn' and auth.role() = 'authenticated');

create policy "esn_obj_insert" on storage.objects
  for insert with check (bucket_id = 'esn' and auth.role() = 'authenticated');

create policy "esn_obj_delete" on storage.objects
  for delete using (
    bucket_id = 'esn'
    and (owner = auth.uid() or auth.uid() = '250a6710-43f8-41ba-a8b5-6c502260acc8'::uuid));
