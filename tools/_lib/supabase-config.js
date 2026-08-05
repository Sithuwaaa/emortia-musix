/* Supabase connection details.

   Both values here are meant to be public. The anon key is a read-only
   identity: what it may actually do is decided by the row level security
   policies on the server, where nobody can reach them. Writes require a real
   signed-in session whose auth.uid() matches the owner.

   The service_role key is a different thing entirely — it bypasses every
   policy. It must never appear in this file, in this repository, or anywhere
   the browser can see. */
window.SUPABASE_CONFIG = {
  url: 'https://yhneindurtquzjpmwsjh.supabase.co',

  /* Project Settings → API → anon / public.
     Until this is filled in the tools fall back to the data.json committed in
     the repository, so the site keeps working — it just will not sync. */
  anonKey: 'sb_publishable_FOEi0FC-zv5IsRsBYaTPBA_8yrVkCrQ'
};
