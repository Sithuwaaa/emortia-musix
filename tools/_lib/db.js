/* db.js — the only file that talks to storage.

   Every tool goes through this. Nothing else should call supabase, fetch a
   data.json, or write to IndexedDB, so there is exactly one place to look when
   data goes somewhere unexpected.

   The shape all the lookup tools work in is {cols, rows}: cols is an array of
   the sheet's own headings, rows is an array of arrays in that order. Postgres
   holds each row as jsonb keyed by heading, so the order lives in `datasets`
   and the translation happens here.

   Order of truth:
     server  — what everyone sees
     cache   — IndexedDB, so the page opens offline and paints before the
               network answers
     bundled — data.json in the repository, the floor if there is no session,
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
    if (!c) throw new Error('Supabase is not configured — the anon key is missing from tools/_lib/supabase-config.js.');
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data.session;
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
    if (!c) throw new Error('Supabase is not configured — the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first — the write policies check auth.uid(), so uploads fail without a session.');

    const table = TABLE[key], keyCol = KEYCOL[key];
    const idx = cols.indexOf(cols.find(cn => cn.toLowerCase().replace(/[^a-z]/g,'') === 'siteid') || cols[0]);

    const recs = rows.map(r => {
      const o = {}; cols.forEach((cn, i) => { o[cn] = r[i] == null ? '' : String(r[i]); });
      const rec = {}; rec[keyCol] = String(r[idx] || '').trim(); rec.data = o; return rec;
    }).filter(r => r[keyCol]);

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

  window.DB = { configured, client, session, signIn, signOut, onAuth,
                load, publish, subscribe, cacheSet, cacheGet };
})();
