/* parser.test.js — run the parser against the real workbook.

     node tools/design-extractor/parser.test.js
     node tools/design-extractor/parser.test.js --sheetjs <path to xlsx.full.min.js>
     node tools/design-extractor/parser.test.js MU5051      (print one site)

   The two sites asserted below are the only ones whose answers are known
   independently: they appear in both the design workbook and the July Target
   BOM, and the BOM was built by hand from the design. If the parser agrees
   with the hand-built BOM on those, the counting rule is right. */

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const BOOK = path.join(REPO, 'samples', '2026_MBB_New_Sites_Design__9_.xlsx');

/* SheetJS ships a browser bundle; give it somewhere to export to. */
function loadSheetJS(){
  const flag = process.argv.indexOf('--sheetjs');
  const guesses = [
    flag > -1 ? process.argv[flag + 1] : null,
    process.env.SHEETJS,
    path.join(process.env.TEMP || '/tmp', 'claude', 'xlsx.js'),
    path.join(HERE, 'xlsx.js'),
    'C:/Users/SITHUW~1/AppData/Local/Temp/claude/E--My-Jobs-Done-Sithuwaaa-Fresh-Start-My-WEB-Works/24e0a88a-2270-4499-8abc-3037c85d90df/scratchpad/xlsx.js'
  ].filter(Boolean);
  for (const g of guesses){
    if (!fs.existsSync(g)) continue;
    const mod = { exports: {} };
    new Function('module', 'exports', 'require', 'global', fs.readFileSync(g, 'utf8'))(mod, mod.exports, require, globalThis);
    if (typeof mod.exports.read === 'function') return mod.exports;
  }
  try { return require('xlsx'); } catch(e){}
  throw new Error('SheetJS not found. Pass --sheetjs <path to xlsx.full.min.js>, or set SHEETJS.');
}

const XLSX = loadSheetJS();
const DesignParser = require('./parser.js');

/* The workbook is deliberately not in the repo — everything here is served, and
   a Dialog design sheet is not something to publish. Not having it is a reason
   the tests could not run, which is different from a test failing, so it exits
   with its own code rather than a green nothing or a red failure. */
if (!fs.existsSync(BOOK)){
  console.log('\nThe tests did not run. They need the design workbook:\n');
  console.log('  ' + BOOK + '\n');
  console.log('Copy the batch workbook there under that name and run this again.\n');
  process.exit(2);
}

const t0 = Date.now();
const wb = XLSX.read(fs.readFileSync(BOOK), { type: 'buffer' });
const { ctx, sites } = DesignParser.extract(wb, XLSX);
const ms = Date.now() - t0;

const by = id => sites.find(s => String(s.siteId).replace(/\.$/, '').toUpperCase() === id);

/* ---------------------------------------------------------------- runner */
let pass = 0, fail = 0;
/* Key order is an accident of which sector was read first, not a fact about
   the site, so objects are compared by their contents. */
const stable = v => (v && typeof v === 'object' && !Array.isArray(v))
  ? JSON.stringify(Object.keys(v).sort().map(k => [k, v[k]]))
  : JSON.stringify(v);
const show = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
function is(label, got, want){
  const ok = stable(got) === stable(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(46) + show(got) + (ok ? '' : '   want ' + show(want)));
}

/* one site printed, for looking rather than asserting */
const only = process.argv.slice(2).find(a => /^[A-Z]{2}\d{3,5}$/i.test(a));
if (only){
  const s = by(only.toUpperCase());
  if (!s){ console.log('No such site: ' + only); process.exit(1); }
  console.log(JSON.stringify({ summary: DesignParser.summarise(s), site: s }, null, 2));
  process.exit(0);
}

console.log('\n' + path.basename(BOOK));
console.log('sheet "' + ctx.sheetName + '", header row ' + ctx.headerRow +
            ', ' + sites.length + ' sites, read in ' + ms + 'ms\n');

/* -------------------------------------------------- the two verified sites */
console.log('MU5051 — the BOM says 3 Sectors / 5 RRUs, RRU 5909(L21)×3, RRU5910 (GL900)×2');
{
  const s = by('MU5051');
  is('found', !!s, true);
  if (s){
    is('sectors', s.sectorCount, 3);
    is('rruCount', s.rruCount, 5);
    is('rruByModel', s.rruByModel, { RRU5909: 3, RRU5910: 2 });
    is('antennaCount', s.antennaCount, 3);
  }
}

console.log('\nKI5032 — the BOM says 4 Sectors / 6 RRUs');
{
  const s = by('KI5032');
  is('found', !!s, true);
  if (s){
    is('sectors', s.sectorCount, 4);
    is('rruCount', s.rruCount, 6);
  }
}

/* ------------------------------------------------------ the rules hold up */
console.log('\nrules');
{
  /* A radio written once per technology must still be one radio. If this ever
     breaks, rruCount inflates by exactly the number of extra technology cells. */
  const multi = sites.find(s => s.sectors.some(sec => {
    const models = sec.radios.filter(r => !r.shared && !r.noise).map(r => r.model);
    return models.length > new Set(models).size;
  }));
  is('a multi-band radio exists to test', !!multi, true);
  if (multi){
    const sec = multi.sectors.find(x => {
      const m = x.radios.filter(r => !r.shared && !r.noise).map(r => r.model);
      return m.length > new Set(m).size;
    });
    const cells = sec.radios.filter(r => !r.shared && !r.noise).length;
    is(multi.siteId + ' sec ' + sec.sector + ': cells vs radios', cells + ' cells -> ' + sec.rruModels.length + ' radios',
       cells + ' cells -> ' + new Set(sec.radios.filter(r => !r.shared && !r.noise).map(r => r.model)).size + ' radios');
  }

  is('no site counts a shared radio as hardware',
     sites.every(s => !Object.keys(s.rruByModel).some(m => /^shared?\b/i.test(m))), true);
  is('no source string counted as a model',
     sites.every(s => !Object.keys(s.rruByModel).some(m => /^dap\s*wh/i.test(m))), true);
  is('every site has an ID', sites.every(s => !!s.siteId), true);
  is('sector counts are 2, 3 or 4',
     [...new Set(sites.map(s => s.sectorCount))].filter(n => n && (n < 2 || n > 4)).length, 0);
}

/* ------------------------------------------------------------ the shape */
console.log('\nshape of the batch');
{
  const spread = {};
  sites.forEach(s => spread[s.sectorCount] = (spread[s.sectorCount] || 0) + 1);
  console.log('  sectors  ' + Object.entries(spread).sort().map(([k, v]) => k + ' sec × ' + v).join(',  '));
  const tx = {};
  sites.forEach(s => tx[s.txMode || 'none'] = (tx[s.txMode || 'none'] || 0) + 1);
  console.log('  tx       ' + Object.entries(tx).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' × ' + v).join(',  '));
  const models = {};
  sites.forEach(s => Object.entries(s.rruByModel).forEach(([m, c]) => models[m] = (models[m] || 0) + c));
  console.log('  radios   ' + Object.entries(models).sort((a, b) => b[1] - a[1]).map(([m, c]) => m + ' × ' + c).join(',  '));
  console.log('  flagged  ' + sites.filter(s => s.flags.length).length + ' of ' + sites.length + ' sites');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
