/* bom.test.js - the engine against a BOM that was built by hand.

     node tools/bom/bom.test.js
     node tools/bom/bom.test.js MU5051      one site, side by side
     node tools/bom/bom.test.js --fit       every material, how often it agrees

   The July Target sheet holds 33 sites someone costed by hand. 32 of them are
   also in the design batch. So the test is the honest one: feed the design
   through the engine and see whether it reaches the same numbers a person did.

   Perfect agreement is not the goal and would be suspicious - a few materials
   are decided on site, not on paper. What matters is that the ones the design
   actually determines (radios, antennas, BBU, and anything that scales with
   sectors or RRUs) come out exact. */

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const find = names => names.map(n => path.join(REPO, '.work', n)).find(p => fs.existsSync(p));
const BOM_BOOK    = find(['bom.xlsx', 'BOM.xlsx']);
const DESIGN_BOOK = find(['design.xlsx']);

function loadSheetJS(){
  const flag = process.argv.indexOf('--sheetjs');
  const guesses = [
    flag > -1 ? process.argv[flag + 1] : null,
    process.env.SHEETJS,
    path.join(HERE, 'xlsx.js'),
    'C:/Users/SITHUW~1/AppData/Local/Temp/claude/E--My-Jobs-Done-Sithuwaaa-Fresh-Start-My-WEB-Works/24e0a88a-2270-4499-8abc-3037c85d90df/scratchpad/xlsx.js'
  ].filter(Boolean);
  for (const g of guesses){
    if (!fs.existsSync(g)) continue;
    const mod = { exports: {} };
    new Function('module','exports','require','global', fs.readFileSync(g, 'utf8'))(mod, mod.exports, require, globalThis);
    if (typeof mod.exports.read === 'function') return mod.exports;
  }
  try { return require('xlsx'); } catch(e){}
  throw new Error('SheetJS not found. Pass --sheetjs <path to xlsx.full.min.js>.');
}

/* Neither workbook is in the repository - everything here is served, and
   neither a Dialog design sheet nor a costed BOM is something to publish.
   Not having them means the tests could not run: not a pass, not a failure. */
if (!BOM_BOOK || !DESIGN_BOOK){
  console.log('\nThe tests did not run: missing a workbook.\n');
  if (!DESIGN_BOOK) console.log('  put the design sheet at   .work/design.xlsx');
  if (!BOM_BOOK)    console.log('  put the reference BOM at  .work/bom.xlsx');
  console.log('');
  process.exit(2);
}

const XLSX = loadSheetJS();
const Design = require('../design-extractor/parser.js');
const B = require('./bom.js');

/* -------------------------------------------------- the hand-built BOM */
const wb = XLSX.read(fs.readFileSync(BOM_BOOK), { type: 'buffer' });
const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
const C = (r, c) => String((grid[r] || [])[c] || '').trim();
const width = Math.max.apply(null, grid.map(r => r.length));

const hand = { sites: [], mats: [] };
for (let c = 0; c < width; c++){
  const id = C(0, c);
  if (/^[A-Z]{2}\d{3,5}$/i.test(id)) hand.sites.push({ c, id: id.toUpperCase() });
}
let cat = '';
for (let r = 9; r < grid.length; r++){
  const c0 = C(r, 0), n = C(r, 1);
  if (c0) cat = c0;
  if (n) hand.mats.push({ cat, name: n, r });
}
const handQty = (m, s) => { const v = C(m.r, s.c); const n = parseFloat(v); return v === '' || isNaN(n) ? 0 : n; };

/* -------------------------------------------------- the design, through the engine */
const design = Design.extract(XLSX.read(fs.readFileSync(DESIGN_BOOK), { type: 'buffer' }), XLSX).sites;
const clean = s => String(s).replace(/\.$/, '').toUpperCase().trim();
const byId = {}; design.forEach(s => byId[clean(s.siteId)] = s);

