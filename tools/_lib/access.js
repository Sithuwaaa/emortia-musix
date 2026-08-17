/* access.js — who may open the tools.

   A username and a password, checked against the salted hashes in
   access-config.js, and a session that lasts seven days.

   Nothing here is a substitute for a server. See the note at the bottom of
   access-config.js: the tool pages and their data.json files are served
   publicly, so this is a gate on the door of a room with open windows. It is
   worth having — it stops the tools being stumbled into — and it is worth
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
  function isOwner() { return !!window.IS_OWNER; }

  function signedIn() { return isOwner() || !!session(); }
  function currentUser() {
    var s = session();
    if (s) return s.user;
    return isOwner() ? 'owner' : null;
  }
  function daysLeft() {
    var s = session();
    if (!s) return null;
    return Math.max(0, Math.ceil((s.until - Date.now()) / (24 * 60 * 60 * 1000)));
  }

  async function signIn(user, password) {
    user = String(user || '').trim().toLowerCase();
    if (!user || !password) return { ok: false, error: 'Both a username and a password, please.' };
    if (!window.crypto || !crypto.subtle)
      return { ok: false, error: 'This browser will not do the maths over an insecure connection. Use https.' };

    var rec = USERS.filter(function (u) {
      return String(u.user || '').trim().toLowerCase() === user; })[0];

    /* Do the work even when there is no such user, so a wrong username and a
       wrong password take the same time and tell an outsider the same thing. */
    var probeSalt = rec ? rec.salt : '00000000000000000000000000000000';
    var got = await derive(password, probeSalt, rec ? rec.iter : 210000);
    if (!rec || !same(got, rec.hash)) return { ok: false, error: 'That username and password do not match.' };

    write({ user: rec.user, epoch: EPOCH, since: Date.now(), until: Date.now() + MS });
    return { ok: true, user: rec.user };
  }

  function signOut() { clear(); location.reload(); }

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
    '.acc-err{color:#e2607a;font-size:13px;margin:0 0 12px;min-height:1em;}',
    '.acc-foot{margin:16px 0 0;font-size:12px;color:#8d6a75;text-align:center;}',
    '.acc-foot a{color:#c19da8;}'
  ].join('\n');

  function gateMarkup(title, note) {
    return '<div class="acc-card" role="dialog" aria-label="Sign in">' +
      '<div class="acc-logo"><i style="height:8px"></i><i style="height:14px"></i><i style="height:10px"></i><i style="height:15px"></i></div>' +
      '<h1>' + title + '</h1>' +
      '<p>' + note + '</p>' +
      '<form id="accForm" autocomplete="on">' +
        '<label for="accUser">Username</label>' +
        '<input id="accUser" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>' +
        '<label for="accPass">Password</label>' +
        '<input id="accPass" name="password" type="password" autocomplete="current-password" required>' +
        '<p class="acc-err" id="accErr"></p>' +
        '<button class="acc-go" type="submit" id="accGo">Sign in</button>' +
      '</form>' +
      '<p class="acc-foot">Signed in for ' + DAYS + ' days on this device.</p>' +
    '</div>';
  }

  /* Put the gate over a tool page and keep it there until someone signs in. */
  function guard(opts) {
    opts = opts || {};
    if (signedIn()) return true;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var g = document.createElement('div');
    g.className = 'acc-gate';
    g.innerHTML = gateMarkup(opts.title || 'Sign in', opts.note || (USERS.length === 0
      ? 'No accounts exist yet. Add <code>#adduser</code> to the end of this address to make the first one.'
      : 'These tools are not public. Sign in to open them.'));
    document.body.appendChild(g);
    document.documentElement.style.overflow = 'hidden';
    wire(g, function () { location.reload(); });
    return false;
  }

  function wire(root, onDone) {
    var form = root.querySelector('#accForm'),
        err  = root.querySelector('#accErr'),
        go   = root.querySelector('#accGo');
    setTimeout(function () { var u = root.querySelector('#accUser'); if (u) u.focus(); }, 60);
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      err.textContent = ''; go.disabled = true; go.textContent = 'Checking…';
      var r = await signIn(root.querySelector('#accUser').value, root.querySelector('#accPass').value);
      if (r.ok) { onDone(); return; }
      go.disabled = false; go.textContent = 'Sign in';
      err.textContent = r.error;
      root.querySelector('#accPass').value = '';
      root.querySelector('#accPass').focus();
    });
  }

  /* One line at the top of a tool page. The document is held back until we
     know, so a tool never flashes its contents on the way to asking who you
     are — and it is released again on any failure, because a gate that breaks
     must not take the page down with it. */
  function protect(opts) {
    var root = document.documentElement;
    if (signedIn()) return;
    root.style.visibility = 'hidden';
    var open = function () {
      root.style.visibility = '';
      try { guard(opts); } catch (e) { /* never leave the page invisible */ }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', open, { once: true });
    else open();
    setTimeout(function () { if (root.style.visibility === 'hidden') root.style.visibility = ''; }, 4000);
  }

  window.Access = {
    signedIn: signedIn, currentUser: currentUser, daysLeft: daysLeft,
    signIn: signIn, signOut: signOut, guard: guard, protect: protect,
    makeUserLine: makeUserLine, CSS: CSS, gateMarkup: gateMarkup, wire: wire,
    days: DAYS, userCount: USERS.length
  };

  handleHash();
})();
