-- Emortia · migration 008 — lyric video projects
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- What this is for: timing a song word by word is an hour of work that lived
-- in one browser's localStorage. Clear the site data, open it on the laptop
-- instead of the desktop, and it was gone. This puts the project on the
-- server, and it saves itself as a draft while the work is still going — the
-- point is that nothing is ever lost because a song was not finished.
--
-- The tool is the owner's, so these are stricter than the ESN ones: you can
-- only see and touch your own projects, and nobody else's.

-- ────────────────────────────────────────────────────────────── the projects

create table if not exists lyric_projects (
  id            uuid primary key default gen_random_uuid(),
  name          text not null default 'Untitled',

  -- 'draft' while it is being worked on, 'done' when it has been recorded.
  -- Nothing is deleted on finishing: a done project reopens like any other.
  status        text not null default 'draft'
                check (status in ('draft', 'done')),

  -- The words, with their [m:ss.s] word tags in them. This is the part that
  -- cost the hour, and it is plain text on purpose — readable in the table,
  -- pasteable back into the box, and not dependent on the settings shape.
  lyrics        text not null default '',

  -- everything else the tool holds: frame, accent, fonts, effects, credits.
  -- One column rather than thirty, because the tool grows and a migration per
  -- new slider is not worth it.
  settings      jsonb not null default '{}'::jsonb,

  -- paths inside the `lyric` storage bucket, not the files themselves
  art_path      text,
  audio_path    text,
  -- when the song came from the site's own track list instead of a file
  track_pick    text,
  -- what the audio was called, so a file too big to upload can be asked for
  -- by name when the project is opened again
  audio_name    text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);

-- the list is "mine, most recently touched first"
create index if not exists lyric_projects_mine_idx
  on lyric_projects (created_by, updated_at desc);

alter table lyric_projects enable row level security;

drop policy if exists "lyric_read"   on lyric_projects;
drop policy if exists "lyric_insert" on lyric_projects;
drop policy if exists "lyric_update" on lyric_projects;
drop policy if exists "lyric_delete" on lyric_projects;

-- your own work, and only your own — all four ways
create policy "lyric_read" on lyric_projects
  for select using (auth.uid() = created_by);

create policy "lyric_insert" on lyric_projects
  for insert with check (auth.role() = 'authenticated' and created_by = auth.uid());

create policy "lyric_update" on lyric_projects
  for update using (auth.uid() = created_by) with check (auth.uid() = created_by);

create policy "lyric_delete" on lyric_projects
  for delete using (auth.uid() = created_by);

-- keep updated_at honest, since the list is ordered by it
create or replace function lyric_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists lyric_touch_trg on lyric_projects;
create trigger lyric_touch_trg before update on lyric_projects
  for each row execute function lyric_touch();

-- ───────────────────────────────────────────────────────────────── the files

-- Private, like the ESN bucket and for the same reason: unreleased artwork and
-- unreleased songs should not sit on a guessable URL. The tool asks for a
-- signed link when it opens a project, and those expire.
--
-- 60MB covers a cover at full size and an mp3 of a long song. A WAV will not
-- fit, and the tool says so and remembers the filename instead rather than
-- failing silently.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lyric', 'lyric', false, 62914560,
        array['image/png','image/jpeg','image/webp','image/gif','image/bmp',
              'audio/mpeg','audio/mp3','audio/mp4','audio/aac','audio/ogg',
              'audio/wav','audio/x-wav','audio/webm','audio/flac'])
on conflict (id) do update
  set public = false,
      file_size_limit = 62914560,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif','image/bmp',
              'audio/mpeg','audio/mp3','audio/mp4','audio/aac','audio/ogg',
              'audio/wav','audio/x-wav','audio/webm','audio/flac'];

drop policy if exists "lyric_obj_read"   on storage.objects;
drop policy if exists "lyric_obj_insert" on storage.objects;
drop policy if exists "lyric_obj_delete" on storage.objects;

-- Files are filed under the owner's uid, and the policies read that first
-- path segment — so one signed-in account cannot fetch another's artwork by
-- guessing a path, which a plain "authenticated" rule would allow.
create policy "lyric_obj_read" on storage.objects
  for select using (
    bucket_id = 'lyric' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "lyric_obj_insert" on storage.objects
  for insert with check (
    bucket_id = 'lyric' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "lyric_obj_delete" on storage.objects
  for delete using (
    bucket_id = 'lyric' and (storage.foldername(name))[1] = auth.uid()::text);
