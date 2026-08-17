# ESN Sharing

Somebody on the team types a site ID, pastes the print screens, types the card
serials, and presses Save. The record and the pictures go to the database. They
never see the database, and never need an account on it beyond the one they
already made to sign in to the site.

## One thing to do before it can save

Run **`supabase/005_esn.sql`** once, in Supabase → SQL Editor → New query. It is
safe to run more than once. Until it has been run the tool loads and works, but
saving says *"This tool is not switched on yet"* rather than throwing an error
at whoever is using it.

That migration makes three things:

- `esn_records` - one row per site filed
- the `esn` storage bucket, **private**, 50MB a file
- the policies: signed in may read and may file, signed out may do neither,
  and only the owner may delete

## How it is used

**Site ID** → the name arrives on its own from the Site Access list. Lower case,
a trailing full stop, a space in the middle - all find the same site.

**The three pictures** - ESN only, the full screenshot, and the O&M IP. Click a
slot, drop onto it, or paste with **Ctrl+V**, which is how a print screen
actually travels. They go up at the size they arrived: nothing is resized or
re-encoded, because an ESN is a serial someone has to read back off the picture.

**Run O&M Script?** - ticking it opens the third slot and makes that screenshot
required. Left unticked, nothing asks for it.

**Cards** - type and serial, as many rows as the site needs. The type is a free
field with suggestions, never a fixed list, because every batch brings a card
nobody wrote down in advance.

**Add Site** starts another one. Half-finished records survive a closed tab; the
pictures do not, since they are megabytes and localStorage is not for that.

**Export** gives Excel or CSV, one row per card, with the site repeated down its
rows so the sheet sorts and filters without anything being looked up again. The
picture columns carry links that work for an hour.

## Where the parts are

| file | what it is |
|---|---|
| `esn.js` | the logic - the site index, what a record needs, the export shape. No DOM. |
| `esn.test.js` | 45 checks against the real 5,944-site list. `node tools/esn/esn.test.js` |
| `index.html` | the page |
| `../_lib/db.js` | the only file that talks to the database or the bucket |
| `../../supabase/005_esn.sql` | the migration above |

## What people are told when something breaks

Everyone gets a sentence about what to do next. The owner gets the real error
appended to it, because the owner is the one who fixes it. Nothing on a
teammate's screen names the database, the table, or the bucket.
