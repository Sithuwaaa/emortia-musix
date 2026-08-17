/* db.js - the only file that talks to storage.

   Every tool goes through this. Nothing else should call supabase, fetch a
   data.json, or write to IndexedDB, so there is exactly one place to look when
   data goes somewhere unexpected.

   The shape all the lookup tools work in is {cols, rows}: cols is an array of
   the sheet's own headings, rows is an array of arrays in that order. Postgres
   holds each row as jsonb keyed by heading, so the order lives in `datasets`
   and the translation happens here.

   Order of truth:
     server  - what everyone sees
     cache   - IndexedDB, so the page opens offline and paints before the
               network answers
     bundled - data.json in the repository, the floor if there is no session,
               no key, and no cache

   Load returns the cached copy first if there is one, then quietly replaces it
   when the server answers. */
(function(){
  const CFG = window.SUPABASE_CONFIG || {};
  const CACHE_DB = 'emortia_cache', CACHE_STORE = 'ds';
  const CDN = 'https://esm.sh/@supabase/supabase-js@2';

  let clientPromise = null;
  function client(){
    if (!CFG.url || !CFG.anonKey) return Promise.resolve(null);
    if (!clientPromise){
      clientPromise = import(CDN)
        .then(m => m.createClient(CFG.url, CFG.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true }
        }))
        .catch(e => { console.warn('Supabase client unavailable:', e.message); return null; });
    }
    return clientPromise;
  }
  const configured = () => !!(CFG.url && CFG.anonKey);

  /* ---------------------------------------------------------- local cache */
  function idb(){
    return new Promise((res, rej) => {
      const r = indexedDB.open(CACHE_DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(CACHE_STORE)) r.result.createObjectStore(CACHE_STORE); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function cacheGet(k){
    try { const db = await idb();
      return await new Promise(res => { const t = db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(k);
        t.onsuccess = () => res(t.result); t.onerror = () => res(null); });
    } catch(e){ return null; }
  }
  async function cacheSet(k, v){
    try { const db = await idb();
      return await new Promise(res => { const t = db.transaction(CACHE_STORE, 'readwrite').objectStore(CACHE_STORE).put(v, k);
        t.onsuccess = () => res(1); t.onerror = () => res(0); });
    } catch(e){ return 0; }
  }

  /* ---------------------------------------------------------------- auth */
  async function session(){
    const c = await client(); if (!c) return null;
    const { data } = await c.auth.getSession();
    return data ? data.session : null;
  }
  async function signIn(email, password){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured - the anon key is missing from tools/_lib/supabase-config.js.');
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data.session;
  }
  /* Returns {user, session}. Whether a session comes back depends on the
     project: with email confirmation switched on Supabase hands back a user
     and no session until the link in the email is clicked. The caller has to
     handle both, because only the project owner knows which it is. */
  async function signUp(email, password, meta){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured - the anon key is missing from tools/_lib/supabase-config.js.');
    const { data, error } = await c.auth.signUp({ email, password, options: { data: meta || {} } });
    if (error) throw new Error(error.message);
    return data;
  }

  /* Signing in by username: the account is keyed by the address, so the name
     has to be turned back into one first. The function on the server returns
     one address for one exact name and nothing else. */
  async function emailForUsername(username){
    const c = await client(); if (!c) return null;
    const { data, error } = await c.rpc('email_for_username', { uname: username });
    if (error) return null;
    return data || null;
  }

  /* Who am I, by name. Asked on the way in so the site can show the name
     somebody chose rather than working one out from their address. */
  async function myProfile(){
    const c = await client(); if (!c) return null;
    const { data, error } = await c.rpc('my_profile');
    if (error || !data || !data.length) return null;
    return data[0];
  }

  async function setUsername(name){
    const c = await client(); if (!c) throw new Error('Not connected.');
    const s = await session(); if (!s) throw new Error('Sign in first.');
    const { data, error } = await c.from('profiles')
      .update({ username: name }).eq('id', s.user.id).select().single();
    if (error){
      /* the unique index is what actually decides it, so say what it means */
      if (/duplicate|unique/i.test(error.message)) throw new Error('That name is taken.');
      if (/violates check|profiles_username_shape/i.test(error.message))
        throw new Error('A name is 3 to 32 letters, numbers, dots, dashes or underscores.');
      throw new Error(error.message);
    }
    return data;
  }
  async function signOut(){ const c = await client(); if (c) await c.auth.signOut(); }
  async function onAuth(fn){
    const c = await client(); if (!c) return;
    c.auth.onAuthStateChange((_e, s) => fn(s));
  }

  /* ------------------------------------------------------------- reading */
  const TABLE = { site_access: 'sites' };
  const KEYCOL = { site_access: 'site_id' };

  async function fetchRemote(key){
    const c = await client(); if (!c) return null;
    const table = TABLE[key]; if (!table) throw new Error('No table mapped for "' + key + '"');

    const meta = await c.from('datasets').select('cols,row_count,updated_at').eq('key', key).maybeSingle();
    if (meta.error) throw new Error(meta.error.message);
    if (!meta.data) return null;                       // nothing published yet
    const cols = meta.data.cols || [];

    // PostgREST caps a response, so walk it in pages rather than trusting one call
    const PAGE = 1000; let from = 0, out = [];
    for(;;){
      const { data, error } = await c.from(table).select('data').range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      out = out.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
    const rows = out.map(o => cols.map(cn => { const v = o.data ? o.data[cn] : ''; return v == null ? '' : String(v); }));
    return { cols, rows, savedAt: (meta.data.updated_at || '').slice(0, 10), source: 'server' };
  }

  /* Hand back the fastest thing available, then upgrade in place.
     onUpdate is called again if the server turns out to have something newer. */
  async function load(key, bundledUrl, onUpdate){
    const cached = await cacheGet(key);
    const refresh = (async () => {
      if (!configured()) return null;
      try {
        const remote = await fetchRemote(key);
        if (remote){ await cacheSet(key, remote); return remote; }
      } catch(e){ console.warn('Supabase read failed, staying on the local copy:', e.message); }
      return null;
    })();

    if (cached){
      refresh.then(r => { if (r && onUpdate && r.savedAt !== cached.savedAt) onUpdate(r); });
      return cached;
    }
    const remote = await refresh;
    if (remote) return remote;

    const res = await fetch(bundledUrl);
    const ds = await res.json();
    return { cols: ds.cols, rows: ds.rows, savedAt: '', source: 'bundled' };
  }

  /* ------------------------------------------------------------- writing */
  /* Replace a dataset wholesale. Chunked, because a few thousand rows in one
     request is megabytes of JSON and PostgREST will refuse it. onConflict on
     the natural key is what makes re-uploading a corrected sheet update the
     rows instead of piling up duplicates. */
  async function publish(key, cols, rows, onProgress){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured - the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first - the write policies check auth.uid(), so uploads fail without a session.');

    const table = TABLE[key], keyCol = KEYCOL[key];
    const idx = cols.indexOf(cols.find(cn => cn.toLowerCase().replace(/[^a-z]/g,'') === 'siteid') || cols[0]);

    const recs = [...rows.map(r => {
      const o = {}; cols.forEach((cn, i) => { o[cn] = r[i] == null ? '' : String(r[i]); });
      const rec = {}; rec[keyCol] = String(r[idx] || '').trim(); rec.data = o; return rec;
    }).filter(r => r[keyCol])
  .reduce((m, r) => (m.set(r[keyCol], r), m), new Map()).values()];

    const CHUNK = 500;
    for (let i = 0; i < recs.length; i += CHUNK){
      const { error } = await c.from(table).upsert(recs.slice(i, i + CHUNK), { onConflict: keyCol });
      if (error) throw new Error(error.message);
      if (onProgress) onProgress(Math.min(i + CHUNK, recs.length), recs.length);
    }

    const { error: mErr } = await c.from('datasets').upsert(
      { key, cols, row_count: recs.length, updated_at: new Date().toISOString(), updated_by: s.user.id },
      { onConflict: 'key' });
    if (mErr) throw new Error(mErr.message);

    const saved = { cols, rows, savedAt: new Date().toISOString().slice(0, 10), source: 'server' };
    await cacheSet(key, saved);
    return recs.length;
  }

  /* Another device published; refresh without a reload. */
  async function subscribe(key, fn){
    const c = await client(); if (!c) return;
    c.channel('ds-' + key)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'datasets', filter: 'key=eq.' + key },
          () => fn())
      .subscribe();
  }

  /* ------------------------------------------------------------- workbooks
     A whole parsed workbook in one row of `books`. Unlike the lookup datasets
     this is not a table of records - it is many sheets of differing shapes, and
     each dataset carries its own sheet list. Ongoing has eleven sheets, Master
     eight with different names, so nothing here may assume a fixed set. */
  const BOOK_CACHE = k => 'book:' + k;

  async function publishBook(key, book){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured - the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first - the write policies check auth.uid(), so uploads fail without a session.');

    const savedAt = book.savedAt || new Date().toISOString().slice(0, 10);
    const row = {
      key: key,
      sheets: book.sheets,
      sheet_order: book.order,
      saved_at: savedAt,
      bytes: book.bytes || null,
      updated_at: new Date().toISOString(),
      updated_by: s.user.id
    };
    const { error } = await c.from('books').upsert(row, { onConflict: 'key' });
    if (error) throw new Error(error.message);

    const saved = { sheets: book.sheets, order: book.order, savedAt: savedAt,
                    bytes: book.bytes || null, source: 'server' };
    await cacheSet(BOOK_CACHE(key), saved);
    return saved;
  }

  async function fetchBook(key){
    const c = await client(); if (!c) return null;
    const { data, error } = await c.from('books')
      .select('sheets,sheet_order,saved_at,bytes,updated_at').eq('key', key).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return { sheets: data.sheets || {}, order: data.sheet_order || [],
             savedAt: (data.saved_at || data.updated_at || '').slice(0, 10),
             bytes: data.bytes || null, source: 'server' };
  }

  /* Server, then cache, then whatever the caller can bundle. onUpdate fires if
     the server turns out to be newer than the cache that was handed back. */
  async function loadBook(key, bundled, onUpdate){
    const cached = await cacheGet(BOOK_CACHE(key));
    const refresh = (async () => {
      if (!configured()) return null;
      try {
        const remote = await fetchBook(key);
        if (remote){ await cacheSet(BOOK_CACHE(key), remote); return remote; }
      } catch(e){ console.warn('Supabase read failed, staying on the local copy:', e.message); }
      return null;
    })();

    if (cached){
      refresh.then(r => { if (r && onUpdate && r.savedAt !== cached.savedAt) onUpdate(r); });
      return cached;
    }
    const remote = await refresh;
    if (remote) return remote;
    return bundled ? await bundled() : null;
  }

  async function subscribeBook(key, fn){
    const c = await client(); if (!c) return;
    c.channel('bk-' + key)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'books', filter: 'key=eq.' + key },
          () => fn())
      .subscribe();
  }

  /* ----------------------------------------------------------------- todos
     Rows rather than a blob, because two devices can be ticking things off at
     the same time and a whole-document write would have one clobber the other.
     Reads are cached so the list is there before the network answers. */
  const TODO_CACHE = 'todos';

  /* Returns {items, error}. A read that fails still hands back the cache so the
     page is usable, but the caller is told why - an empty list and a broken
     connection look identical on screen otherwise, and "nothing pending" is a
     bad way to find out the table was never created. */
  async function listTodos(){
    const cached = async () => (await cacheGet(TODO_CACHE)) || [];
    const c = await client();
    if (!c) return { items: await cached(),
      error: configured() ? 'Could not reach Supabase.'
                          : 'Not syncing - the anon key is missing from tools/_lib/supabase-config.js.' };
    const { data, error } = await c.from('todos')
      .select('id,title,note,due,done,done_at,created_at')
      .order('done', { ascending: true })
      .order('due', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (error){
      console.warn('Todo read failed, using the cached list:', error.message);
      const missing = /schema cache|does not exist/i.test(error.message);
      return { items: await cached(),
        error: missing ? 'The todos table does not exist yet - run supabase/004_todos.sql in the SQL Editor.'
                       : error.message };
    }
    await cacheSet(TODO_CACHE, data || []);
    return { items: data || [], error: null };
  }

  async function addTodo(t){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured - the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first - adding writes to the shared list.');
    const row = { title: t.title, note: t.note || null, due: t.due || null,
                  updated_at: new Date().toISOString(), updated_by: s.user.id };
    const { data, error } = await c.from('todos').insert(row).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function setTodoDone(id, done){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured - the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first - ticking off writes to the shared list.');
    const { error } = await c.from('todos').update({
      done: !!done, done_at: done ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(), updated_by: s.user.id
    }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function subscribeTodos(fn){
    const c = await client(); if (!c) return;
    c.channel('todos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => fn())
      .subscribe();
  }

  /* ------------------------------------------------------------------ ESN

     One table and one private storage bucket. The tool never speaks to either
     directly - this is the only file that does, so there is one place to look
     when a screenshot goes missing. */
  const ESN = 'esn_records', BUCKET = 'esn';

  async function esnList(limit){
    const c = await client(); if (!c) return { rows: [], error: 'offline' };
    const { data, error } = await c.from(ESN).select('*')
      .order('created_at', { ascending: false }).limit(limit || 500);
    if (error) return { rows: [], error: error.message };
    return { rows: data || [], error: null };
  }

  /* Images go to storage under the site they belong to, named by when they
     arrived, so two people filing the same site never overwrite each other. */
  async function esnUpload(siteId, kind, blob, ext){
    const c = await client(); if (!c) throw new Error('Not connected.');
    const s = await session(); if (!s) throw new Error('Sign in first.');
    const safe = String(siteId || 'unknown').toUpperCase().replace(/[^A-Z0-9_-]+/g, '') || 'UNKNOWN';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = safe + '/' + stamp + '-' + kind + '.' + (ext || 'webp');
    const { error } = await c.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type || 'image/webp', upsert: false });
    if (error) throw new Error(error.message);
    return path;
  }

  /* The bucket is private, so a path is not a URL. These are short-lived links
     asked for at the moment something is shown or exported. */
  async function esnLink(path, seconds){
    const c = await client(); if (!c || !path) return null;
    const { data, error } = await c.storage.from(BUCKET)
      .createSignedUrl(path, seconds || 3600);
    return error ? null : (data ? data.signedUrl : null);
  }

  async function esnSave(rec){
    const c = await client(); if (!c) throw new Error('Not connected.');
    const s = await session(); if (!s) throw new Error('Sign in first.');
    const row = {
      site_id: rec.siteId, site_name: rec.siteName || null,
      run_om: !!rec.runOm,
      esn_photo: rec.esnPhoto || null, esn_full: rec.esnFull || null,
      om_ip_photo: rec.omIpPhoto || null,
      cards: rec.cards || [], note: rec.note || null,
      created_by: s.user.id, created_email: s.user.email || null
    };
    const q = rec.id
      ? c.from(ESN).update(row).eq('id', rec.id).select().single()
      : c.from(ESN).insert(row).select().single();
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data;
  }

  /* The row and its pictures go together. The pictures first: a row deleted
     with its images left behind is storage nobody can find again, and nobody
     would ever notice. If the images refuse, the row stays too, so the record
     still points at them and it can be tried again. */
  async function esnDelete(id, paths){
    const c = await client(); if (!c) throw new Error('Not connected.');
    const keep = (paths || []).filter(Boolean);
    if (keep.length){
      const { error: se } = await c.storage.from(BUCKET).remove(keep);
      if (se) throw new Error(se.message);
    }
    const { error } = await c.from(ESN).delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function esnSubscribe(fn){
    const c = await client(); if (!c) return;
    c.channel('esn_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: ESN }, () => fn())
      .subscribe();
  }

  window.DB = { configured, client, session, signIn, signUp, signOut, onAuth, emailForUsername, myProfile, setUsername,
                esnList, esnSave, esnDelete, esnUpload, esnLink, esnSubscribe,
                load, publish, subscribe,
                publishBook, loadBook, subscribeBook,
                listTodos, addTodo, setTodoDone, subscribeTodos,
                cacheSet, cacheGet };
})();
