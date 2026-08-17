/* esn.js — the parts of the ESN tool that are worth testing on their own.

   No DOM beyond the image work, which needs a canvas and says so. Everything
   else is data in, data out: what a record has to have before it can be filed,
   how a site ID finds its name, and what the export looks like. */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.EsnCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Card types seen so far. The list is a starting point, never a constraint —
     the field is free text, because every batch brings a card nobody wrote
     down in advance. */
  const CARD_TYPES = [
    'UMPTg2', 'UMPTb1', 'UMPTe1', 'UMPTe2',
    'UBBPg1a', 'UBBPg2', 'UBBPd2', 'UBBPd4', 'UBBPe4', 'UBBPe6',
    'BBU3910', 'BBU5900', 'BB6630', 'BB6631',
    'RRU5909', 'RRU5910', 'Radio 2271', 'Radio 4415',
    'UPEU', 'FAN', 'DCDU', 'SFP'
  ];

  const norm = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  const upper = v => norm(v).toUpperCase();

  /* Site IDs come off a screen or a phone: lower case, a stray full stop, a
     space in the middle. All of those are the same site. */
  const siteKey = v => upper(v).replace(/[^A-Z0-9]/g, '');

  /* ------------------------------------------------------- the site lookup

     Built once from the Site Access dataset ({cols, rows}) and asked for a
     name per keystroke, so it has to be a map rather than a scan of 5,944
     rows. "Other_Site_IDS" is included because a site is often typed by the
     name a different team knows it as. */
  function buildIndex(ds) {
    const idx = {};
    if (!ds || !ds.cols || !ds.rows) return idx;
    const at = name => ds.cols.indexOf(name);
    const cId = at('Site_ID'), cName = at('Site_Name'), cAlt = at('Other_Site_IDS');
    if (cId < 0 || cName < 0) return idx;

    const put = (k, r, force) => {
      const key = siteKey(k);
      if (!key) return;
      if (!force && key in idx) return;
      idx[key] = { id: norm(r[cId]), name: norm(r[cName]) };
    };

    /* Two passes, and the order matters. Real site IDs go down first, then the
       aliases fill the gaps around them — because 14 sites in this list have
       their own ID sitting in another site's "Other_Site_IDS", and a single
       pass let whoever came first win. A site that cannot find its own name is
       the one failure this field must not have. */
    ds.rows.forEach(r => { if (norm(r[cName])) put(r[cId], r, true); });
    if (cAlt > -1) ds.rows.forEach(r => {
      if (!norm(r[cName])) return;
      norm(r[cAlt]).split(/[,;/|]+/).forEach(k => put(k, r, false));
    });
    return idx;
  }
  function findSite(idx, id) {
    const k = siteKey(id);
    return k && idx[k] ? idx[k] : null;
  }

  /* ------------------------------------------------------------ a record */

  function blank() {
    return {
      id: null, siteId: '', siteName: '', runOm: false,
      esnPhoto: null, esnFull: null, omIpPhoto: null,
      cards: [{ type: '', serial: '' }],
      note: '', savedAt: null
    };
  }

  const liveCards = rec => (rec.cards || []).filter(c => norm(c.serial) || norm(c.type));

  /* What has to be there before it can be filed. The O&M screenshot is only
     asked for when the box is ticked — that is the whole point of the box. */
  function check(rec) {
    const missing = [];
    if (!norm(rec.siteId)) missing.push('a site ID');
    if (!rec.esnPhoto)     missing.push('the ESN photo');
    if (!rec.esnFull)      missing.push('the full screenshot');
    if (rec.runOm && !rec.omIpPhoto) missing.push('the O&M IP screenshot');
    if (!liveCards(rec).length) missing.push('at least one serial number');
    const bad = liveCards(rec).filter(c => !norm(c.serial));
    if (bad.length) missing.push('a serial for every card listed');
    return { ok: missing.length === 0, missing };
  }

  /* Reads as a sentence rather than a list of field names. */
  function why(missing) {
    if (!missing.length) return '';
    if (missing.length === 1) return 'Still needs ' + missing[0] + '.';
    return 'Still needs ' + missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1] + '.';
  }

  /* --------------------------------------------------------- the pictures

     Screenshots are mostly text — an ESN, an IP address — so they are resized
     rather than squeezed, and encoded as WebP, which holds letters together at
     a size JPEG cannot match. A very small image is left exactly as it came. */
  const MAX_EDGE = 2000, KEEP_UNDER = 220 * 1024;

  function shrink(file, opts) {
    opts = opts || {};
    const maxEdge = opts.maxEdge || MAX_EDGE;
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No image.'));
      if (!/^image\//.test(file.type)) return reject(new Error('That is not an image.'));
      if (file.size <= (opts.keepUnder || KEEP_UNDER))
        return resolve({ blob: file, ext: extOf(file.type), w: null, h: null, from: file.size, to: file.size });

      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const cx = cv.getContext('2d');
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(img, 0, 0, w, h);
        const done = (blob, ext) => blob
          ? resolve({ blob, ext, w, h, from: file.size, to: blob.size })
          : reject(new Error('The browser would not encode that image.'));
        cv.toBlob(b => {
          if (b && b.type === 'image/webp') return done(b, 'webp');
          cv.toBlob(b2 => done(b2, 'jpg'), 'image/jpeg', 0.92);   // older Safari
        }, 'image/webp', 0.92);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image would not open.')); };
      img.src = url;
    });
  }
  function extOf(type) {
    if (/webp/.test(type)) return 'webp';
    if (/png/.test(type))  return 'png';
    return 'jpg';
  }

  /* An image can arrive from the picker, from a drag, or — the way a print
     screen actually travels — from a paste. */
  function imageFrom(evt) {
    const d = evt.clipboardData || evt.dataTransfer;
    if (!d) return null;
    const items = d.items ? [].slice.call(d.items) : [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
        const f = items[i].getAsFile();
        if (f) return f;
      }
    }
    const files = d.files ? [].slice.call(d.files) : [];
    return files.filter(f => /^image\//.test(f.type))[0] || null;
  }

  /* ------------------------------------------------------------- the export

     One row a card, because that is what a serial list is for; the site
     details repeat down the rows so the sheet can be filtered and sorted
     without anything being looked up again. */
  const COLS = ['Site ID', 'Site Name', 'Card Type', 'Serial No', 'Run O&M Script',
                'ESN Photo', 'Full Screenshot', 'O&M IP Screenshot',
                'Note', 'Filed By', 'Filed At'];

  function toRows(records, links) {
    links = links || {};
    const out = [];
    (records || []).forEach(r => {
      const cards = liveCards(r);
      const base = [
        r.siteId || r.site_id || '',
        r.siteName || r.site_name || '',
      ];
      const tail = [
        (r.runOm != null ? r.runOm : r.run_om) ? 'Yes' : 'No',
        links[r.esnPhoto || r.esn_photo] || (r.esnPhoto || r.esn_photo || ''),
        links[r.esnFull || r.esn_full] || (r.esnFull || r.esn_full || ''),
        links[r.omIpPhoto || r.om_ip_photo] || (r.omIpPhoto || r.om_ip_photo || ''),
        r.note || '',
        r.createdEmail || r.created_email || '',
        (r.createdAt || r.created_at || '').replace('T', ' ').slice(0, 19)
      ];
      if (!cards.length) out.push(base.concat(['', '']).concat(tail));
      else cards.forEach(c => out.push(base.concat([norm(c.type), norm(c.serial)]).concat(tail)));
    });
    return out;
  }

  /* what the tool holds on to between sessions, and what comes back */
  function fromRow(row) {
    return {
      id: row.id, siteId: row.site_id, siteName: row.site_name || '',
      runOm: !!row.run_om,
      esnPhoto: row.esn_photo, esnFull: row.esn_full, omIpPhoto: row.om_ip_photo,
      cards: Array.isArray(row.cards) && row.cards.length ? row.cards : [{ type: '', serial: '' }],
      note: row.note || '', createdEmail: row.created_email || '',
      createdAt: row.created_at || '', savedAt: row.updated_at || row.created_at || ''
    };
  }

  return {
    CARD_TYPES, COLS,
    norm, upper, siteKey,
    buildIndex, findSite,
    blank, liveCards, check, why,
    shrink, imageFrom, extOf,
    toRows, fromRow
  };
});
