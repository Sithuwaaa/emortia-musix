/* A sign-in gate for Supabase Auth.

   Worth being clear about why this exists alongside the old passphrase gate in
   owner.js. That one only decides whether edit controls are drawn — it is a
   client-side check and a determined person can walk past it. It stays, because
   hiding the buttons from casual visitors is still worth doing.

   This one is different: the row level security policies on the server test
   auth.uid() against the owner's id, so a write with no session is refused by
   Postgres no matter what the page believes. That is the real gate. Which is
   why uploads ask for this and not the passphrase. */
(function(){
  let el = null;

  function css(){
    if (document.getElementById('agcss')) return;
    const s = document.createElement('style'); s.id = 'agcss';
    s.textContent = `
      .ag-back{position:fixed;inset:0;z-index:200;background:rgba(4,12,14,.72);
        backdrop-filter:blur(3px);display:grid;place-items:center;padding:20px;
        animation:agIn .22s ease}
      @keyframes agIn{from{opacity:0}to{opacity:1}}
      .ag-box{width:min(380px,100%);background:var(--card,#142428);
        border:1px solid var(--line3,#2c4c54);border-radius:16px;padding:22px;
        box-shadow:0 30px 70px rgba(0,0,0,.6);animation:agUp .26s cubic-bezier(.2,.8,.3,1)}
      @keyframes agUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
      .ag-box h3{font-family:'Bricolage Grotesque',sans-serif;font-size:19px;margin:0 0 4px;
        color:var(--text,#e9f4f6)}
      .ag-box p{color:var(--muted,#8fa8ad);font-size:13px;line-height:1.5;margin:0 0 16px}
      .ag-box label{display:block;font-family:'Space Mono',monospace;font-size:10.5px;
        letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#8fa8ad);margin:10px 0 5px}
      .ag-box input{width:100%;background:var(--card-2,#0f1d21);color:var(--text,#e9f4f6);
        border:1px solid var(--line,#1e363c);border-radius:9px;padding:10px 12px;font-size:14px;
        font-family:inherit;outline:none}
      .ag-box input:focus{border-color:var(--accent,#1f97a8)}
      .ag-row{display:flex;gap:9px;margin-top:18px}
      .ag-row button{flex:1;border:none;border-radius:9px;padding:11px;font-size:13.5px;
        font-weight:700;cursor:pointer;font-family:inherit}
      .ag-go{background:var(--accent,#1f97a8);color:var(--accent-ink,#04191d)}
      .ag-no{background:none;color:var(--muted,#8fa8ad);border:1px solid var(--line,#1e363c) !important}
      .ag-err{color:var(--warn,#f2764a);font-size:12.5px;margin-top:11px;line-height:1.45;min-height:1em}
    `;
    document.head.appendChild(s);
  }

  function close(){ if (el){ el.remove(); el = null; } }

  /* Resolves with the session, or null if dismissed. */
  function signIn(){
    css();
    return new Promise(resolve => {
      close();
      el = document.createElement('div');
      el.className = 'ag-back';
      el.innerHTML =
        '<div class="ag-box" role="dialog" aria-modal="true">' +
          '<h3>Sign in to publish</h3>' +
          '<p>Uploading writes to the shared database, so it needs the owner account. ' +
             'Everyone else can read without signing in.</p>' +
          '<label for="agEmail">Email</label><input id="agEmail" type="email" autocomplete="username">' +
          '<label for="agPass">Password</label><input id="agPass" type="password" autocomplete="current-password">' +
          '<div class="ag-err" id="agErr"></div>' +
          '<div class="ag-row"><button class="ag-no" id="agNo">Cancel</button>' +
          '<button class="ag-go" id="agGo">Sign in</button></div>' +
        '</div>';
      document.body.appendChild(el);
      const email = el.querySelector('#agEmail'), pass = el.querySelector('#agPass'),
            err = el.querySelector('#agErr'), go = el.querySelector('#agGo');
      email.focus();

      const fail = m => { err.textContent = m; go.disabled = false; go.textContent = 'Sign in'; };
      const submit = async () => {
        err.textContent = ''; go.disabled = true; go.textContent = 'Signing in…';
        if (!email.value.trim() || !pass.value) return fail('Both fields are needed.');
        try {
          const s = await window.DB.signIn(email.value.trim(), pass.value);
          close(); resolve(s);
        } catch (e){
          fail(/invalid login/i.test(e.message)
            ? 'That email and password did not match.' : e.message);
        }
      };
      go.onclick = submit;
      el.querySelector('#agNo').onclick = () => { close(); resolve(null); };
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape'){ close(); resolve(null); }
      });
      el.addEventListener('mousedown', e => { if (e.target === el){ close(); resolve(null); } });
    });
  }

  /* Session if there is one, otherwise ask. */
  async function require(){
    if (!window.DB || !window.DB.configured()) throw new Error('Supabase is not configured yet — add the anon key to tools/_lib/supabase-config.js.');
    return (await window.DB.session()) || await signIn();
  }

  window.AuthGate = { signIn, require, close };
})();