const pairs = hand.sites.map(h => ({ h, d: byId[h.id] })).filter(p => p.d);
const catalogue = B.freshCatalogue();
const grew = B.growCatalogue(catalogue, design);
const built = {};
pairs.forEach(p => built[p.h.id] = B.buildSite(p.d, catalogue, {}));

let pass = 0, fail = 0;
function is(label, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(48) +
    (typeof got === 'object' ? JSON.stringify(got) : String(got)) +
    (ok ? '' : '   want ' + (typeof want === 'object' ? JSON.stringify(want) : String(want))));
}
const qtyOf = (b, name) => { const l = b.lines.find(x => B.key(x.name) === B.key(name)); return l ? l.qty : 0; };

/* ------------------------------------------------------------- one site */
const one = process.argv.slice(2).find(a => /^[A-Z]{2}\d{3,5}$/i.test(a));
if (one){
  const id = one.toUpperCase(), h = hand.sites.find(s => s.id === id), b = built[id];
  if (!b){ console.log('No such site in both books: ' + id); process.exit(1); }
  console.log('\n' + id + '  ' + b.site.name + '   ' + b.site.vendor + '  ' + b.site.ht + 'm  ' +
              b.site.tx + '  ' + b.site.band + '   ' + b.site.sec + ' sectors, ' + b.site.rru + ' RRUs\n');
  console.log('material'.padEnd(46) + 'built  hand');
  const seen = {};
  b.lines.forEach(l => { seen[B.key(l.name)] = 1;
    const m = hand.mats.find(x => B.key(x.name) === B.key(l.name));
    const hq = m && h ? handQty(m, h) : 0;
    console.log('  ' + l.name.slice(0, 42).padEnd(44) + String(l.qty).padStart(5) + String(hq).padStart(6) +
                (hq === l.qty ? '' : '   <--'));
  });
  hand.mats.forEach(m => { if (seen[B.key(m.name)]) return;
    const hq = handQty(m, h); if (hq) console.log('  ' + m.name.slice(0, 42).padEnd(44) + '    -' + String(hq).padStart(6) + '   <-- missed'); });
  process.exit(0);
}

/* --------------------------------------------------- material by material

   The fair question is not "does every cell match". The July Target sheet is a
   delivery list, so a site that already had its jumpers sits at zero even
   though the site plainly needs them - eight sites are like that. Counting
   those as errors would be measuring the wrong thing.

   So the number that matters is: where the hand sheet ordered a material and
   the engine also ordered it, do they agree on how many. Coverage is reported
   beside it, separately and honestly. */
const fit = hand.mats.map(m => {
  let agree = 0, near = 0, differ = 0, handOnly = 0, oursOnly = 0, handHas = 0;
  pairs.forEach(p => {
    const hq = handQty(m, p.h), bq = qtyOf(built[p.h.id], m.name);
    if (hq) handHas++;
    if (hq && bq){
      if (hq === bq) agree++;
      else if (Math.abs(hq - bq) / Math.max(hq, bq) <= 0.15) near++;
      else differ++;
    }
    else if (hq && !bq) handOnly++;
    else if (!hq && bq) oursOnly++;
  });
  const both = agree + near + differ;
  return { m, agree, near, differ, handOnly, oursOnly, handHas, both,
           pct: both ? Math.round(agree / both * 100) : null };
}).filter(f => f.handHas);

if (process.argv.includes('--fit')){
  console.log('\nwhere both order it: do the numbers agree?\n');
  console.log('material'.padEnd(46) + 'agree  close  differ  |  hand only  ours only');
  fit.slice().sort((a, b) => (a.pct == null ? 999 : a.pct) - (b.pct == null ? 999 : b.pct)).forEach(f =>
    console.log('  ' + f.m.name.slice(0, 42).padEnd(44) + String(f.agree).padStart(4) +
      String(f.near).padStart(7) + String(f.differ).padStart(7) + '   |' +
      String(f.handOnly).padStart(9) + String(f.oursOnly).padStart(11) +
      (f.pct == null ? '' : '    ' + f.pct + '%')));
  process.exit(0);
}

