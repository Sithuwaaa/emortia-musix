/* esn.test.js — the ESN tool's logic, against the real site list.

     node tools/esn/esn.test.js

   The image work needs a canvas and is left to the browser; everything here
   runs under node, which is why it was written to. */

const fs = require('fs');
const path = require('path');
const E = require('./esn.js');

const DATA = path.resolve(__dirname, '..', 'site-access', 'data.json');

let pass = 0, fail = 0;
const show = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
function is(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(52) + show(got) + (ok ? '' : '   want ' + show(want)));
}

console.log('\nfinding a site by what someone actually types');
{
  if (!fs.existsSync(DATA)){ console.log('  no site list at ' + DATA); process.exit(2); }
  const ds = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const t0 = Date.now();
  const idx = E.buildIndex(ds);
  const built = Date.now() - t0;
  console.log('  ' + ds.rows.length + ' sites indexed in ' + built + 'ms, ' + Object.keys(idx).length + ' keys\n');

  const first = ds.rows[0];
  const id = first[ds.cols.indexOf('Site_ID')];
  const name = first[ds.cols.indexOf('Site_Name')];

  is('the plain ID',            (E.findSite(idx, id) || {}).name, name);
  is('typed in lower case',     (E.findSite(idx, String(id).toLowerCase()) || {}).name, name);
  is('with a trailing stop',    (E.findSite(idx, id + '.') || {}).name, name);
  is('with a space in it',      (E.findSite(idx, String(id).slice(0,2) + ' ' + String(id).slice(2)) || {}).name, name);
  is('padded with spaces',      (E.findSite(idx, '  ' + id + ' ') || {}).name, name);
  is('a site that is not there', E.findSite(idx, 'ZZ9999'), null);
  is('nothing typed yet',        E.findSite(idx, ''), null);

  /* Every site in the list has to be findable by its own ID, or the field
     quietly fails on the one someone needs.

     Compared after the same tidying the index does. The source has names with
     double spaces in them — "Randeniya  Relocation" — and the index collapses
     those, which is what should be shown. Eleven sites look like failures
     until the comparison is made like for like. */
  const cId = ds.cols.indexOf('Site_ID'), cName = ds.cols.indexOf('Site_Name');
  /* A handful of IDs appear twice. Where the two rows disagree the later one
     wins, so those sites are expected not to match their earlier spelling —
     both rows are the same site, written two ways. */
  const seen = {};
  ds.rows.forEach(r => { const k = E.siteKey(r[cId]); if (k) (seen[k] = seen[k] || []).push(E.norm(r[cName])); });
  const clashes = Object.keys(seen).filter(k => new Set(seen[k].filter(Boolean)).size > 1);

  const missed = ds.rows.filter(r => {
    const nm = E.norm(r[cName]);
    if (!nm) return false;
    if (clashes.indexOf(E.siteKey(r[cId])) > -1) return false;
    const hit = E.findSite(idx, r[cId]);
    return !hit || hit.name !== nm;
  });
  is('every listed site finds its own name', missed.map(r => r[cId]), []);
  is('IDs listed twice under different names', clashes.length <= 2, true);
  if (clashes.length) console.log('        (' + clashes.join(', ') + ' — the later spelling wins)');
  is('and each of those still finds a name',
     clashes.every(k => !!E.findSite(idx, k)), true);

  const t1 = Date.now();
  for (let i = 0; i < 20000; i++) E.findSite(idx, id);
  is('20,000 lookups stay under 100ms', (Date.now() - t1) < 100, true);
}

console.log('\nwhat a record needs before it can be filed');
{
  const full = () => ({ siteId:'MU5051', siteName:'Iyankankulam_Lamp', runOm:false,
    esnPhoto:'a.webp', esnFull:'b.webp', omIpPhoto:null,
    cards:[{type:'UMPTg2', serial:'21500'}], note:'' });

  is('a complete one', E.check(full()).ok, true);

  const noSite = full(); noSite.siteId = '';
  is('no site ID', E.check(noSite).missing, ['a site ID']);

  const noPhoto = full(); noPhoto.esnPhoto = null;
  is('no ESN photo', E.check(noPhoto).missing, ['the ESN photo']);

  const noSerial = full(); noSerial.cards = [{ type:'UMPTg2', serial:'' }];
  is('a card typed with no serial', E.check(noSerial).missing, ['a serial for every card listed']);

  const noCards = full(); noCards.cards = [{ type:'', serial:'' }];
  is('no cards at all', E.check(noCards).missing, ['at least one serial number']);

  /* the tick is the whole reason the third slot exists */
  const om = full(); om.runOm = true;
  is('O&M ticked, no screenshot', E.check(om).missing, ['the O&M IP screenshot']);
  om.omIpPhoto = 'c.webp';
  is('O&M ticked, screenshot given', E.check(om).ok, true);
  const noOm = full(); noOm.runOm = false; noOm.omIpPhoto = null;
  is('O&M not ticked, none asked for', E.check(noOm).ok, true);

  is('one thing missing reads as a sentence', E.why(['a site ID']), 'Still needs a site ID.');
  is('three do too', E.why(['a site ID','the ESN photo','a serial for every card listed']),
     'Still needs a site ID, the ESN photo and a serial for every card listed.');

  is('a blank record is not filable', E.check(E.blank()).ok, false);
  is('a blank record starts with one empty card row', E.blank().cards.length, 1);
}

