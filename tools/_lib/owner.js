/* Soft owner-mode gate.
   NOTE: this is a convenience lock, not real security. A static site can't
   enforce authentication — a determined person can bypass any client-side
   check. The only hard boundary is who can commit to the GitHub repo (you),
   which is what actually protects the published/shared data. This module just
   hides edit controls from ordinary viewers and reveals them to you after you
   unlock with your passphrase. Load owner-config.js before this file. */
(function () {
  var KEY = 'emortia_owner_v1';
  var HASH = (window.OWNER_HASH || '').toLowerCase();

  function isOwner() { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
  window.IS_OWNER = isOwner();
  if (window.IS_OWNER) document.documentElement.classList.add('owner');

  async function sha256(s) {
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(buf)).map(function (x) { return x.toString(16).padStart(2, '0'); }).join('');
  }
  window.ownerLock = function () { try { localStorage.removeItem(KEY); } catch (e) {} location.hash = ''; location.reload(); };

  async function handleHash() {
    var h = (location.hash || '').toLowerCase();
    if (h === '#lock') { window.ownerLock(); return; }
    if (h === '#setpass') {
      history.replaceState(null, '', location.pathname + location.search);
      var p = prompt('Choose an owner passphrase.\n\nIt will show you a hash — paste that into tools/_lib/owner-config.js (OWNER_HASH) and commit.\nThe passphrase itself is never stored or sent.');
      if (p) { var hx = await sha256(p); window.prompt('OWNER_HASH — copy this whole line into owner-config.js:', hx); }
      return;
    }
    if (h === '#owner') {
      history.replaceState(null, '', location.pathname + location.search);
      if (!HASH) { alert('No owner passphrase is configured yet.\nOpen this page with #setpass to create one.'); return; }
      var p = prompt('Owner passphrase:');
      if (p) { var hx = await sha256(p); if (hx === HASH) { try { localStorage.setItem(KEY, '1'); } catch (e) {} location.reload(); } else { alert('Incorrect passphrase.'); } }
      return;
    }
  }
  addEventListener('hashchange', handleHash);
  handleHash();

  // small "Owner mode · Lock" chip, only visible to you
  if (window.IS_OWNER) {
    var addChip = function () {
      if (document.getElementById('__ownerChip')) return;
      var c = document.createElement('div');
      c.id = '__ownerChip';
      c.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:99999;display:flex;align-items:center;gap:9px;background:rgba(18,15,12,0.92);color:#fff;border:1px solid rgba(255,255,255,0.18);border-radius:999px;padding:6px 8px 6px 13px;font:600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;box-shadow:0 8px 26px rgba(0,0,0,0.45);backdrop-filter:blur(8px);';
      c.innerHTML = '<span style="color:#7fdc8a;">● Owner mode</span>';
      var b = document.createElement('button');
      b.textContent = 'Lock';
      b.style.cssText = 'background:none;border:1px solid rgba(255,255,255,0.28);color:#fff;border-radius:7px;padding:4px 10px;font:inherit;cursor:pointer;';
      b.onclick = window.ownerLock;
      c.appendChild(b);
      document.body.appendChild(c);
    };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', addChip); else addChip();
  }
})();
