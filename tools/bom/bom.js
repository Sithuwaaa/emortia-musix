/* bom.js - the BOM engine. No DOM, no globals it does not own, so the same
   file runs in the page and under node for the tests.

   The shape of a BOM here follows the July Target sheet: one row per material,
   one column per site. What this file does is fill those cells.

   A material's quantity comes from one of two places.

     from the design    the radios, the antennas, the BBU and its cards. The
                        design sheet already says which model and how many, so
                        the BOM must not guess. RRU5910 x2 in the design is
                        RRU5910 x2 in the BOM.

     from a rule        everything else - brackets, jumpers, earth, ties. These
                        follow the site: how many sectors, how many RRUs, how
                        tall the pole is, which vendor, how the site is fed.

   Every rule below was read off the July Target sheet, not invented. Each one
   carries the agreement it had against those 33 hand-built columns, so a rule
   that only mostly holds says so. All of them are editable in the tool - the
   sheet is the starting point, not the law. */

(function(root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BomEngine = factory();
})(typeof self !== 'undefined' ? self : this, function(){
'use strict';

/* ------------------------------------------------------------------ helpers */

const norm  = s => String(s == null ? '' : s).trim();
const key   = s => norm(s).toLowerCase().replace(/\s+/g, ' ');
const num   = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

/* The formula language is deliberately small: arithmetic over four numbers.
   Anything that needs a condition gets a second rule row instead of a ternary,
   because a row is something you can read and edit; a nested ternary is not. */
const VARS = ['sec', 'rru', 'ant', 'ht'];
const TOKEN = /^[\s0-9.+\-*/()]*$/;

function compile(expr){
  const src = norm(expr);
  if (!src) return null;
  let bare = src;
  VARS.forEach(v => { bare = bare.split(v).join(' '); });
  bare = bare.replace(/\b(ceil|round|floor|max|min)\b/g, ' ').split(',').join(' ');
  if (!TOKEN.test(bare)) throw new Error('Only ' + VARS.join(', ') + ', numbers and + - * / ( ) are allowed here');
  const body = 'var ceil=Math.ceil,round=Math.round,floor=Math.floor,max=Math.max,min=Math.min;return (' + src + ');';
  let fn;
  try { fn = new Function(VARS.join(','), body); } catch(e){ throw new Error('That formula does not parse'); }
  try { fn(3, 5, 3, 30); } catch(e){ throw new Error('That formula does not run'); }
  return fn;
}

/* What a site looks like to a rule.

   The design sheet does not always say how a site is fed - a handful arrive
   with the Tx plan column empty, and those are exactly the sites whose IF
   cable, MW bracket and surge arrestors nobody can work out. So the facts are
   correctable: whatever `patch` carries wins over the design, and the tool
   remembers it. Nothing else in here guesses. */
function factsOf(site, patch){
  const p = patch || {};
  const pick = (a, b) => (a === 0 || (a != null && a !== '')) ? a : b;
  const vendor = norm(pick(p.vendor, site.ftkVendor || site.vendor));
  const tx     = norm(pick(p.tx, site.txMode || site.tx)).toUpperCase();
  const f = {
    id:     norm(site.siteId),
    name:   norm(site.siteName),
    vendor: vendor,
    tx:     tx.includes('WIBAS') ? 'WiBAS' : tx.includes('MW') ? 'MW-HYB' : tx.includes('OFN') ? 'OFN' : (tx || ''),
    band:   norm(pick(p.band, site.mwBand)).toUpperCase(),
    sec:    num(pick(p.sec, site.sectorCount != null ? site.sectorCount : site.sectors)),
    rru:    num(pick(p.rru, site.rruCount   != null ? site.rruCount   : site.rrus)),
    ant:    num(pick(p.ant, site.antennaCount != null ? site.antennaCount : site.antennas)),
    ht:     num(pick(p.ht,  site.siteHeight != null ? site.siteHeight : site.heightM))
  };
  f.gaps = [];
  if (!f.vendor) f.gaps.push('vendor');
  if (!f.tx)     f.gaps.push('Tx plan');
  if (f.tx === 'MW-HYB' && !f.band) f.gaps.push('MW band');
  if (!f.ht)     f.gaps.push('height');
  f.edited = Object.keys(p).filter(k => p[k] !== '' && p[k] != null);
  return f;
}

/* A site can be fed more than one way - "OFN/MW-HYB" is in the design sheet.
   A rule asking for MW-HYB should fire on those, so match on containment. */
function txMatches(want, has){
  if (!want || !want.length) return true;
  const h = norm(has).toUpperCase();
  return want.some(w => h === norm(w).toUpperCase());
}
function listMatches(want, has){
  if (!want || !want.length) return true;
  const h = norm(has).toUpperCase();
  return want.some(w => h === norm(w).toUpperCase());
}

function ruleFires(when, f){
  if (!when) return true;
  if (when.off) return false;
  if (!listMatches(when.vendor, f.vendor)) return false;
  if (!txMatches(when.tx, f.tx)) return false;
  if (!listMatches(when.band, f.band)) return false;
  if (when.minRru != null && f.rru < when.minRru) return false;
  if (when.maxRru != null && f.rru > when.maxRru) return false;
  if (when.minHt  != null && f.ht  < when.minHt)  return false;
  if (when.maxHt  != null && f.ht  > when.maxHt)  return false;
  if (when.minSec != null && f.sec < when.minSec) return false;
  if (when.maxSec != null && f.sec > when.maxSec) return false;
  return true;
}

/* ---------------------------------------------------------- design lookups */

/* Some BBU cells are not a model at all - "BB Removal Project", "Ericsson BB
   removal". They are notes about the work, and nobody orders one. */
const NOT_A_MODEL = /removal|project|^n\/?a$|^none$|^-+$/i;

/* And some are a model with a count in front of it: "2*UBBPg2" is two cards,
   not a card called 2*UBBPg2. */
function readModel(raw){
  const s = norm(raw);
  const m = /^(\d+)\s*[*x×]\s*(.+)$/i.exec(s);
  return m ? { model: norm(m[2]), count: num(m[1]) } : { model: s, count: 1 };
}

function cardsOf(site){
  return (site.controlCards || []).concat(site.basebandCards || []);
}

/* The design's own counts, by model. These are the numbers the tool must not
   second-guess: the design says RRU5910 x2, so the BOM says RRU5910 x2. */
function designCount(site, kind, model){
  const m = key(model);
  if (kind === 'rru'){
    const by = site.rruByModel || {};
    for (const k in by) if (key(k) === m) return num(by[k]);
    return 0;
  }
  if (kind === 'ant'){
    const by = site.antennaByModel || {};
    for (const k in by) if (key(k) === m) return num(by[k]);
    const list = site.antennas || {};
    for (const k in list) if (key(k) === m) return num((list[k] || {}).count);
    return 0;
  }
  /* On an Ericsson site the BBU addition and the baseband card are the same
     box - BB6631 is written in both columns. Counting the two columns
     separately would order it twice, so a model is looked for in both and
     counted once. */
  if (kind === 'bbu' || kind === 'card'){
    let n = 0;
    (site.bbuAddition || []).forEach(x => { const r = readModel(x); if (key(r.model) === m) n = Math.max(n, r.count); });
    if (n) return n;
    cardsOf(site).forEach(x => { const r = readModel(x); if (key(r.model) === m) n = Math.max(n, r.count); });
    return n;
  }
  return 0;
}

/* every model the design mentions, so the catalogue can be grown to cover it */
function modelsIn(sites){
  const out = { rru: {}, ant: {}, bbu: {}, card: {} };
  const bump = (b, raw) => {
    const { model } = readModel(raw);
    if (model && !NOT_A_MODEL.test(model)) b[model] = (b[model] || 0) + 1;
  };
  (sites || []).forEach(s => {
    Object.keys(s.rruByModel || {}).forEach(m => bump(out.rru, m));
    Object.keys(s.antennaByModel || s.antennas || {}).forEach(m => bump(out.ant, m));
    (s.bbuAddition || []).forEach(m => bump(out.bbu, m));
    cardsOf(s).forEach(m => bump(out.card, m));
  });
  return out;
}

/* ------------------------------------------------------------- the catalogue

   cat    the heading it sits under in the July Target sheet
   name   exactly as that sheet writes it, so an exported BOM drops straight in
   unit   nos / set / m / ft / each
   from   'design' - quantity is whatever the design says for that model
          'rule'   - quantity comes from the first rule row that fires
   rules  tried in order, first match wins. `off: true` means the row is there
          to be switched on by hand: the sheet uses it, but nothing in the
          design decides it (MW dish sizes, spare drums, one-off purchases).
   fit    how many of the 33 hand-built columns this agreed with, as a note to
          whoever edits it next. Blank where the item is decided by hand. */

const CATALOGUE = [
  /* ---- Brackets & Poles ---- */
  { cat:'Brackets & Poles', name:'Antenna Circle Bracket', unit:'set', from:'rule',
    rules:[{ q:'1', when:{ off:true } }], note:'9 of 33 - depends on the antenna, decide it per site' },
  { cat:'Brackets & Poles', name:'Enclouser Mounting Pole', unit:'nos', from:'rule',
    rules:[{ q:'1' }], fit:'33/33' },
  { cat:'Brackets & Poles', name:'Antenna GSM Pole (3m)', unit:'nos', from:'rule',
    rules:[{ q:'sec', when:{ off:true } }], note:'9 of 33 - only where the antennas need their own poles' },
  { cat:'Brackets & Poles', name:'LP RRU Bracket', unit:'set', from:'rule',
    rules:[{ q:'1', when:{ maxRru:3 } }, { q:'2' }], fit:'33/33' },
  { cat:'Brackets & Poles', name:'MW Bracket (HUB)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ tx:['MW-HYB','WiBAS'] } }], fit:'22/22' },
  { cat:'Brackets & Poles', name:'MW Bracket for Lamp Pole', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ tx:['MW-HYB'] } }], fit:'17/17' },
  { cat:'Brackets & Poles', name:'Wi-Bas Bracket for Lamp Pole', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ tx:['WiBAS'] } }], fit:'5/5' },

  /* ---- GSM Antenna - the design names the model and the count ---- */
  { cat:'GSM Antenna', name:'SXPWL4WH-16/18-65/65-IVT-R1_10P', unit:'nos', from:'design',
    ref:{ kind:'ant', model:'SXPWL4WH-16/18-65/65-IVT-R1_10P' }, fit:'32/32' },
  { cat:'GSM Antenna', name:'New RVV2NPX310.21(5P)', unit:'nos', from:'design',
    ref:{ kind:'ant', model:'And_New Commscope New RVV2NPX310.21' } },
  { cat:'GSM Antenna', name:'AT-COMM_RVV2H-6533B-R5_4.3-10F', unit:'nos', from:'design',
    ref:{ kind:'ant', model:'AT-COMM_RVV2H-6533B-R5_4.3-10F' } },

  /* ---- IDU with Jumper ---- */
  { cat:'IDU with Jumper', name:'Huawei,Optix RTN905', unit:'nos', from:'rule',
    rules:[{ q:'2', when:{ tx:['MW-HYB'] } }], fit:'14/17' },
  { cat:'IDU with Jumper', name:'Ericsson 2P IDU', unit:'nos', from:'rule', rules:[{ q:'1', when:{ off:true } }] },
  { cat:'IDU with Jumper', name:'Ericsson 6P IDU', unit:'nos', from:'rule', rules:[{ q:'1', when:{ off:true } }] },
  { cat:'IDU with Jumper', name:'Wi-Bas POE', unit:'nos', from:'rule',
    rules:[{ q:'2', when:{ tx:['WiBAS'] } }], fit:'5/5' },

  /* ---- MW Antenna - the dish is a link decision, not a design-sheet one ---- */
  { cat:'MW Antenna', name:'0.3m (Huawei)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ off:true, vendor:['Huawei'], tx:['MW-HYB'] } }], note:'dish size comes from the link plan' },
  { cat:'MW Antenna', name:'0.6m (Huawei)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ vendor:['Huawei'], tx:['MW-HYB'] } }], note:'dish size comes from the link plan' },
  { cat:'MW Antenna', name:'1.2m (Huawei)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ off:true, vendor:['Huawei'], tx:['MW-HYB'] } }], note:'dish size comes from the link plan' },
  { cat:'MW Antenna', name:'0.3m (Ericsson)', unit:'nos', from:'rule',
    rules:[{ q:'2', when:{ off:true, vendor:['Ericsson'], tx:['MW-HYB'] } }], note:'dish size comes from the link plan' },
  { cat:'MW Antenna', name:'0.6m (Ericsson)', unit:'nos', from:'rule',
    rules:[{ q:'2', when:{ vendor:['Ericsson'], tx:['MW-HYB'] } }], note:'dish size comes from the link plan' },
  { cat:'MW Antenna', name:'0.3m (Wi-Bas)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ tx:['WiBAS'] } }], fit:'5/5' },
  { cat:'MW Antenna', name:'0.6m (Wi-Bas)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ tx:['WiBAS'] } }], fit:'5/5' },

  /* ---- ODU - the design does carry the band, so these follow it ---- */
  { cat:'ODU', name:'23G-H (Huawei)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ vendor:['Huawei'], tx:['MW-HYB'], band:['23G'] } }], fit:'3/3' },
  { cat:'ODU', name:'23G-L (Huawei)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ vendor:['Huawei'], tx:['MW-HYB'], band:['23G'] } }], fit:'3/3' },
  { cat:'ODU', name:'23G-H (Ericsson)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ vendor:['Ericsson'], tx:['MW-HYB'], band:['23G'] } }], fit:'3/3' },
  { cat:'ODU', name:'23G-L (Ericsson)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ vendor:['Ericsson'], tx:['MW-HYB'], band:['23G'] } }], fit:'3/3' },
  { cat:'ODU', name:'18G-H (Huawei)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ vendor:['Huawei'], tx:['MW-HYB'], band:['18G'] } }], fit:'9/9' },
  { cat:'ODU', name:'18G-L (Huawei)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ vendor:['Huawei'], tx:['MW-HYB'], band:['18G'] } }], fit:'9/9' },
  { cat:'ODU', name:'18G-H (Ericsson)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ vendor:['Ericsson'], tx:['MW-HYB'], band:['18G'] } }] },
  { cat:'ODU', name:'18G-L (Ericsson)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ vendor:['Ericsson'], tx:['MW-HYB'], band:['18G'] } }] },
  { cat:'ODU', name:'15G-H (Huawei)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ vendor:['Huawei'], tx:['MW-HYB'], band:['15G'] } }] },
  { cat:'ODU', name:'15G-L (Huawei)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ vendor:['Huawei'], tx:['MW-HYB'], band:['15G'] } }] },
  { cat:'ODU', name:'10G-H (Wi-Bas)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ tx:['WiBAS'] } }], fit:'3/5' },
  { cat:'ODU', name:'10G-L (Wi-Bas)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ tx:['WiBAS'] } }], fit:'3/5' },

  /* ---- RRU with Bracket - straight from the design ---- */
  { cat:'RRU with Bracket', name:'RRU5910 (GL900)', unit:'nos', from:'design',
    ref:{ kind:'rru', model:'RRU5910' }, fit:'23/23' },
  { cat:'RRU with Bracket', name:'Radio 2271 (GL900)', unit:'nos', from:'design',
    ref:{ kind:'rru', model:'Radio 2271' }, fit:'9/9' },
  { cat:'RRU with Bracket', name:'RRU 4490 B1+B3 (L1800 + L2100)', unit:'nos', from:'design',
    ref:{ kind:'rru', model:'RRU 4490 B1+B3' }, fit:'9/9' },
  { cat:'RRU with Bracket', name:'RRU 5909(L21)', unit:'nos', from:'design',
    ref:{ kind:'rru', model:'RRU5909' }, fit:'23/23' },
  { cat:'RRU with Bracket', name:'RRU5909 B3 (L18)', unit:'nos', from:'design',
    ref:{ kind:'rru', model:'RRU5909 B3' } },

  /* ---- Connectors ---- */
  { cat:'Connectors', name:'Y Connectors', unit:'nos', from:'rule',
    rules:[{ q:'2', when:{ off:true } }], note:'6 of 33 - switch it on where the link needs one' },
  { cat:'Connectors', name:'IF Connectors', unit:'nos', from:'rule',
    rules:[{ q:'4', when:{ tx:['MW-HYB'] } }], fit:'17/17' },
  { cat:'Connectors', name:'RJ45 Ethernet Connectors', unit:'nos', from:'rule',
    rules:[{ q:'8', when:{ off:true } }], note:'4 of 33' },

  /* ---- SFP ---- */
  { cat:'SFP', name:'10G SFP', unit:'nos', from:'rule',
    rules:[{ q:'2*rru' }], fit:'31/31' },
  { cat:'SFP', name:'1.25G TX SFP', unit:'nos', from:'rule',
    rules:[{ q:'2', when:{ tx:['OFN'] } }, { q:'4' }], fit:'31/31' },

  /* ---- Cables ---- */
  { cat:'Cables', name:'RRU Power Cable (Huawei)', unit:'m', from:'rule',
    rules:[{ q:'5*ht+150', when:{ vendor:['Huawei'], minRru:6 } },
           { q:'5*ht+100', when:{ vendor:['Huawei'] } }], fit:'17/23', note:'5m a metre of pole, plus the run into the enclosure' },
  { cat:'Cables', name:'RRU Power Cable (Ericsson)', unit:'m', from:'rule',
    rules:[{ q:'5*ht+150', when:{ vendor:['Ericsson'], minRru:6 } },
           { q:'5*ht+100', when:{ vendor:['Ericsson'] } }], fit:'8/8' },
  { cat:'Cables', name:'RRU Power Cable (Enclauser Power)', unit:'m', from:'rule',
    rules:[{ q:'20', when:{ off:true } }] },
  { cat:'Cables', name:'Fiber Cable (40m) - Huawei', unit:'nos', from:'rule',
    rules:[{ q:'rru', when:{ vendor:['Huawei'] } }], fit:'22/23' },
  { cat:'Cables', name:'Fiber Cable (40m) - Ericsson', unit:'nos', from:'rule',
    rules:[{ q:'rru', when:{ vendor:['Ericsson'] } }], fit:'8/8' },
  { cat:'Cables', name:'Fiber Cable (70m)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ off:true } }], note:'4 of 33 - tall poles and long runs' },
  { cat:'Cables', name:'Fiber(60M)Huawei', unit:'nos', from:'rule', rules:[{ q:'1', when:{ off:true } }] },
  { cat:'Cables', name:'TX Fiber Pair (LC-LC)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ tx:['MW-HYB'] } }], fit:'15/17' },
  { cat:'Cables', name:'TX Fiber Pair (LC-SC)', unit:'nos', from:'rule',
    rules:[{ q:'2', when:{ tx:['OFN'] } }], fit:'10/10' },
  { cat:'Cables', name:'6mm Earth', unit:'m', from:'rule',
    rules:[{ q:'5' }], fit:'21/33' },
  { cat:'Cables', name:'16mm Earth', unit:'m', from:'rule',
    rules:[{ q:'rru+10' }], fit:'30/31' },
  { cat:'Cables', name:'RET Cable', unit:'nos', from:'rule', rules:[{ q:'sec', when:{ off:true } }] },
  { cat:'Cables', name:'IF Cable', unit:'m', from:'rule',
    rules:[{ q:'80', when:{ tx:['MW-HYB'] } }], fit:'17/17' },

  /* ---- Jumpers - the length pair follows the sector count, the connector
         pair follows the ports. Two sets, one of them switched on. ---- */
  { cat:'Jumpers', name:'32-32 (3m)', unit:'nos', from:'rule',
    rules:[{ q:'2*sec', when:{ off:true } }], fit:'7/7 when on', note:'for 4.3-10 to 4.3-10 ports' },
  { cat:'Jumpers', name:'22-32 (3m)', unit:'nos', from:'rule',
    rules:[{ q:'2*sec' }], fit:'23/24' },
  { cat:'Jumpers', name:'22-32 (5m)', unit:'nos', from:'rule',
    rules:[{ q:'4*sec', when:{ off:true } }], fit:'7/7 when on' },
  { cat:'Jumpers', name:'22-22 (5m)', unit:'nos', from:'rule',
    rules:[{ q:'4*sec' }], fit:'23/24' },

  /* ---- BBU - the design names the cards ---- */
  { cat:'BBU', name:'Huawei BBU3910 with UPEU, FAN Card & Power Cable', unit:'nos', from:'design',
    ref:{ kind:'bbu', model:'BBU3910' }, fit:'23/23' },
  { cat:'BBU', name:'BBU5900 with UPEU, FAN Card & Power Cable', unit:'nos', from:'design',
    ref:{ kind:'bbu', model:'BBU5900' } },
  { cat:'BBU', name:'BB6631 with Power Cables', unit:'nos', from:'design',
    ref:{ kind:'bbu', model:'BB6631' }, fit:'9/9' },
  { cat:'BBU', name:'BB6630 with Power Cables', unit:'nos', from:'design',
    ref:{ kind:'bbu', model:'BB6630' } },
  { cat:'BBU', name:'UMPTg2', unit:'nos', from:'design', ref:{ kind:'card', model:'UMPTg2' }, fit:'23/23' },
  { cat:'BBU', name:'UBBPg1a', unit:'nos', from:'design', ref:{ kind:'card', model:'UBBPg1a' }, fit:'23/23' },
  { cat:'BBU', name:'UEIU', unit:'nos', from:'rule', rules:[{ q:'1', when:{ off:true } }] },

  /* ---- Ethernet ---- */
  { cat:'Ethernet', name:'Outdoor Ethernet', unit:'m', from:'rule',
    rules:[{ q:'100', when:{ off:true } }], note:'4 of 33' },
  { cat:'Ethernet', name:'Readymade Ethernet (5m)', unit:'nos', from:'rule',
    rules:[{ q:'1' }], fit:'30/33' },

  /* ---- Local Purchased ---- */
  { cat:'Local Purchased', name:'Ethernet Convertor', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ vendor:['Huawei'] } }], fit:'23/23' },
  { cat:'Local Purchased', name:'AC Relay with Base', unit:'nos', from:'rule', rules:[{ q:'1', when:{ off:true } }] },
  { cat:'Local Purchased', name:'2 Core Flexible Wire', unit:'m', from:'rule', rules:[{ q:'20', when:{ off:true } }] },
  { cat:'Local Purchased', name:'6A Breacker', unit:'nos', from:'rule', rules:[{ q:'1', when:{ off:true } }] },
  { cat:'Local Purchased', name:'Surge Arestor (MW)', unit:'nos', from:'rule',
    rules:[{ q:'4', when:{ tx:['MW-HYB'] } }], fit:'17/17' },
  { cat:'Local Purchased', name:'Surge Arestor (Wi-Bas)', unit:'nos', from:'rule',
    rules:[{ q:'2', when:{ tx:['WiBAS'] } }], fit:'4/5' },
  { cat:'Local Purchased', name:'M6 Cage Nut and Screw', unit:'nos', from:'rule',
    rules:[{ q:'8' }], fit:'33/33' },
  { cat:'Local Purchased', name:'6mm Lug', unit:'nos', from:'rule',
    rules:[{ q:'8', when:{ off:true } }], note:'11 of 33' },
  { cat:'Local Purchased', name:'16mm Lug', unit:'nos', from:'rule',
    rules:[{ q:'16', when:{ tx:['OFN'] } }, { q:'24', when:{ minSec:4 } }, { q:'22' }], fit:'29/33' },
  { cat:'Local Purchased', name:'Silicon', unit:'nos', from:'rule', rules:[{ q:'1' }], fit:'33/33' },
  { cat:'Local Purchased', name:'White Tie', unit:'nos', from:'rule', rules:[{ q:'50' }], fit:'33/33' },
  { cat:'Local Purchased', name:'Black tie (L)', unit:'nos', from:'rule', rules:[{ q:'300' }], fit:'33/33' },
  { cat:'Local Purchased', name:'Steel Tie (1Ft, 300mm)', unit:'nos', from:'rule',
    rules:[{ q:'30', when:{ minHt:30 } }, { q:'28' }], fit:'22/33', note:'the loose one - it moves with how the pole is dressed' },
  { cat:'Local Purchased', name:'Colour Tapes (Blue/White/Red)', unit:'each', from:'rule', rules:[{ q:'1' }], fit:'33/33' },
  { cat:'Local Purchased', name:'Colour Tapes (Yellow)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ off:true } }], note:'10 of 33' },
  { cat:'Local Purchased', name:'Insulation Tape', unit:'nos', from:'rule', rules:[{ q:'10' }], fit:'31/33' },
  { cat:'Local Purchased', name:'Bonding', unit:'nos', from:'rule', rules:[{ q:'8' }], fit:'31/33' },
  { cat:'Local Purchased', name:'OutDoor Label', unit:'nos', from:'rule', rules:[{ q:'5' }], fit:'33/33' },
  { cat:'Local Purchased', name:'Feeder Engineering Label', unit:'nos', from:'rule', rules:[{ q:'5' }], fit:'33/33' },
  { cat:'Local Purchased', name:'Indoor Label Sheet', unit:'nos', from:'rule', rules:[{ q:'1' }], fit:'33/33' },
  { cat:'Local Purchased', name:'IF Earthing Kits', unit:'nos', from:'rule',
    rules:[{ q:'5', when:{ tx:['MW-HYB'] } }], fit:'17/17' },
  { cat:'Local Purchased', name:'GI Flexible (20mm)', unit:'m', from:'rule',
    rules:[{ q:'55', when:{ vendor:['Ericsson'] } }, { q:'40' }], fit:'27/33' },
  { cat:'Local Purchased', name:'PVC End Cap', unit:'nos', from:'rule', rules:[{ q:'1' }], fit:'33/33' },
  { cat:'Local Purchased', name:'Label Tie', unit:'nos', from:'rule', rules:[{ q:'100' }], fit:'33/33' },
  { cat:'Local Purchased', name:'Stainless Steel Wire Mesh', unit:'ft', from:'rule', rules:[{ q:'1' }], fit:'33/33' },

  /* ---- the rest ---- */
  { cat:'Clamp', name:'Clamp', unit:'nos', from:'rule',
    rules:[{ q:'50', when:{ tx:['WiBAS'] } }, { q:'10' }], fit:'33/33' },
  { cat:'Enclouser', name:'Enclouser', unit:'nos', from:'rule', rules:[{ q:'1' }], fit:'33/33' },
  { cat:'Enclouser', name:'Fiber 10m', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ off:true } }], note:'20 of 33' },
  { cat:'DCDU', name:'DCDU 12B', unit:'nos', from:'rule', rules:[{ q:'1' }], fit:'33/33' },
  { cat:'DCDU', name:'Outdoor DC Power Box', unit:'nos', from:'rule', rules:[{ q:'1' }], fit:'27/33' },
  { cat:'DCDU', name:'32-22 Converter Connectors', unit:'nos', from:'rule',
    rules:[{ q:'6*sec' }], fit:'24/24' },
  { cat:'DCDU', name:'Alarm Cable (For Ericsson Sites)', unit:'nos', from:'rule',
    rules:[{ q:'1', when:{ vendor:['Ericsson'] } }], fit:'10/10' }
];

/* Where a design model already has a home in the catalogue under a different
   name. The July Target sheet writes RRU5909 as "RRU 5909(L21)"; the design
   writes RRU5909. Same box. */
const CAT_FOR = {
  rru:  'RRU with Bracket',
  ant:  'GSM Antenna',
  bbu:  'BBU',
  card: 'BBU'
};

function freshCatalogue(){
  return CATALOGUE.map(it => JSON.parse(JSON.stringify(it)));
}

/* -------------------------------------------------------------- growing it

   The reference sheet knows five radios and three antennas. The design batch
   has sixteen radios and twelve antennas. Anything the design mentions that
   the catalogue cannot price is added here, so a site never arrives with a
   radio the BOM quietly drops. */

function growCatalogue(catalogue, sites){
  /* One model, one line - whichever column of the design it came out of. That
     is what stops BB6631 being ordered as a BBU and again as a card. */
  const have = {};
  catalogue.forEach(it => { if (it.from === 'design' && it.ref) have[key(it.ref.model)] = true; });
  const found = modelsIn(sites);
  const added = [];
  ['rru', 'ant', 'bbu', 'card'].forEach(kind => {
    Object.keys(found[kind]).sort().forEach(model => {
      if (have[key(model)]) return;
      const it = { cat: CAT_FOR[kind], name: model, unit:'nos', from:'design',
                   ref:{ kind: kind, model: model }, added:true,
                   note:'added from the design - ' + found[kind][model] + ' site' + (found[kind][model] === 1 ? '' : 's') };
      catalogue.push(it); added.push(it);
      have[key(model)] = true;
    });
  });
  return added;
}

/* ------------------------------------------------------------- the building */

/* one site, every material that comes to more than nothing.

   `overrides` is keyed by site ID and holds two things: `facts`, which corrects
   what the design left blank or wrong, and `qty`, a quantity typed by hand for
   one material. A typed quantity always wins - including a typed zero, which is
   how you take a line off a site without touching the rule for every other. */
function buildSite(site, catalogue, overrides){
  const own = (overrides || {})[norm(site.siteId)] || {};
  const f = factsOf(site, own.facts);
  const ov = own.qty || {};
  const lines = [];
  catalogue.forEach(it => {
    let qty = 0, why = '';
    if (it.from === 'design' && it.ref){
      qty = designCount(site, it.ref.kind, it.ref.model);
      why = qty ? 'design · ' + it.ref.model : '';
    } else {
      const hit = (it.rules || []).find(r => ruleFires(r.when, f));
      if (hit){
        try { const fn = compile(hit.q); qty = fn ? Math.max(0, Math.round(fn(f.sec, f.rru, f.ant, f.ht))) : 0; }
        catch(e){ qty = 0; why = 'rule will not run: ' + e.message; }
        if (qty && !why) why = 'rule · ' + hit.q;
      }
    }
    const k = key(it.name);
    const edited = Object.prototype.hasOwnProperty.call(ov, k);
    if (edited){ qty = num(ov[k]); why = 'yours'; }
    if (!qty) return;
    lines.push({ cat: it.cat, name: it.name, unit: it.unit, qty: qty, why: why, edited: edited });
  });
  return { site: f, lines: lines, total: lines.reduce((a, l) => a + l.qty, 0) };
}

/* the quantity a single material comes to, without building the whole site —
   what the tool asks when you are staring at one row */
function lineFor(site, item, overrides){
  const b = buildSite(site, [item], overrides);
  return b.lines.length ? b.lines[0] : { cat: item.cat, name: item.name, unit: item.unit, qty: 0, why: '' };
}

function build(sites, catalogue, overrides){
  return (sites || []).map(s => buildSite(s, catalogue, overrides));
}

/* every material any site needs, with the run total - what you actually order */
function rollup(built){
  const rows = {};
  built.forEach(b => b.lines.forEach(l => {
    const k = key(l.name);
    if (!rows[k]) rows[k] = { cat: l.cat, name: l.name, unit: l.unit, total: 0, sites: 0 };
    rows[k].total += l.qty; rows[k].sites++;
  }));
  return Object.values(rows);
}

/* --------------------------------------------------------------- the sheet

   The July Target layout: seven rows of site heading, then one row per
   material with a column per site. Handing this back in the same shape means
   it drops into the file the team already reads. */

function toMatrix(built, catalogue){
  const cols = built.map(b => b.site);
  const rows = [];
  const R = (a, b, c, d, cells) => rows.push([a, b, c, d].concat(cells));

  R('', '', '', 'Site ID',         cols.map(s => s.id));
  R('', '', '', 'Site Name',       cols.map(s => s.name));
  R('', '', '', 'Tx plan',         cols.map(s => s.tx));
  R('', '', '', 'Vendor',          cols.map(s => s.vendor));
  R('', '', '', 'Site Height (m)', cols.map(s => s.ht || ''));
  R('', '', '', 'MW Band',         cols.map(s => s.band));
  R('Category', 'Material Detail', 'Unit', 'Sum',
    cols.map(s => s.sec + ' Sectors\n' + s.rru + ' RRUs'));

  const at = {};
  built.forEach((b, i) => b.lines.forEach(l => { (at[key(l.name)] = at[key(l.name)] || {})[i] = l.qty; }));

  let lastCat = '';
  catalogue.forEach(it => {
    const row = at[key(it.name)];
    if (!row) return;
    const cells = cols.map((_, i) => row[i] || '');
    const sum = cells.reduce((a, v) => a + num(v), 0);
    R(it.cat === lastCat ? '' : it.cat, it.name, it.unit, sum, cells);
    lastCat = it.cat;
  });
  return rows;
}

/* ------------------------------------------------------------------ storage */

const SCHEMA = 'emortia.bom/1';

function envelope(built, catalogue, meta){
  return {
    schema: SCHEMA,
    builtAt: new Date().toISOString(),
    source: (meta || {}).source || '',
    batch: (meta || {}).batch || '',
    sites: built.map(b => ({ site: b.site, lines: b.lines, total: b.total })),
    rollup: rollup(built),
    catalogue: catalogue
  };
}

return {
  SCHEMA, CATALOGUE, VARS,
  freshCatalogue, growCatalogue, modelsIn,
  compile, factsOf, ruleFires, designCount,
  buildSite, build, lineFor, rollup, toMatrix, envelope,
  key, norm
};
});
