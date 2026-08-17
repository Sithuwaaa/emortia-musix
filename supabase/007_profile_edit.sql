-- Emortia · migration 007 - changing your own name
-- Run in Supabase → SQL Editor → New query. Safe to run more than once.
--
-- 006 gave everyone a username, but took it from the address they signed up
-- with, so somebody who signed up as sithuwaaathepage@gmail.com is called
-- "sithuwaaathepage" and there was no way to fix it. This adds the way.

-- ─────────────────────────────────────────────────────── changing your own

-- Only your own row, and only the name. The address stays what the account
-- was made with, because that is what a confirmation and a password reset
-- go to and changing it here would not change the account.
drop policy if exists "profiles_update" on profiles;
create policy "profiles_update" on profiles
  for update
  using      (auth.uid() = id)
  with check (auth.uid() = id);

-- A name has to look like a name, and has to be free. The unique index on
-- lower(username) already stops two people sharing one; this stops the
-- spaces and the empty strings that would get past it.
alter table profiles drop constraint if exists profiles_username_shape;
alter table profiles add constraint profiles_username_shape
  check (username ~ '^[A-Za-z0-9._-]{3,32}$');

-- ─────────────────────────────────────────────────────────── the rename asked for

-- Sithara signed up with the gmail address, so 006 called the account
-- "sithuwaaathepage". It should be Sithuwaaa - which is also what
-- ACCESS_OWNERS matches on, so owner mode keeps working either way.
update profiles
   set username = 'Sithuwaaa'
 where lower(email) = 'sithuwaaathepage@gmail.com'
   and not exists (
     select 1 from profiles p2
      where lower(p2.username) = 'sithuwaaa'
        and lower(p2.email) <> 'sithuwaaathepage@gmail.com');

-- and on anything already filed under the old name
update esn_records
   set created_name = 'Sithuwaaa'
 where lower(created_email) = 'sithuwaaathepage@gmail.com';

-- ───────────────────────────────────────────── what a name is, for the tool

-- The tool asks "who am I" on the way in, so it can show the name rather than
-- work one out from the address. One row, your own.
create or replace function my_profile() returns table (username text, email text)
language sql security definer stable set search_path = public as $$
  select username, email from profiles where id = auth.uid();
$$;

revoke all on function my_profile() from public;
grant execute on function my_profile() to authenticated;
