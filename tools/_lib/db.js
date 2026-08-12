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
     this is not a table of records — it is many sheets of differing shapes, and
     each dataset carries its own sheet list. Ongoing has eleven sheets, Master
     eight with different names, so nothing here may assume a fixed set. */
  const BOOK_CACHE = k => 'book:' + k;

  async function publishBook(key, book){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured — the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first — the write policies check auth.uid(), so uploads fail without a session.');

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
     page is usable, but the caller is told why — an empty list and a broken
     connection look identical on screen otherwise, and "nothing pending" is a
     bad way to find out the table was never created. */
  async function listTodos(){
    const cached = async () => (await cacheGet(TODO_CACHE)) || [];
    const c = await client();
    if (!c) return { items: await cached(),
      error: configured() ? 'Could not reach Supabase.'
                          : 'Not syncing — the anon key is missing from tools/_lib/supabase-config.js.' };
    const { data, error } = await c.from('todos')
      .select('id,title,note,due,done,done_at,created_at')
      .order('done', { ascending: true })
      .order('due', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (error){
      console.warn('Todo read failed, using the cached list:', error.message);
      const missing = /schema cache|does not exist/i.test(error.message);
      return { items: await cached(),
        error: missing ? 'The todos table does not exist yet — run supabase/004_todos.sql in the SQL Editor.'
                       : error.message };
    }
    await cacheSet(TODO_CACHE, data || []);
    return { items: data || [], error: null };
  }

  async function addTodo(t){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured — the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first — adding writes to the shared list.');
    const row = { title: t.title, note: t.note || null, due: t.due || null,
                  updated_at: new Date().toISOString(), updated_by: s.user.id };
    const { data, error } = await c.from('todos').insert(row).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function setTodoDone(id, done){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured — the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first — ticking off writes to the shared list.');
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

  /* ---------- BOMs ----------
     A bill of materials is read and written whole, so its lines travel as one
     jsonb column rather than a table of their own. Same bargain as the todos:
     a failed read still hands back the cache, and says why. */
  const BOM_CACHE = 'boms_cache', PORT_CACHE = 'bom_ports_cache';

  /* "Could not find the table 'public.boms' in the schema cache" is Postgres
     telling you the migration has not been run. Say that instead — the reader
     of this message is the person who can fix it in a minute. */
  function bomErr(msg){
    return /schema cache|does not exist/i.test(msg || '')
      ? 'The boms tables are not created yet — run supabase/005_boms.sql in the Supabase SQL Editor.'
      : msg;
  }

  async function listBoms(){
    const cached = async () => (await cacheGet(BOM_CACHE)) || [];
    const c = await client();
    if (!c) return { items: await cached(),
      error: configured() ? 'Could not reach Supabase.'
                          : 'Not syncing — the anon key is missing from tools/_lib/supabase-config.js.' };
    const { data, error } = await c.from('boms')
      .select('id,site_id,site_name,tx_plan,sectors,rrus,note,lines,updated_at')
      .order('updated_at', { ascending: false });
    if (error){
      const missing = /schema cache|does not exist/i.test(error.message);
      return { items: await cached(),
        error: missing ? 'The boms table does not exist yet — run supabase/005_boms.sql in the SQL Editor.'
                       : error.message };
    }
    await cacheSet(BOM_CACHE, data || []);
    return { items: data || [], error: null };
  }

  async function saveBom(b){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured — the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first — a BOM is saved to the shared list.');
    const row = { site_id: b.site_id, site_name: b.site_name || null, tx_plan: b.tx_plan || null,
                  sectors: b.sectors == null ? null : +b.sectors,
                  rrus: b.rrus == null ? null : +b.rrus,
                  note: b.note || null, lines: b.lines || [],
                  updated_at: new Date().toISOString(), updated_by: s.user.id };
    const q = b.id ? c.from('boms').update(row).eq('id', b.id).select().single()
                   : c.from('boms').insert(row).select().single();
    const { data, error } = await q;
    if (error) throw new Error(bomErr(error.message));
    return data;
  }

  async function deleteBom(id){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured — the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first — deleting changes the shared list.');
    const { error } = await c.from('boms').delete().eq('id', id);
    if (error) throw new Error(bomErr(error.message));
  }

  async function listPortTypes(){
    const cached = async () => (await cacheGet(PORT_CACHE)) || [];
    const c = await client();
    if (!c) return { items: await cached(), error: null };
    const { data, error } = await c.from('bom_port_types').select('name,kind,port');
    if (error) return { items: await cached(), error: error.message };
    await cacheSet(PORT_CACHE, data || []);
    return { items: data || [], error: null };
  }

  async function savePortType(p){
    const c = await client();
    if (!c) throw new Error('Supabase is not configured — the anon key is missing.');
    const s = await session();
    if (!s) throw new Error('Sign in first — port types are shared.');
    const { error } = await c.from('bom_port_types').upsert({
      name: p.name, kind: p.kind, port: p.port,
      updated_at: new Date().toISOString(), updated_by: s.user.id }, { onConflict: 'name' });
    if (error) throw new Error(bomErr(error.message));
  }

  async function subscribeBoms(fn){
    const c = await client(); if (!c) return;
    c.channel('boms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boms' }, () => fn())
      .subscribe();
  }

  window.DB = { configured, client, session, signIn, signOut, onAuth,
                load, publish, subscribe,
                publishBook, loadBook, subscribeBook,
                listTodos, addTodo, setTodoDone, subscribeTodos,
                listBoms, saveBom, deleteBom, listPortTypes, savePortType, subscribeBoms,
                cacheSet, cacheGet };
})();