console.log('\n' + path.basename(BOM_BOOK) + ' · ' + hand.sites.length + ' hand-built sites, ' +
            hand.mats.length + ' materials');
console.log(path.basename(DESIGN_BOOK) + ' · ' + design.length + ' designed sites');
console.log(pairs.length + ' sites are in both. ' + grew.length + ' models the reference did not know were added.\n');

/* ---- the two sites with independently known answers ---- */
console.log('MU5051 - 3 sectors, 5 RRUs, 20m, Huawei, MW-HYB 18G');
{
  const b = built['MU5051'];
  is('RRU5910 (GL900)',                  qtyOf(b, 'RRU5910 (GL900)'), 2);
  is('RRU 5909(L21)',                    qtyOf(b, 'RRU 5909(L21)'), 3);
  is('the antenna, from the design',     qtyOf(b, 'SXPWL4WH-16/18-65/65-IVT-R1_10P'), 3);
  is('Huawei BBU3910',                   qtyOf(b, 'Huawei BBU3910 with UPEU, FAN Card & Power Cable'), 1);
  is('UMPTg2',                           qtyOf(b, 'UMPTg2'), 1);
  is('UBBPg1a',                          qtyOf(b, 'UBBPg1a'), 1);
  is('10G SFP is two a radio',           qtyOf(b, '10G SFP'), 10);
  is('32-22 converters, six a sector',   qtyOf(b, '32-22 Converter Connectors'), 18);
  is('18G ODU high, because MW-HYB 18G', qtyOf(b, '18G-H (Huawei)'), 1);
  is('no 23G ODU',                       qtyOf(b, '23G-H (Huawei)'), 0);
  is('no Wi-Bas anything',               qtyOf(b, 'Wi-Bas POE'), 0);
  is('Ericsson alarm cable stays out',   qtyOf(b, 'Alarm Cable (For Ericsson Sites)'), 0);
}

console.log('\nKI5032 - 4 sectors, 6 RRUs');
{
  const b = built['KI5032'];
  is('sectors',                        b.site.sec, 4);
  is('RRUs',                           b.site.rru, 6);
  is('10G SFP follows the RRUs',       qtyOf(b, '10G SFP'), 12);
  is('jumpers follow the sectors',     qtyOf(b, '22-32 (3m)'), 8);
  is('32-22 converters',               qtyOf(b, '32-22 Converter Connectors'), 24);
  is('LP RRU bracket',                 qtyOf(b, 'LP RRU Bracket'), 2);
}

console.log('\nthe radios and antennas come from the design, never from a rule');
{
  let wrong = [];
  pairs.forEach(p => {
    const b = built[p.h.id];
    Object.entries(p.d.rruByModel || {}).forEach(([model, n]) => {
      const it = catalogue.find(x => x.from === 'design' && x.ref.kind === 'rru' && B.key(x.ref.model) === B.key(model));
      if (!it) { wrong.push(p.h.id + ' ' + model + ' has no line'); return; }
      if (qtyOf(b, it.name) !== n) wrong.push(p.h.id + ' ' + model + ' ' + qtyOf(b, it.name) + ' != ' + n);
    });
    const antTotal = b.lines.filter(l => l.cat === 'GSM Antenna').reduce((a, l) => a + l.qty, 0);
    if (antTotal !== p.d.antennaCount) wrong.push(p.h.id + ' antennas ' + antTotal + ' != ' + p.d.antennaCount);
  });
  is('every radio and antenna carried through exactly', wrong.slice(0, 3), []);

  /* The hand sheet writes one antenna model per site. The design is finer than
     that - BD5071 and HA5039 carry a different antenna on sector three - so
     the comparison that means anything is the count, not the model split. */
  let antOff = [];
  pairs.forEach(p => {
    const b = built[p.h.id];
    const ours = b.lines.filter(l => l.cat === 'GSM Antenna').reduce((a, l) => a + l.qty, 0);
    const theirs = hand.mats.filter(m => m.cat === 'GSM Antenna')
      .reduce((a, m) => a + handQty(m, p.h), 0);
    if (theirs && ours !== theirs) antOff.push(p.h.id + ' ' + ours + ' != ' + theirs);
  });
  is('antenna counts match the hand sheet site for site', antOff, []);

  const all = B.build(design, catalogue, {});
  let dropped = [];
  design.forEach((s, i) => {
    const t = all[i].lines.filter(l => l.cat === 'RRU with Bracket').reduce((a, l) => a + l.qty, 0);
    if (t !== s.rruCount) dropped.push(s.siteId + ' ' + t + ' != ' + s.rruCount);
  });
  is('and across all ' + design.length + ' designed sites', dropped.slice(0, 3), []);
}

