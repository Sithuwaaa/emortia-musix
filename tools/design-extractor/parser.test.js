/* parser.test.js — the parser against a real batch.

     node tools/design-extractor/parser.test.js
     node tools/design-extractor/parser.test.js MU5051     print one site
     node tools/design-extractor/parser.test.js --register print the radio table

   MU5051 and KI5032 are the two sites whose answers are known independently:
   both appear in the July Target BOM, which was built by hand from this same
   design. If the parser agrees with the hand-built BOM there, the counting is
   right. Everything else is a check that the rules hold across all 245. */

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const REPO = path.resolve(HERE, '..', '..');
const BOOK = [
  path.join(REPO, '.work', 'design.xlsx'),
  path.join(REPO, 'samples', 'design.xlsx')
].find(p => fs.existsSync(p));

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
    new Function('module', 'exports', 'require', 'global', fs.readFileSync(g, 'utf8'))(mod, mod.exports, require, globalThis);
    if (typeof mod.exports.read === 'function') return mod.exports;
  }
  try { return require('xlsx'); } catch(e){}
  throw new Error('SheetJS not found. Pass --sheetjs <path to xlsx.full.min.js>.');
}

/* The workbook is not in the repository — everything here is served, and a
   Dialog design sheet is not something to publish. Not having it means the
   tests could not run, which is neither a pass nor a failure. */
if (!BOOK){
  console.log('\nThe tests did not run: no design workbook.\n');
  console.log('  put one at  .work/design.xlsx  and run this again\n');
  process.exit(2);
}

const XLSX = loadSheetJS();
const P = require('./parser.js');

const t0 = Date.now();
const { ctx, sites } = P.extract(XLSX.read(fs.readFileSync(BOOK), { type: 'buffer' }), XLSX);
const register = P.buildRegister(sites);
const ms = Date.now() - t0;

const by = id => sites.find(s => String(s.siteId).replace(/\.$/, '').toUpperCase() === id);

let pass = 0, fail = 0;
const stable = v => (v && typeof v === 'object' && !Array.isArray(v))
  ? JSON.stringify(Object.keys(v).sort().map(k => [k, v[k]])) : JSON.stringify(v);
const show = v => typeof v === 'object' ? JSON.stringify(v) : String(v);
function is(label, got, want){
  const ok = stable(got) === stable(want);
  ok ? pass++ : fail++;
  console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label.padEnd(44) + show(got) + (ok ? '' : '   want ' + show(want)));
}

/* ---------------------------------------------------------------- lookups */
const arg = process.argv.slice(2).find(a => /^[A-Z]{2}\d{3,5}$/i.test(a));
if (arg){
  const s = by(arg.toUpperCase());
  if (!s){ console.log('No such site: ' + arg); process.exit(1); }
  console.log(JSON.stringify(P.summarise(s), null, 2));
  process.exit(0);
}
if (process.argv.includes('--register')){
  console.log('\nRadio register — what each model carries, learned from the batch\n');
  Object.values(register).sort((a, b) => b.seen - a.seen).forEach(r =>
    console.log('  ' + r.model.padEnd(30) + (r.label || '').padEnd(24) + String(r.seen).padStart(5) + ' cells   ' + r.vendors.join('/')));
  process.exit(0);
}

console.log('\n' + path.basename(BOOK) + '  ·  sheet "' + ctx.sheetName + '", header row ' + ctx.headerRow);
console.log(sites.length + ' sites read in ' + ms + 'ms\n');

