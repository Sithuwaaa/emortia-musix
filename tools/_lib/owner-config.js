/* Owner-mode passphrase — SHA-256 hex of your chosen passphrase.
   Leave empty until you set one:
     1. Open the site (or any tool) with #setpass on the end of the URL.
     2. Type a passphrase; it shows you a long hash string.
     3. Paste that hash between the quotes below and commit this file.
   The passphrase itself is never stored anywhere — only its hash lives here,
   and a SHA-256 hash cannot be turned back into the passphrase. */
window.OWNER_HASH = '';
