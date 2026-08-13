/* Tests for the design sheet parser.
   Run:  node tools/design-extractor/parser.test.js

   The two sites asserted here appear in both the design workbook and the BOM
   database, so their expected values are not guesses — they are what the BOM
   already says. If a rule change breaks these, the rule is wrong. */
const fs = require('fs');
const path = require('path');
const XLSX = require(path.join(__dirname, '../../.tools/xlsx.js'));
const P = require('./parser.js');

const BOOK = path.join(__dirname, '../../samples/2026_MBB_New_Sites_Design__9_.xlsx');

let pass = 0, fail = 0;
const results = [];
/* Sort object keys before comparing: {RRU5909:3, RRU5910:2} and
   {RRU5910:2, RRU5909:3} are the same answer, and a rollup has no natural
   key order to preserve. */
function stable(v){
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object')
    return Object.keys(v).sort().reduce((o, k) => (o[k] = stable(v[k]), o), {});
  return v;
}
function check(name, got, want){
  const g = JSON.stringify(stable(got)), w = JSON.stringify(stable(want));
  const ok = g === w;
  ok ? pass++ : fail++;
  results.push({ ok, name, got: g, want: w });
}
function note(name, got){ results.push({ ok: null, name, got: JSON.stringify(got) }); }

const wb = XLSX.read(fs.readFileSync(BOOK), { type: 'buffer' });
const { ctx, sites } = P.extract(wb, XLSX);
const by = id => sites.find(s => String(s.siteId).toUpperCase() === id);

/* ---------- the sheet itself ---------- */
check('sheet picked',            ctx.sheetName, 'Design Sheet');
check('header row (1-based)',    ctx.headerRow, 4);
check('site rows',               sites.length, 245);

/* ---------- MU5051, cross-checked against the BOM ---------- */
const mu = by('MU5051');
check('MU5051 found',            !!mu, true);
check('MU5051 sectors',          mu.sectorCount, 3);
check('MU5051 RRUs',             mu.rruCount, 5);
check('MU5051 RRU by model',     mu.rruByModel, { RRU5909: 3, RRU5910: 2 });
check('MU5051 antennas',         mu.antennaCount, 3);
check('MU5051 antenna model',    Object.keys(mu.antennaByModel), ['SXPWL4WH-16/18-65/65-IVT-R1_10P']);

/* ---------- KI5032 ---------- */
const ki = by('KI5032');
check('KI5032 found',            !!ki, true);
check('KI5032 sectors',          ki.sectorCount, 4);
check('KI5032 RRUs',             ki.rruCount, 6);

/* ---------- VA5038, checked line by line against the engineer's own reading ----------
   This is the site that exercises the shared-radio rule: sector 3 reuses
   sector 2's GL900 unit, so six radios are planned and six are counted, not
   seven. MU5051 and KI5032 never touch that path. */
const va = by('VA5038');
check('VA5038 found',            !!va, true);
check('VA5038 name',             va.siteName, 'Collage_Rd_Lamp');
check('VA5038 height',           va.siteHeight, 25);
check('VA5038 tx mode',          va.txMode, 'OFN');
check('VA5038 sectors',          va.sectorCount, 3);
check('VA5038 RRUs',             va.rruCount, 6);
check('VA5038 antennas',         va.antennaCount, 3);
check('VA5038 antenna is the 10P',
      /10P$/.test(Object.keys(va.antennaByModel)[0] || ''), true);

const vs = P.summarise(va);
const role = l => vs.radios.find(r => r.label === l);
check('VA5038 L21 ×3 across sectors 1-3',
      role('L21') && [role('L21').count, role('L21').sectors], [3, [1, 2, 3]]);
check('VA5038 L18 ×1 in sector 1',
      role('L18') && [role('L18').count, role('L18').sectors], [1, [1]]);
check('VA5038 GL900 ×2 in sectors 1-2',
      role('GL900') && [role('GL900').count, role('GL900').sectors], [2, [1, 2]]);
check('VA5038 sector 3 shares a GL900 rather than adding one',
      vs.shared.map(s => s.sectors), [[3]]);
check('VA5038 roles account for every counted radio',
      vs.radios.reduce((n, r) => n + r.count, 0), va.rruCount);

/* ---------- the rules that make those numbers ---------- */
// a multi-band unit must not be counted once per band
const muSec1 = mu.sectors.find(s => s.sector === 1);
check('MU5051 sec1 radio cells > distinct models',
      muSec1.radios.length > muSec1.rruModels.length, true);

// shared radios are set aside, not counted
const shared = sites.filter(s => Object.keys(s.sharedRruRefs).length);
check('shared radios are excluded from the count',
      shared.every(s => s.rruCount === Object.values(s.rruByModel).reduce((a, b) => a + b, 0)), true);
note('sites carrying a shared-radio reference', shared.length);

// the sheet's own summary columns are stale, and we say so rather than trust them
note('MU5051 flags', mu.flags);
note('KI5032 flags', ki.flags);

/* ---------- the shape the BOM Builder will read ---------- */
const env = P.envelope(sites, ctx);
check('envelope schema',         env.schema, 'emortia.design-extract/1');
check('envelope source',         env.source, { sheet: 'Design Sheet', headerRow: 4 });

/* ---------- what the whole book looks like ---------- */
const spread = {};
sites.forEach(s => { spread[s.sectorCount] = (spread[s.sectorCount] || 0) + 1; });
note('sector spread (sectors: sites)', spread);
note('sites with no TX row', sites.filter(s => !s.txMode).length);
note('sites with at least one flag', sites.filter(s => s.flags.length).length);
note('distinct RRU models seen',
     [...new Set(sites.flatMap(s => Object.keys(s.rruByModel)))].sort());

/* ---------- report ---------- */
const W = 46;
console.log('');
for (const r of results){
  if (r.ok === null){ console.log('  ·    ' + r.name.padEnd(W) + r.got); continue; }
  console.log((r.ok ? '  ok   ' : '  FAIL ') + r.name.padEnd(W) +
              (r.ok ? r.got : r.got + '   expected ' + r.want));
}
console.log('\n  ' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