/* -------------------------------------------------- the two verified sites */
console.log('MU5051 — the BOM says 3 sectors / 5 RRUs, RRU5909 ×3 and RRU5910 ×2');
{
  const s = by('MU5051');
  is('found', !!s, true);
  if (s){
    is('sectors', s.sectorCount, 3);
    is('RRUs', s.rruCount, 5);
    is('by model', s.rruByModel, { RRU5909: 3, RRU5910: 2 });
    is('antennas', s.antennaCount, 3);
    is('vendor', s.ftkVendor, 'Huawei');
    is('height', s.siteHeight, 20);
    is('one shared run, from sector 2', s.sharedRuns.length && s.sharedRuns[0].from, 2);
  }
}
console.log('\nKI5032 — the BOM says 4 sectors / 6 RRUs');
{
  const s = by('KI5032');
  is('found', !!s, true);
  if (s){
    is('sectors', s.sectorCount, 4);
    is('RRUs', s.rruCount, 6);
    is('azimuths', s.sectors.filter(x => x.active).map(x => x.azimuth), [60, 140, 220, 320]);
    is('e-tilt on every sector', s.sectors.filter(x => x.active).every(x => x.eTilt === 3), true);
  }
}

/* ------------------------------------------------------------ the rules */
console.log('\nthe counting rule');
{
  const s = by('MU5051');
  const sec1 = s.sectors[0];
  is('sector 1: 3 cells become 2 radios', sec1.cells.length + ' -> ' + sec1.radios.length, '3 -> 2');
  is('RRU5909 is recorded as carrying L2100', (s.radios['RRU5909'] || {}).techs, ['L2100']);
  is('RRU5910 carries G900 and L900', (s.radios['RRU5910'] || {}).techs, ['G900', 'L900']);

  is('no shared run counted as a box',
     sites.every(x => !Object.keys(x.rruByModel).some(m => /^shared?\b/i.test(m))), true);
  is('no source string counted as a model',
     sites.every(x => !Object.keys(x.rruByModel).some(m => /^dap\s*wh/i.test(m))), true);
  is('every site has an ID', sites.every(x => !!x.siteId), true);
  is('sector counts are 2, 3 or 4',
     [...new Set(sites.map(x => x.sectorCount))].filter(n => n && (n < 2 || n > 4)).length, 0);
  is('a radio never counts more than once per sector',
     sites.every(x => x.sectors.every(sec => sec.rruModels.length === new Set(sec.rruModels).size)), true);
}

console.log('\nthe register');
{
  is('RRU5909 carries G900 + L900 + L2100', (register['RRU5909'] || {}).label, 'G900 + L900 + L2100');
  is('RRU 4490 B1+B3 carries L1800 + L2100', (register['RRU 4490 B1+B3'] || {}).label, 'L1800 + L2100');
  is('Radio 2271 carries G900 + L900', (register['Radio 2271'] || {}).label, 'G900 + L900');
  is('RRU5910 carries G900 + L900', (register['RRU5910'] || {}).label, 'G900 + L900');
  is('no share string became a register entry',
     Object.keys(register).some(m => /^shared?\b/i.test(m)), false);
}

console.log('\nwhat came out');
{
  const spread = {};
  sites.forEach(s => spread[s.sectorCount] = (spread[s.sectorCount] || 0) + 1);
  console.log('  sectors   ' + Object.entries(spread).sort().map(([k, v]) => k + ' × ' + v).join(',  '));
  const vend = {}; sites.forEach(s => vend[s.ftkVendor || '—'] = (vend[s.ftkVendor || '—'] || 0) + 1);
  console.log('  vendor    ' + Object.entries(vend).map(([k, v]) => k + ' × ' + v).join(',  '));
  const bbu = {}; sites.forEach(s => s.bbuAddition.forEach(b => bbu[b] = (bbu[b] || 0) + 1));
  console.log('  bbu       ' + Object.entries(bbu).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' × ' + v).join(',  '));
  console.log('  radios    ' + Object.keys(register).length + ' models, ' +
              sites.reduce((a, s) => a + s.rruCount, 0) + ' boxes over ' +
              sites.reduce((a, s) => a + s.sectorCount, 0) + ' sectors');
  console.log('  antennas  ' + sites.reduce((a, s) => a + s.antennaCount, 0));
  console.log('  shared    ' + sites.reduce((a, s) => a + s.sharedRuns.length, 0) + ' runs back to another sector');
  console.log('  flagged   ' + sites.filter(s => s.flags.length).length + ' of ' + sites.length + ' sites');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
