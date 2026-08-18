/* access.js - who may open the tools.

   A username and a password, checked against the salted hashes in
   access-config.js, and a session that lasts seven days.

   Nothing here is a substitute for a server. See the note at the bottom of
   access-config.js: the tool pages and their data.json files are served
   publicly, so this is a gate on the door of a room with open windows. It is
   worth having - it stops the tools being stumbled into - and it is worth
   knowing what it is.

   Load access-config.js before this file. owner.js, if present, is honoured:
   the owner is never locked out of their own tools. */
(function () {
  'use strict';

  var KEY   = 'emortia_access_v1';
  var USERS = (window.ACCESS_USERS || []);
  var EPOCH = String(window.ACCESS_EPOCH == null ? 1 : window.ACCESS_EPOCH);
  var DAYS  = Number(window.ACCESS_DAYS || 7);
  var MS    = DAYS * 24 * 60 * 60 * 1000;

  /* ---------------------------------------------------------- hashing ---- */

  var hex = function (buf) {
    return Array.prototype.map.call(new Uint8Array(buf),
      function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  };
  var unhex = function (s) {
    var out = new Uint8Array(String(s).length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  };
  var randomSalt = function () { return hex(crypto.getRandomValues(new Uint8Array(16))); };

  /* PBKDF2 rather than a bare SHA-256: the hashes sit in a public file, and a
     bare hash of a short password is a lookup away from the password. */
  async function derive(password, saltHex, iter) {
    var key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password),
      'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: unhex(saltHex), iterations: iter || 210000, hash: 'SHA-256' }, key, 256);
    return hex(bits);
  }
  /* compare without leaking where two strings start to differ */
  function same(a, b) {
    a = String(a); b = String(b);
    if (a.length !== b.length) return false;
    var d = 0;
    for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  }

  /* ---------------------------------------------------------- session ---- */

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }
  function write(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {}
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }

  /* A session is good while it has not run out and while it still carries the
     epoch it was issued under. Changing ACCESS_EPOCH ends every one of them. */
  function session() {
    var s = read();
    if (!s || !s.user || !s.until) return null;
    if (String(s.epoch) !== EPOCH) { clear(); return null; }
    if (Date.now() > s.until) { clear(); return null; }
    return s;
  }
  /* Owner mode is a property of the account now, not a passphrase in the URL.
     Whoever is named in ACCESS_OWNERS gets it by signing in as themselves. */
  function owners() {
    return (window.ACCESS_OWNERS || []).map(function (n) { return String(n).trim().toLowerCase(); });
  }
  /* Matched on the name or on the whole address, because the same person may
     sign up as "Sithuwaaa" or as their real inbox and should be the owner
     either way. */
  function isOwner() {
    var s = session();
    if (!s) return false;
    var list = owners();
    var name = String(s.user || '').trim().toLowerCase();
    var mail = String(s.email || '').trim().toLowerCase();
    return list.indexOf(name) > -1 || (!!mail && list.indexOf(mail) > -1);
  }

  function signedIn() { return !!session(); }
  function currentUser() { var s = session(); return s ? s.user : null; }
  /* only shown back to the person it belongs to, on their own profile */
  function currentEmail() { var s = session(); return s ? (s.email || '') : ''; }
  function daysLeft() {
    var s = session();
    if (!s) return null;
    return Math.max(0, Math.ceil((s.until - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  /* ---------------------------------------------------- where accounts live

     Supabase when it is configured, which is what makes signing up possible at
     all: an account has to be recorded somewhere both devices can see, and a
     static site has nowhere to put it. The list in access-config.js stays as
     the fallback for when Supabase is not reachable. */
  function remote() { return !!(window.DB && window.DB.configured && window.DB.configured()); }

  /* Supabase keys accounts by email. A bare name is given a domain so that
     "sithuwaaa" and "sithuwaaa@…" are the same account either way - but a real
     address is worth using, because it is the only way to recover a password. */
  function asEmail(id) {
    id = String(id || '').trim();
    if (!id) return '';
    if (id.indexOf('@') > -1) return id.toLowerCase();
    return id.toLowerCase().replace(/[^a-z0-9._-]+/g, '') + '@' + (window.ACCESS_DOMAIN || 'emortia.local');
  }
  var nameOf = function (email) { return String(email || '').split('@')[0]; };

  function keep(user, email) {
    write({ user: user, email: email || '', epoch: EPOCH, since: Date.now(), until: Date.now() + MS });
  }

  async function localSignIn(user, password) {
    user = String(user || '').trim().toLowerCase();
    var rec = USERS.filter(function (u) {
      return String(u.user || '').trim().toLowerCase() === user; })[0];
    /* Do the work even when there is no such user, so a wrong username and a
       wrong password take the same time and tell an outsider the same thing. */
    var probeSalt = rec ? rec.salt : '00000000000000000000000000000000';
    var got = await derive(password, probeSalt, rec ? rec.iter : 210000);
    if (!rec || !same(got, rec.hash)) return { ok: false, error: 'That username and password do not match.' };
    keep(rec.user);
    return { ok: true, user: rec.user };
  }

  /* Nothing on screen should name a table, a bucket or a schema. Everyone gets
     a sentence about what to do next; the owner gets the real message after it,
     because the owner is the one who has to act on it. */
  function tidy(message) {
    var m = String(message || '');
    var plain;
    if (/invalid login/i.test(m))      plain = 'That username and password do not match.';
    else if (/already registered/i.test(m)) plain = 'There is already an account with that name. Sign in instead.';
    else if (/password/i.test(m) && /least|short|6/i.test(m)) plain = 'Use a password of at least six characters.';
    else if (/valid email/i.test(m))   plain = 'That does not look like an email address.';
    else if (/rate limit|too many/i.test(m)) plain = 'Too many tries. Wait a minute and go again.';
    else if (/schema cache|does not exist|relation .* does not exist|could not find the table/i.test(m))
      plain = 'Names are not switched on yet. Sithara has one step left to do - nothing is wrong with what you typed.';
    else if (/duplicate|unique/i.test(m)) plain = 'That name is taken.';
    else if (/violates check|username_shape/i.test(m))
      plain = 'A name is 3 to 32 letters, numbers, dots, dashes or underscores.';
    else if (/jwt|not authenticated|row-level security|permission/i.test(m))
      plain = 'Your sign-in has run out. Reload the page and sign in again.';
    else if (/fetch|network|failed to|timeout/i.test(m))
      plain = 'No connection just now. Try again in a moment.';
    else plain = m || 'That did not work.';

    /* only append the raw thing when it says something the sentence does not */
    return (isOwner() && m && m !== plain) ? plain + '  (' + m + ')' : plain;
  }

  /* Signing in is the username and the password. The account is keyed by the
     address underneath, so a bare name is turned back into one first - nobody
     should have to remember which address they used months ago. An address
     still works, for anyone who would rather type it. */
  async function signIn(id, password) {
    id = String(id || '').trim();
    if (!id || !password) return { ok: false, error: 'Both a username and a password, please.' };
    if (!window.crypto || !crypto.subtle)
      return { ok: false, error: 'This browser will not do the maths over an insecure connection. Use https.' };

    if (remote()) {
      var email = id, uname = id;
      if (id.indexOf('@') < 0) {
        var found = null;
        try { found = await window.DB.emailForUsername(id); } catch (e) {}
        /* no such name: fall through with the made-up address so the attempt
           still takes the same time and says the same thing as a wrong password */
        email = found || asEmail(id);
      } else uname = nameOf(id);

      try {
        await window.DB.signIn(email, password);
        /* The name comes from the profile, not from the address. Somebody who
           signed up with sithuwaaathepage@gmail.com and then renamed
           themselves Sithuwaaa should be Sithuwaaa everywhere, including on
           the sign-in where they typed the address. */
        var who = id.indexOf('@') < 0 ? id : uname;
        try {
          var p = await window.DB.myProfile();
          if (p && p.username) who = p.username;
        } catch (e2) {}
        keep(who, email);
        return { ok: true, user: who };
      } catch (e) {
        /* a name only in the local list still works when the server says no */
        var local = await localSignIn(id, password);
        if (local.ok) return local;
        return { ok: false, error: tidy(e.message) };
      }
    }
    return localSignIn(id, password);
  }

  /* Making an account. Only Supabase can do this - the local list is a file in
     the repository and a browser cannot write to it. */
  /* Signing up asks for all three: a username to sign in with afterwards, an
     address so a confirmation and a password reset have somewhere to go, and
     a password. The username is carried on the account itself, and the server
     copies it into the table that turns names back into addresses. */
  async function signUp(username, email, password) {
    username = String(username || '').trim();
    email = String(email || '').trim();
    if (!username) return { ok: false, error: 'Pick a username - that is what you will sign in with.' };
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username))
      return { ok: false, error: 'A username is 3 to 32 letters, numbers, dots, dashes or underscores.' };
    if (!email || email.indexOf('@') < 0) return { ok: false, error: 'An email address, please - it is the only way to get a password reset.' };
    if (!password) return { ok: false, error: 'A password, please.' };
    if (String(password).length < 6) return { ok: false, error: 'Use a password of at least six characters.' };
    if (!remote()) return { ok: false, error:
      'Signing up is not available here. Accounts have to be added by hand with #adduser.' };

    email = email.toLowerCase();
    var allow = window.ACCESS_SIGNUP;
    if (Array.isArray(allow) && !allow.some(function (a) {
          a = String(a).toLowerCase();
          return a.charAt(0) === '@' ? email.slice(-a.length) === a : email === a;
        }))
      return { ok: false, error: 'That address is not on the list of people who may sign up.' };

    try {
      var out = await window.DB.signUp(email, password, { username: username });
      if (out && out.session) { keep(username, email); return { ok: true, user: username }; }
      /* No session back means the address has to be confirmed first. Said
         without naming what is doing the asking - nobody filing an ESN needs
         to know the machinery, and that was the whole point of the gate. */
      return { ok: false, pending: true, error:
        'Account made. Open the email sent to ' + email + ' to confirm it, then sign in.' };
    } catch (e) { return { ok: false, error: tidy(e.message) }; }
  }

  /* Changing your own name. The session carries the display name, so it is
     rewritten here too - otherwise the chip would keep saying the old one
     until the seven days ran out. */
  async function rename(name) {
    name = String(name || '').trim();
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(name))
      return { ok: false, error: 'A name is 3 to 32 letters, numbers, dots, dashes or underscores.' };
    if (!remote()) return { ok: false, error: 'Not connected just now. Try again in a moment.' };
    var s = session();
    if (!s) return { ok: false, error: 'Sign in first.' };
    if (String(s.user) === name) return { ok: true, user: name, unchanged: true };
    try {
      await window.DB.setUsername(name);
      write({ user: name, email: s.email || '', epoch: EPOCH, since: s.since, until: s.until });
      applyOwner();
      return { ok: true, user: name };
    } catch (e) { return { ok: false, error: tidy(e.message) }; }
  }

  /* Pull the name from the server, for a session made before the profile was
     renamed on another device. */
  async function refresh() {
    var s = session();
    if (!s || !remote()) return null;
    try {
      var p = await window.DB.myProfile();
      if (p && p.username && p.username !== s.user) {
        write({ user: p.username, email: p.email || s.email || '', epoch: EPOCH, since: s.since, until: s.until });
        applyOwner();
        return p.username;
      }
    } catch (e) {}
    return null;
  }

  function signOut() {
    clear();
    try { if (window.DB && window.DB.signOut) window.DB.signOut(); } catch (e) {}
    location.reload();
  }

  /* -------------------------------------------------- adding a person ---- */

  async function makeUserLine(user, password) {
    var salt = randomSalt(), iter = 210000;
    var hash = await derive(password, salt, iter);
    return "  { user:'" + String(user).trim().toLowerCase().replace(/'/g, "\\'") +
           "', salt:'" + salt + "', hash:'" + hash + "', iter:" + iter + " },";
  }

  async function handleHash() {
    var h = (location.hash || '').toLowerCase();
    if (h === '#adduser') {
      history.replaceState(null, '', location.pathname + location.search);
      var u = prompt('Username for the new person:');
      if (!u) return;
      var p = prompt('Password for ' + u + ':\n\nIt is turned into a salted hash here and now. The password itself is never stored or sent.');
      if (!p) return;
      var line = await makeUserLine(u, p);
      prompt('Paste this line into window.ACCESS_USERS in tools/_lib/access-config.js, then commit:', line);
      return;
    }
    if (h === '#signout') { history.replaceState(null, '', location.pathname + location.search); signOut(); }
  }
  addEventListener('hashchange', handleHash);

  /* -------------------------------------------------------- the gate ---- */

  var CSS = [
    '.acc-gate{position:fixed;inset:0;z-index:99998;display:grid;place-items:center;padding:22px;',
    '  background:radial-gradient(ellipse at 50% 0%,#241318,#120b0e 70%);',
    '  font-family:"Hanken Grotesk",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#f7edf0;}',
    '.acc-card{width:100%;max-width:372px;background:rgba(43,23,30,.55);backdrop-filter:blur(22px) saturate(1.3);',
    '  border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:26px 24px 22px;',
    '  box-shadow:0 26px 70px rgba(0,0,0,.6);animation:accIn .34s cubic-bezier(.22,.7,.24,1);}',
    '@keyframes accIn{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
    '.acc-logo{width:34px;height:34px;border-radius:50%;background:linear-gradient(150deg,#d15873,#87213c);',
    '  display:flex;align-items:center;justify-content:center;gap:2.6px;margin-bottom:16px;}',
    '.acc-logo i{width:3px;border-radius:2px;background:#170d10;display:block;}',
    '.acc-card h1{font-size:20px;font-weight:700;margin:0 0 5px;letter-spacing:-.01em;}',
    '.acc-card p{margin:0 0 18px;font-size:13.5px;line-height:1.55;color:#c19da8;}',
    '.acc-card label{display:block;font-family:"Space Mono",monospace;font-size:10px;letter-spacing:.14em;',
    '  text-transform:uppercase;color:#8d6a75;margin:0 0 5px;}',
    '.acc-card input{width:100%;box-sizing:border-box;background:rgba(23,13,16,.6);color:#f7edf0;',
    '  border:1px solid #412730;border-radius:10px;padding:11px 12px;font-size:14.5px;font-family:inherit;',
    '  outline:none;margin-bottom:13px;transition:border-color .16s ease;}',
    '.acc-card input:focus{border-color:#b03a56;}',
    '.acc-go{width:100%;background:#b03a56;color:#fff;border:none;border-radius:10px;padding:12px;',
    '  font-family:inherit;font-size:14.5px;font-weight:700;cursor:pointer;transition:background .16s ease;}',
    '.acc-go:hover{background:#d15873;} .acc-go:disabled{opacity:.55;cursor:default;}',
    '.acc-seg{display:flex;gap:3px;background:rgba(23,13,16,.55);border:1px solid #412730;',
    '  border-radius:11px;padding:3px;margin-bottom:16px;}',
    '.acc-seg-b{flex:1;background:none;border:none;border-radius:8px;color:#c19da8;cursor:pointer;',
    '  padding:8px 10px;font:600 13px/1 inherit;font-family:inherit;transition:background .15s ease,color .15s ease;}',
    '.acc-seg-b:hover{color:#f7edf0;}',
    '.acc-seg-b.on{background:#b03a56;color:#fff;}',
    '.acc-pw{position:relative;}',
    '.acc-pw input{padding-right:46px;}',
    '.acc-eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);margin-top:-6px;',
    '  background:none;border:none;padding:7px;cursor:pointer;color:#8d6a75;line-height:0;border-radius:8px;',
    '  transition:color .15s ease;}',
    '.acc-eye svg{width:19px;height:19px;display:block;}',
    '.acc-eye:hover{color:#f7edf0;}',
    '.acc-eye:focus-visible{outline:2px solid #b03a56;outline-offset:1px;}',
    '.acc-err{color:#e2607a;font-size:13px;margin:0 0 12px;min-height:1em;line-height:1.5;}',
    '.acc-err.ok{color:#7fdc8a;}',
    '.acc-card code{font-family:"Space Mono",ui-monospace,monospace;font-size:12.5px;color:#f7edf0;}',
    '.acc-foot{margin:16px 0 0;font-size:12px;color:#8d6a75;text-align:center;}',
    '.acc-foot a{color:#c19da8;}'
  ].join('\n');

  /* An eye that is open when the password is hidden and struck through when it
     is showing - the icon says what pressing it will do, which is the way round
     people read it. */
  var EYE_SHOW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">' +
    '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';
  var EYE_HIDE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round">' +
    '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>' +
    '<path d="M3.5 3.5l17 17"/></svg>';

  function gateMarkup(title, note) {
    return '<div class="acc-card" role="dialog" aria-label="Sign in">' +
      '<div class="acc-logo"><i style="height:8px"></i><i style="height:14px"></i><i style="height:10px"></i><i style="height:15px"></i></div>' +
      '<div class="acc-seg"><button type="button" class="acc-seg-b on" data-mode="in">Sign in</button>' +
        '<button type="button" class="acc-seg-b" data-mode="up">Sign up</button></div>' +
      '<p id="accNote">' + note + '</p>' +
      '<form id="accForm" autocomplete="on">' +
        '<label for="accUser">Username</label>' +
        '<input id="accUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>' +
        '<div id="accMailWrap" style="display:none">' +
          '<label for="accMail">Email</label>' +
          '<input id="accMail" name="email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false">' +
        '</div>' +
        '<label for="accPass">Password</label>' +
        '<div class="acc-pw">' +
          '<input id="accPass" name="password" type="password" autocomplete="current-password" required>' +
          '<button type="button" class="acc-eye" id="accEye" aria-label="Show password" title="Show password">' +
            EYE_SHOW + '</button>' +
        '</div>' +
        '<p class="acc-err" id="accErr"></p>' +
        '<button class="acc-go" type="submit" id="accGo">Sign in</button>' +
      '</form>' +
    '</div>';
  }

  /* Put the gate over a tool page and keep it there until someone signs in.

     opts.owner marks a tool as the owner's own. Somebody already signed in is
     not asked to sign in again - they are told plainly that this one is not
     theirs, with the way back, because a sign-in form they cannot get past is
     a puzzle rather than an answer. */
  function guard(opts) {
    opts = opts || {};
    if (opts.owner ? isOwner() : signedIn()) return true;

    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var g = document.createElement('div');
    g.className = 'acc-gate';

    if (opts.owner && signedIn()) {
      g.innerHTML = '<div class="acc-card" role="dialog" aria-label="Not yours">' +
        '<div class="acc-logo"><i style="height:8px"></i><i style="height:14px"></i>' +
          '<i style="height:10px"></i><i style="height:15px"></i></div>' +
        '<h1 style="margin-bottom:6px">Not this one</h1>' +
        '<p>This tool is Sithara\'s own. Everything else is open to you - ' +
          'you are signed in as <b>' + esc(currentUser()) + '</b>.</p>' +
        '<a class="acc-go" href="../../" style="display:block;text-align:center;text-decoration:none">' +
          'Back to the tools</a></div>';
      document.body.appendChild(g);
      document.documentElement.style.overflow = 'hidden';
      return false;
    }

    g.innerHTML = gateMarkup(opts.title || 'Sign in', opts.note || (remote()
      ? 'These tools are not public. Sign in, or make an account if you have not got one.'
      : (USERS.length === 0
          ? 'No accounts exist yet, and Supabase is not configured to make them. Add <code>#adduser</code> to the end of this address to write the first one by hand.'
          : 'These tools are not public. Sign in to open them.')));
    document.body.appendChild(g);
    document.documentElement.style.overflow = 'hidden';
    wire(g, function () { location.reload(); });
    return false;
  }
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g,
      function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; });
  };

  function wire(root, onDone) {
    var form = root.querySelector('#accForm'),
        err  = root.querySelector('#accErr'),
        go   = root.querySelector('#accGo'),
        pass = root.querySelector('#accPass'),
        note = root.querySelector('#accNote'),
        segs = [].slice.call(root.querySelectorAll('.acc-seg-b'));
    var mode = 'in';
    var firstNote = note ? note.innerHTML : '';

    var mailWrap = root.querySelector('#accMailWrap');
    var mail = root.querySelector('#accMail');

    function setMode(m) {
      mode = m;
      segs.forEach(function (b) { b.classList.toggle('on', b.dataset.mode === m); });
      go.textContent = m === 'in' ? 'Sign in' : 'Create the account';
      pass.setAttribute('autocomplete', m === 'in' ? 'current-password' : 'new-password');
      err.textContent = ''; err.className = 'acc-err';
      /* the address is only asked for once; after that the username is enough */
      if (mailWrap) mailWrap.style.display = m === 'up' ? '' : 'none';
      if (mail) mail.required = m === 'up';
      if (!note) return;
      note.innerHTML = m === 'in' ? firstNote
        : 'Pick a username to sign in with. The address is only for confirming the account and resetting a password.';
    }
    segs.forEach(function (b) { b.onclick = function () { setMode(b.dataset.mode); }; });

    /* Show the password. Worth having on a phone, where a mistyped character
       is invisible and the only clue is being refused. */
    var eye = root.querySelector('#accEye');
    if (eye) eye.onclick = function () {
      var showing = pass.type === 'text';
      pass.type = showing ? 'password' : 'text';
      eye.innerHTML = showing ? EYE_SHOW : EYE_HIDE;
      eye.title = eye.setAttribute('aria-label', showing ? 'Show password' : 'Hide password') ||
                  (showing ? 'Show password' : 'Hide password');
      pass.focus();
      /* keep the caret at the end rather than sending it back to the start */
      var v = pass.value; pass.value = ''; pass.value = v;
    };

    setTimeout(function () { var u = root.querySelector('#accUser'); if (u) u.focus(); }, 60);

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      err.textContent = ''; err.className = 'acc-err';
      go.disabled = true; go.textContent = mode === 'in' ? 'Checking…' : 'Making it…';
      var id = root.querySelector('#accUser').value;
      var r = mode === 'in' ? await signIn(id, pass.value)
                            : await signUp(id, mail ? mail.value : '', pass.value);
      if (r.ok) { onDone(); return; }
      go.disabled = false; go.textContent = mode === 'in' ? 'Sign in' : 'Create the account';
      err.textContent = r.error;
      /* "confirm your email" is not a failure, so it should not read as one */
      if (r.pending) err.className = 'acc-err ok';
      pass.value = '';
      pass.focus();
    });
  }

  /* Once you are in, the page should say so and offer the way out. Every tool
     header is built the same way - a .hdr with a theme button at the end - so
     the chip goes in beside it rather than being pasted into seven files. The
     site has its own, in the nav.

     Not called on the site: it renders its own and this would be a second one. */
  var CHIP_CSS = [
    '.acc-chip{display:inline-flex;align-items:center;gap:7px;padding:4px 5px 4px 10px;',
    '  border:1px solid var(--line3,rgba(255,255,255,.2));border-radius:999px;',
    '  background:rgba(0,0,0,.28);white-space:nowrap;flex-shrink:0;}',
    '.acc-chip-d{width:6px;height:6px;border-radius:50%;background:#7fdc8a;flex-shrink:0}',
    '.acc-chip-n{font-family:"Space Mono",ui-monospace,monospace;font-size:11.5px;color:#fff;opacity:.9;',
    '  max-width:12ch;overflow:hidden;text-overflow:ellipsis}',
    '.acc-chip-o{background:none;border:1px solid var(--line3,rgba(255,255,255,.24));border-radius:999px;',
    '  color:#fff;opacity:.72;cursor:pointer;font:600 11.5px/1 inherit;font-family:inherit;padding:4px 9px;',
    '  transition:opacity .16s ease,border-color .16s ease}',
    '.acc-chip-o:hover{opacity:1;border-color:var(--accent,#b03a56)}',
    '@media (max-width:560px){.acc-chip-n{display:none}}'
  ].join('\n');

  function chip() {
    if (document.getElementById('__accChip')) return;
    if (document.querySelector('x-dc')) return;            // the site does its own
    var who = currentUser();
    if (!who) return;
    var st = document.createElement('style'); st.textContent = CHIP_CSS; document.head.appendChild(st);

    var c = document.createElement('span');
    c.id = '__accChip'; c.className = 'acc-chip';
    var d = document.createElement('span'); d.className = 'acc-chip-d';
    var n = document.createElement('span'); n.className = 'acc-chip-n'; n.textContent = who;
    var b = document.createElement('button'); b.className = 'acc-chip-o'; b.type = 'button';
    b.textContent = 'Sign out';
    var left = daysLeft();
    b.title = 'Signed in as ' + who + (left != null ? ' · ' + left + ' day' + (left === 1 ? '' : 's') + ' left' : '');
    b.onclick = function () { signOut(); };
    c.appendChild(d); c.appendChild(n); c.appendChild(b);

    var theme = document.querySelector('.hdr .theme') || document.querySelector('.hdr button:last-of-type');
    if (theme && theme.parentNode) theme.parentNode.insertBefore(c, theme);
    else {                                                  // no header to sit in
      c.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9999;' +
        'background:rgba(18,15,12,.92);backdrop-filter:blur(8px);box-shadow:0 8px 26px rgba(0,0,0,.45)';
      document.body.appendChild(c);
    }
  }
  function showChip() {
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', chip, { once: true });
    else chip();
  }

  /* One line at the top of a tool page. The document is held back until we
     know, so a tool never flashes its contents on the way to asking who you
     are - and it is released again on any failure, because a gate that breaks
     must not take the page down with it. */
  function protect(opts) {
    opts = opts || {};
    var root = document.documentElement;
    if (opts.owner ? isOwner() : signedIn()) { showChip(); return; }
    root.style.visibility = 'hidden';
    var open = function () {
      root.style.visibility = '';
      try { guard(opts); } catch (e) { /* never leave the page invisible */ }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', open, { once: true });
    else open();
    setTimeout(function () { if (root.style.visibility === 'hidden') root.style.visibility = ''; }, 4000);
  }

  /* Everything that used to key off the passphrase keys off the account now.
     Set before anything else reads it: this file loads ahead of every page's
     own script, and window.IS_OWNER is read all over the tools. */
  function applyOwner() {
    var on = isOwner();
    window.IS_OWNER = on;
    var run = function () { document.documentElement.classList.toggle('owner', on); };
    if (document.documentElement) run(); else addEventListener('DOMContentLoaded', run);
    return on;
  }

  window.Access = {
    signedIn: signedIn, currentUser: currentUser, currentEmail: currentEmail,
    daysLeft: daysLeft, isOwner: isOwner,
    signIn: signIn, signUp: signUp, signOut: signOut, guard: guard, protect: protect,
    rename: rename, refresh: refresh,
    canSignUp: remote, applyOwner: applyOwner, chip: showChip,
    makeUserLine: makeUserLine, CSS: CSS, gateMarkup: gateMarkup, wire: wire,
    days: DAYS, userCount: USERS.length
  };

  applyOwner();
  handleHash();

  /* The Supabase client is an ES module fetched from a CDN, and the first call
     that needs it waits for that fetch - measured at 8.6s on a cold page, all
     of it after the button was pressed. Pulling it in now means it arrives
     while the password is still being typed. */
  try { if (remote()) window.DB.client(); } catch (e) {}
})();
