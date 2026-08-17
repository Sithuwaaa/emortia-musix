/* owner.js — kept only so the pages that load it keep loading.

   Owner mode used to be a passphrase typed after #owner in the address bar.
   It is an account now: sign in as one of the names in ACCESS_OWNERS and
   access.js sets window.IS_OWNER and puts the `owner` class on the document,
   which is what the rest of the site and the tools have always read.

   The floating chip is gone too. Its two buttons live on the Owner tab of the
   site, where they can be found rather than remembered.

   Nothing else should be added here. New work belongs in access.js. */
(function () {
  'use strict';

  /* access.js sets the real value a moment later; this only stops anything
     that reads the flag between the two files from seeing `undefined`. */
  if (typeof window.IS_OWNER === 'undefined') window.IS_OWNER = false;

  /* Old passphrase sessions are not owner sessions any more. Clearing the key
     means nobody keeps owner mode from before this change without signing in. */
  try { localStorage.removeItem('emortia_owner_v1'); } catch (e) {}

  /* Kept because index.html and the tools call it. */
  window.ownerLock = function () {
    if (window.Access && window.Access.signOut) return window.Access.signOut();
    location.reload();
  };
})();