console.log('\nthe rules, against what a person wrote');
{
  /* Only over the sites the design actually describes. Where the design leaves
     the Tx plan blank the tool asks rather than guesses, so holding it to a
     number a person filled in from somewhere else would be measuring nothing. */
  const known = pairs.filter(p => !B.factsOf(p.d).gaps.length);
  const of = n => {
    const m = hand.mats.find(x => B.key(x.name) === B.key(n));
    let agree = 0, both = 0;
    if (m) known.forEach(p => {
      const hq = handQty(m, p.h), bq = qtyOf(built[p.h.id], n);
      if (hq && bq){ both++; if (hq === bq) agree++; }
    });
    return { agree, both };
  };
  const exact = n => { const f = of(n); is(n, f.agree + '/' + f.both, f.both + '/' + f.both); };
  console.log('  (over the ' + known.length + ' of ' + pairs.length +
              ' sites the design describes in full)');
  exact('10G SFP');
  exact('32-22 Converter Connectors');
  exact('1.25G TX SFP');
  exact('IF Cable');
  exact('Surge Arestor (MW)');
  exact('IF Connectors');
  exact('MW Bracket for Lamp Pole');
  exact('MW Bracket (HUB)');
  exact('Enclouser');
  exact('DCDU 12B');
  exact('M6 Cage Nut and Screw');
  exact('LP RRU Bracket');
  exact('Alarm Cable (For Ericsson Sites)');
  exact('Ethernet Convertor');
  exact('Clamp');
  exact('Huawei BBU3910 with UPEU, FAN Card & Power Cable');
  exact('UMPTg2');
  exact('UBBPg1a');
  exact('BB6631 with Power Cables');
  exact('RRU5910 (GL900)');
  exact('RRU 5909(L21)');
  exact('Radio 2271 (GL900)');
  exact('RRU 4490 B1+B3 (L1800 + L2100)');
}

console.log('\nwhere the design says nothing, the tool says so rather than guessing');
{
  const quiet = pairs.filter(p => B.factsOf(p.d).gaps.includes('Tx plan'));
  is('sites whose Tx plan the design leaves blank', quiet.length > 0, true);
  const p = quiet[0];
  is('and each is flagged, not silently costed', B.factsOf(p.d).gaps.includes('Tx plan'), true);
  is('nothing MW is ordered for it', B.buildSite(p.d, catalogue, {}).lines
     .some(l => l.name === 'IF Cable'), false);
  /* correct the Tx plan by hand and the MW materials appear */
  const fixed = B.buildSite(p.d, catalogue, { [p.h.id]: { facts:{ tx:'MW-HYB', band:'18G' } } });
  is('correct it and the MW materials arrive', fixed.lines.find(l => l.name === 'IF Cable').qty, 80);
  is('including the right ODU band', fixed.lines.some(l => l.name === '18G-H (Ericsson)' || l.name === '18G-H (Huawei)'), true);
}

