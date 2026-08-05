# Cross-device sync

Upload on one device, see it on every device. The tools used to save into the
browser they were used from, so a laptop and a phone running the same code held
two unrelated sets of data. Nothing was out of sync — nothing was ever shared.

The fix is not a sync feature. It is moving storage off the device.

## Where things stand

Done, in Supabase (project `yhneindurtquzjpmwsjh`, Tokyo):

- tables `sites`, `project_updates`, `imports`
- RLS on all three: anyone reads, only owner `250a6710-…` writes
- private `imports` storage bucket with an owner-only policy
- realtime on `sites` and `project_updates`

Done, in this repository:

- `supabase/002_site_access_schema.sql` — **still to be run**, see below
- `tools/_lib/supabase-config.js` — URL present, **anon key still blank**
- `tools/_lib/db.js` — the only file that touches storage
- `tools/_lib/authgate.js` — Supabase Auth sign-in dialog
- Site Access Lookup converted

Not done: Project Update and the rest still use their own storage.

## Two departures from the original plan

**The `sites` schema needed widening.** The plan gave it eight typed columns.
The real Site Access sheet has twenty, and the missing twelve are not spare:
`Access_Permission_providing_Party` and `Time_Restrictions_final` are what the
Project Update dashboard reads to flag MOD/SLA sites, and the depot officer and
contact are what "Copy details" prints. Loading the sheet into the eight-column
table would have dropped all of it on the first upload, quietly.

Several real headings are also not valid unquoted Postgres identifiers —
`Depot_officer(FME_ID)`, `Week_ends/Holydays_Access_Restricted_time`. Renaming
them would break the lookup config, which keys off the sheet's own headings. So
the row is stored as `jsonb` under its original headings, with `site_name`,
`district` and `permission_party` lifted out as generated columns for querying.
Column order lives in a small `datasets` table, because the tools work on
`{cols, rows}` where a row is a plain array.

**Conversion is opt-in per tool.** A tool joins the shared database by naming a
`syncKey` in its `LOOKUP_CONFIG`. Site Access has one; Site Data does not, so it
runs exactly as before. `lookup.js` is shared by both, and the brief said not to
touch the other tools yet.

## Order of truth

    server   what everyone sees
    cache    IndexedDB, so the page opens offline and paints before the network
    bundled  data.json in the repo — the floor, if there is no key and no cache

A page shows the cache immediately, then replaces it if the server is ahead. The
pill says which: `synced`, or `offline copy`.

## To finish it

1. Run `supabase/002_site_access_schema.sql` in SQL Editor → New query.
2. Project Settings → API, copy the anon key into `tools/_lib/supabase-config.js`.
   That key is public by design; RLS is what protects the data. Never the
   `service_role` key — it bypasses every policy.
3. Open Site Access, sign in from the footer, upload the sheet. It publishes.
4. Open it on the phone. The rows should be there, and the pill should say
   `synced`.

Then the same pattern for Project Update, and last of all delete the local write
paths so nothing can quietly save to one device again. Reads stay as cache.

## Note

Writes check `auth.uid()`, so an upload with no session is refused by Postgres
whatever the page thinks. If a publish fails with a policy error, the cause is
almost always a missing session rather than a broken policy — sign in and retry.

The old passphrase gate in `owner.js` stays, but it only decides whether the
edit controls are drawn. It is a client-side check. The server-side one is the
Supabase session.
