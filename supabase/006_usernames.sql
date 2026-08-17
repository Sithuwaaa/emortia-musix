-- Emortia · migration 006 — usernames
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- Signing up asks for a username, an email and a password. Signing in after
-- that is the username and the password — nobody should have to remember which
-- address they used months ago.
--
-- The account itself is still keyed by the email, because that is what a
-- confirmation link and a password reset need. So there has to be somewhere
-- that turns a username back into its address at sign-in, and that is what
-- this file makes.

-- ──────────────────────────────────────────────────────────────── the names

create table if not exists profiles (
  id       uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  email    text not null,
  made_at  timestamptz not null default now()
);

-- usernames are matched without regard to case: "Sithuwaaa" is "sithuwaaa"
create unique index if not exists profiles_username_lower_idx on profiles (lower(username));

alter table profiles enable row level security;

drop policy if exists "profiles_read" on profiles;
create policy "profiles_read" on profiles
  for select using (auth.role() = 'authenticated');

-- Nobody writes this table by hand. It is filled by the trigger below, from
-- what was typed on the sign-up form, so a username cannot be claimed by
-- anyone who has not actually made the account.
create or replace function on_auth_user_made() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uname text;
begin
  uname := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  if uname is null then uname := split_part(new.email, '@', 1); end if;

  -- if the name is taken, fall back to something that is not, rather than
  -- failing the sign-up and leaving somebody with no account at all
  if exists (select 1 from profiles where lower(username) = lower(uname)) then
    uname := uname || '-' || substr(new.id::text, 1, 4);
  end if;

  insert into profiles (id, username, email)
  values (new.id, uname, new.email)
  on conflict (id) do update set username = excluded.username, email = excluded.email;
  return new;
end $$;

drop trigger if exists on_auth_user_made_trg on auth.users;
create trigger on_auth_user_made_trg
  after insert on auth.users
  for each row execute function on_auth_user_made();

-- ─────────────────────────────────────────────── turning a name into an address

-- Called before anybody is signed in, so it has to be reachable by anon. It
-- takes one username and returns one address and nothing else: no listing, no
-- pattern matching, no way to walk the table. Knowing somebody's username is
-- the price of learning which address they signed up with, which is the same
-- thing "forgot your password" tells you anywhere else.
create or replace function email_for_username(uname text) returns text
language sql security definer stable set search_path = public as $$
  select email from profiles where lower(username) = lower(trim(uname)) limit 1;
$$;

revoke all on function email_for_username(text) from public;
grant execute on function email_for_username(text) to anon, authenticated;

-- ───────────────────────────────────────────── the name on a filed ESN record

-- The Filed list showed an email address. It should show the username.
alter table esn_records add column if not exists created_name text;

-- fill in the ones already filed, where the name can be worked out
update esn_records r
   set created_name = p.username
  from profiles p
 where r.created_by = p.id and r.created_name is null;

-- and for rows filed before profiles existed, fall back to the local part
update esn_records
   set created_name = split_part(created_email, '@', 1)
 where created_name is null and created_email is not null;

-- ───────────────────────────────────────────── names for accounts already made

-- Anyone who signed up before this file was run has no profile row. Give them
-- one, using the name they chose if it was recorded and the address otherwise.
insert into profiles (id, username, email)
select u.id,
       coalesce(nullif(trim(u.raw_user_meta_data ->> 'username'), ''), split_part(u.email, '@', 1)),
       u.email
  from auth.users u
 where not exists (select 1 from profiles p where p.id = u.id)
on conflict do nothing;