console.log('\nwhat the design writes twice is ordered once');
{
  /* On an Ericsson site BB6631 is both the BBU addition and the baseband card
     - one box, written in two columns. */
  const eri = design.find(s => (s.bbuAddition || []).includes('BB6631') &&
                               (s.basebandCards || []).includes('BB6631'));
  is('a site that writes BB6631 in both columns exists', !!eri, true);
  const lines = B.buildSite(eri, catalogue, {}).lines.filter(l => /BB6631/i.test(l.name));
  is('it appears on one line', lines.length, 1);
  is('and is ordered once', lines[0] && lines[0].qty, 1);

  is('no line is a note about the work',
     catalogue.filter(c => /removal|project/i.test(c.name)).map(c => c.name), []);

  /* "2*UBBPg2" is two cards, not a card with a funny name */
  const two = design.find(s => (s.basebandCards || []).some(c => /^\s*2\s*[*x]/i.test(c)));
  if (two){
    const l = B.buildSite(two, catalogue, {}).lines.find(x => B.key(x.name) === B.key('UBBPg2'));
    is('a doubled card is read as two', l && l.qty, 2);
  } else is('a doubled card is read as two', 'none in this batch', 'none in this batch');

  const names = catalogue.map(c => B.key(c.name));
  is('no material is listed twice', names.length - new Set(names).size, 0);
}

console.log('\nthe engine itself');
{
  is('a formula with a stray name is refused',
     (() => { try { B.compile('sec * fetch(1)'); return 'allowed'; } catch(e){ return 'refused'; } })(), 'refused');
  is('sec, rru, ant, ht all resolve', B.compile('sec+rru+ant+ht')(1, 2, 3, 4), 10);
  is('ceil is available', B.compile('ceil(rru/2)')(0, 5, 0, 0), 3);
  is('a rule with off never fires', B.ruleFires({ off:true }, { vendor:'Huawei' }), false);
  is('an empty when always fires', B.ruleFires({}, { vendor:'Huawei' }), true);
  const ov = { MU5051: { qty: { [B.key('Clamp')]: 44 } } };
  is('a hand-typed quantity wins', B.buildSite(byId['MU5051'], catalogue, ov).lines
     .find(l => l.name === 'Clamp').qty, 44);
  is('and is marked as yours', B.buildSite(byId['MU5051'], catalogue, ov).lines
     .find(l => l.name === 'Clamp').why, 'yours');
  const zero = { MU5051: { qty: { [B.key('Clamp')]: 0 } } };
  is('a typed zero takes the line off that site only',
     B.buildSite(byId['MU5051'], catalogue, zero).lines.some(l => l.name === 'Clamp'), false);
  is('and leaves every other site alone',
     B.buildSite(byId['KI5032'], catalogue, zero).lines.some(l => l.name === 'Clamp'), true);
  const m = B.toMatrix([built['MU5051'], built['KI5032']], catalogue);
  is('the matrix keeps the sheet\'s shape', m[0].slice(0, 5), ['', '', '', 'Site ID', 'MU5051']);
  is('and carries a sum column', m[6][3], 'Sum');
}

/* ---------------------------------------------------- what came out */
const sums = { agree: 0, near: 0, differ: 0, handOnly: 0, oursOnly: 0 };
fit.forEach(f => { sums.agree += f.agree; sums.near += f.near; sums.differ += f.differ;
                   sums.handOnly += f.handOnly; sums.oursOnly += f.oursOnly; });
const both = sums.agree + sums.near + sums.differ;
const solid = fit.filter(f => f.pct === 100).length;

console.log('\nagainst the hand-built sheet, ' + fit.length + ' materials over ' + pairs.length + ' sites');
console.log('  ' + solid + ' materials agree on every site where both order them');
console.log('  ' + sums.agree + ' quantities identical, ' + sums.near + ' within 15%, ' + sums.differ +
            ' genuinely apart   (' + Math.round(sums.agree / both * 100) + '%)');
console.log('  ' + sums.handOnly + ' the sheet ordered and the rules did not, ' +
                   sums.oursOnly + ' the other way');
console.log('  material by material:  node tools/bom/bom.test.js --fit');

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
