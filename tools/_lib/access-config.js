/* Who may open the tools.

   A password is never written here. Each entry keeps a random salt and a
   PBKDF2-SHA256 hash of the password, which is what a password file is
   supposed to hold: enough to check a password, not enough to learn it.

   To add someone, open any tool with #adduser on the end of the URL:

       https://emortia.com/tools/site-access/#adduser

   It asks for a username and a password, does the work in the browser, and
   hands you one finished line to paste into the list below. The password
   itself never leaves the machine you typed it on and is never stored.

   To remove someone, delete their line and commit. They are locked out the
   next time their seven days run down — or straight away if you also change
   ACCESS_EPOCH below, which invalidates every session already handed out.

   Read the note at the bottom of this file before you rely on this. */

window.ACCESS_USERS = [
  // { user:'sithara', salt:'…', hash:'…', iter:210000 },
];

/* Bump this to sign everyone out at once — a signature that no longer matches
   is a session that is no longer valid, whatever its expiry says. */
window.ACCESS_EPOCH = 1;

/* How long a sign-in lasts before it has to be done again. */
window.ACCESS_DAYS = 7;

/* ── What this actually protects ──────────────────────────────────────────
   It keeps the tools out of the hands of someone browsing the site. It does
   not keep anything out of the hands of someone who knows a URL: every file
   in this repository is served publicly by GitHub Pages, so

       emortia.com/tools/site-access/data.json
       emortia.com/tools/site-data/data.json

   can be fetched by anyone, signed in or not, and no code running in a
   browser can change that. A lock drawn by the thing being locked is a
   curtain.

   To make it a real boundary the data has to stop being a file in the repo:
   move both into Supabase behind row level security, where the server checks
   who is asking. The tools already read Supabase for everything else, so this
   is a migration rather than a rewrite. Ask and I will do it.
   ───────────────────────────────────────────────────────────────────────── */