console.log('\nthe card list');
{
  const rec = { cards:[{type:'UMPTg2',serial:'1'},{type:'',serial:''},{type:'',serial:'9'}] };
  is('empty rows are not counted', E.liveCards(rec).length, 2);
  is('a serial with no type still counts', E.liveCards(rec)[1].serial, '9');
  is('the card list is a suggestion, not a rule', E.CARD_TYPES.length > 10, true);
}

console.log('\nthe export');
{
  const recs = [
    { site_id:'MU5051', site_name:'Iyankankulam_Lamp', run_om:true,
      esn_photo:'p/a.webp', esn_full:'p/b.webp', om_ip_photo:'p/c.webp',
      cards:[{type:'UMPTg2',serial:'2150A'},{type:'UBBPg1a',serial:'773X'}],
      note:'ok', created_email:'x@y.z', created_at:'2026-08-17T04:05:06.000Z' },
    { site_id:'KI5032', site_name:'Pallikuda_North', run_om:false,
      esn_photo:'p/d.webp', esn_full:'p/e.webp', om_ip_photo:null,
      cards:[], note:'', created_email:'x@y.z', created_at:'2026-08-17T04:06:00.000Z' }
  ].map(E.fromRow);

  const rows = E.toRows(recs);
  is('a row for each card, and one for a site with none', rows.length, 3);
  is('the site repeats down its rows', [rows[0][0], rows[1][0]], ['MU5051','MU5051']);
  is('card and serial land in their columns', [rows[0][2], rows[0][3]], ['UMPTg2','2150A']);
  is('the tick is readable', [rows[0][4], rows[2][4]], ['Yes','No']);
  is('a site with no cards still gets a row', [rows[2][0], rows[2][2], rows[2][3]], ['KI5032','','']);
  is('the time is readable', rows[0][10], '2026-08-17 04:05:06');
  is('every row is as wide as the header', [...new Set(rows.map(r => r.length))], [E.COLS.length]);

  /* the paths are private; the export carries links when it has been given
     them, and the raw path when it has not */
  const linked = E.toRows(recs, { 'p/a.webp':'https://signed/a' });
  is('a signed link is used when there is one', linked[0][5], 'https://signed/a');
  is('and the path stands in when there is not', linked[0][6], 'p/b.webp');
}

console.log('\nthe pictures are left exactly as they arrive');
{
  is('a png keeps its extension',  E.extOf('image/png'), 'png');
  is('a jpeg does too',            E.extOf('image/jpeg'), 'jpg');
  is('and a webp',                 E.extOf('image/webp'), 'webp');
  is('anything odd becomes a jpg', E.extOf('image/heic'), 'jpg');
  is('the ceiling is 50MB',        E.MAX_BYTES, 50 * 1024 * 1024);
  is('sizes read the way people say them',
     [E.sizeLabel(2048), E.sizeLabel(11 * 1048576)], ['2kB', '11.0MB']);
  is('nothing in here resizes any more', typeof E.shrink, 'undefined');
}

console.log('\ncoming back from the database');
{
  const r = E.fromRow({ id:'u1', site_id:'AM5155', site_name:'Muwangala', run_om:false,
    esn_photo:'a', esn_full:'b', om_ip_photo:null, cards:[], note:null,
    created_email:'a@b.c', created_at:'2026-01-01T00:00:00Z', updated_at:'2026-01-02T00:00:00Z' });
  is('an empty card list becomes one blank row to type into', r.cards.length, 1);
  is('a null note becomes an empty one', r.note, '');
  is('the id is kept, so saving edits rather than duplicates', r.id, 'u1');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
