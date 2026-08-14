/* parser.js — the Dialog MBB design workbook, read.

   Nothing here touches the DOM or the network, and the spreadsheet library is
   handed in rather than reached for, so the whole thing runs under node against
   the real workbook. parser.test.js does exactly that.

   The one rule worth understanding before changing anything:

   A multi-band radio is written into the sheet once per technology it carries.
   RRU5909 serving G900, L900 and L2100 in sector 1 occupies three cells and is
   one physical unit. Counting cells triples it. So a radio is counted once per
   DISTINCT MODEL per SECTOR — which is what makes MU5051 come out as 5 rather
   than 15, and matches what the BOM database says for the same site. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.DesignParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const TECHS = ['G900','G1800','L850','L900','L1800','L2100','L2600','L2300(HBB)','L2300(MBB)'];

  /* Cells that mean "nothing here". The sheet uses several. */
  const BLANK = new Set(['', '-', '–', 'n/a', '#n/a', 'na', 'null', 'none']);

  /* "Share sec 2 L21 RRU" reuses a radio that is already up the pole, so it is
     not hardware to order. Kept aside rather than dropped: an engineer reading
     the site still wants to know the sector is fed from somewhere. */
  const SHARE = /^\s*shared?\b/i;

  /* Where a part came from, pasted into the column for what the part is. */
  const SOURCE_NOISE = /^(dap\s*wh|inhouse|in-house)\b/i;

  /* A radio's part number says little; what it carries says everything. The
     engineer says "GL900 RRU 2යි" long before they say RRU5910. */
  const RADIO_LABEL = [
    [/^RRU\s*5910/i,        'GL900'],
    [/^RRU\s*5909/i,        'L21'],
    [/^RRU\s*4490/i,        'L18+L21'],
    [/^Radio\s*2271/i,      'GL900'],
    [/^Radio\s*44(15|99)/i, 'L18'],
    [/^RRU\s*5258/i,        'L26'],
    [/^RRU\s*5501/i,        'L18'],
    [/^RRU\s*12B1|^12B1/i,  'L21'],
    [/^12B3/i,              'L18'],
    [/^13B1/i,              'L21'],
  ];

  const norm    = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  const isBlank = v => v == null || BLANK.has(norm(v).toLowerCase());
  const val     = v => isBlank(v) ? null : (typeof v === 'number' ? v : norm(v));
  const num     = v => { const n = parseFloat(val(v)); return Number.isFinite(n) ? n : null; };

  /* Vendor is spelled two ways in the source sheet. */
  const vendor = v => { const s = val(v); return s ? String(s).replace(/ericssion/ig, 'Ericsson') : s; };

  function radioLabel(model){
    for (const [re, label] of RADIO_LABEL) if (re.test(model)) return label;
    return model;
  }

  /* ---------------------------------------------------------------- sheets */

  function pickSheet(wb){
    return wb.SheetNames.find(n => /design\s*sheet/i.test(n)) || wb.SheetNames[0];
  }

  /* The header is wherever "Site ID" and "Operation Region" sit together. The
     sheet gains and loses columns between batches, so nothing is ever found by
     position — only by what the heading says. */
  function findHeader(grid){
    for (let i = 0; i < Math.min(grid.length, 20); i++){
      const set = new Set((grid[i] || []).map(c => norm(c).toLowerCase()));
      if (set.has('site id') && set.has('operation region')) return i;
    }
    return -1;
  }

  /* "New AP Batch Name" appears twice. First occurrence wins. */
  function indexHeaders(row){
    const idx = {};
    (row || []).forEach((h, i) => { const k = norm(h); if (k && !(k in idx)) idx[k] = i; });
    return idx;
  }

  /* TX plan is not on the design sheet at all — it lives on its own sheet and
     joins on Site ID, some of which carry a trailing full stop. */
  function parseTx(wb, XLSX){
    const map = {};
    const n = wb.SheetNames.find(s => /^tx$/i.test(s));
    if (!n) return map;
    const g = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
    if (!g.length) return map;
    const idx = indexHeaders(g[0]);
    g.slice(1).forEach(r => {
      const id = norm(r[idx['Site ID']]).replace(/\.$/, '').toUpperCase();
      if (!id) return;
      map[id] = {
        txMode:    val(r[idx['TX Mode']]),
        mwMapping: val(r[idx['MW Mapping']]),
        woId:      val(r[idx['WO ID']])
      };
    });
    return map;
  }

  function parseWorkbook(wb, XLSX){
    const sheetName = pickSheet(wb);
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
    const h = findHeader(grid);
    if (h < 0) throw new Error('No header row found — expected a row carrying both "Site ID" and "Operation Region".');
    const idx = indexHeaders(grid[h]);
    const rows = grid.slice(h + 1).filter(r =>
      r && !isBlank(r[idx['Site ID']]) && norm(r[idx['Site ID']]).toLowerCase() !== 'site id');
    return { sheetName, headerRow: h + 1, idx, rows, tx: parseTx(wb, XLSX) };
  }

  /* ------------------------------------------------------------- one site */

  function extractSite(ctx, row){
    const g  = k => { const i = ctx.idx[k]; return i === undefined ? null : val(row[i]); };
    const gn = k => { const i = ctx.idx[k]; return i === undefined ? null : num(row[i]); };

    const s = {
      siteId:          g('Site ID'),
      siteName:        g('Site Name'),
      batchName:       g('New AP Batch Name'),
      index:           g('Index'),
      operationRegion: g('Operation Region'),
      apRegion:        g('AP Region'),
      district:        g('District'),
      ftkOrInhouse:    g('FTK or In-House'),
      ftkVendor:       vendor(ctx.idx['FTK Vendor'] === undefined ? null : row[ctx.idx['FTK Vendor']]),
      siteOwner:       g('Site Owner'),
      siteType:        g('Site Type'),
      siteHeight:      gn('Site Height'),
      projectScope:    g('AP_Project_Scope'),
      latitude:        gn('Finalized Latitude'),
      longitude:       gn('Finalized Longitude'),
      flags: []
    };

    const tx = ctx.tx[String(s.siteId).replace(/\.$/, '').toUpperCase()] || {};
    s.txMode    = tx.txMode || null;
    s.mwMapping = tx.mwMapping || null;
    const band  = /(\d{2})\s*G/.exec(s.mwMapping || '');
    s.mwBand    = band ? band[1] + 'G' : null;

    /* Some flags read "Yes " with a trailing space. */
    s.technologies = TECHS.filter(t => /^y/i.test(g('AP_Upgrade_Flag_' + t) || ''));

    /* ---- sectors ---- */
    s.sectors = [];
    for (let n = 1; n <= 4; n++){
      const sec = {
        sector: n,
        changeScope:       g('AP_Sector_Antenna/AAU_Change Scope Sec ' + n),
        antennaAdd:        g('AP_Sector_Antenna_Addition Type Sec ' + n),
        antennaAddCount:   gn('AP_Sector_Antenna_Addition Count Sec ' + n),
        antennaSource:     g('AP_Sector_Antenna_Addition Source Sec ' + n),
        antennaFinal:      g('AP_Sector_Antenna_Final Types Sec ' + n),
        antennaFinalCount: gn('AP_Sector_Antenna_Final Count Sec ' + n),
        combinerType:      g('AP_Sector_Antenna_Combiner Addition Type Sec ' + n),
        combinerCount:     gn('AP_Sector_Antenna_Combiner Addition Count Sec ' + n),
        azimuth:           gn('AP_Sector_Antenna_Final Azimuth Sec ' + n),
        height:            gn('AP_Sector_Antenna_Final Height Sec ' + n),
        eTilt:             gn('AP_Sector_Antenna_Final E-Tilt Sec ' + n),
        mTilt:             gn('AP_Sector_Antenna_Final M-Tilt Sec ' + n),
        netAnt:            gn('AP_Sector_Antenna_Net Addition Ant Sec ' + n) || 0,
        netAau:            gn('AP_Sector_Antenna_Net Addition AAU Sec ' + n) || 0,
        netRru:            gn('AP_Sector_Antenna_Net Addition RRU Sec ' + n) || 0,
        radios: []
      };
      TECHS.forEach(t => {
        const m = g('AP_' + t + '_Radio addition Sec ' + n);
        if (!m) return;
        sec.radios.push({
          tech: t,
          model: m,
          shared: SHARE.test(m),
          noise: SOURCE_NOISE.test(m),
          source: g('AP_' + t + '_Radio addition source Sec ' + n)
        });
      });
      sec.active = !!(sec.antennaFinal || sec.antennaAdd || sec.radios.length || sec.azimuth != null);
      s.sectors.push(sec);
    }
    s.sectorCount = s.sectors.filter(x => x.active).length;

    /* ---- radios: one per distinct model per sector ---- */
    const rru = {}, sharedRefs = {}, whereModel = {};
    s.sectors.forEach(sec => {
      const seen = new Set();
      sec.radios.forEach(r => {
        if (r.noise) return;
        if (r.shared){ sharedRefs[r.model] = (sharedRefs[r.model] || 0) + 1; return; }
        if (seen.has(r.model)) return;
        seen.add(r.model);
        rru[r.model] = (rru[r.model] || 0) + 1;
        (whereModel[r.model] = whereModel[r.model] || []).push(sec.sector);
      });
      sec.rruModels = [...seen];
    });
    s.rruByModel     = rru;
    s.sharedRruRefs  = sharedRefs;
    s.rruSectors     = whereModel;
    s.rruCount       = Object.values(rru).reduce((a, b) => a + b, 0);

    /* ---- antennas ---- */
    const ant = {};
    s.sectors.forEach(sec => {
      const t = sec.antennaFinal || sec.antennaAdd;
      if (!t) return;
      if (/^\d+$/.test(String(t).trim())){        // a bare number is a slip in the source sheet
        s.flags.push('Sector ' + sec.sector + ' antenna type is just "' + t + '"');
        return;
      }
      const base = String(t).replace(/\(.*?\)/g, '').trim();
      const c = sec.antennaFinalCount != null ? sec.antennaFinalCount
              : (sec.antennaAddCount != null ? sec.antennaAddCount : 1);
      ant[base] = (ant[base] || 0) + c;
    });
    s.antennaByModel = ant;
    s.antennaCount   = Object.values(ant).reduce((a, b) => a + b, 0);

    s.combiners = {};
    s.sectors.forEach(sec => {
      if (sec.combinerType) s.combiners[sec.combinerType] = (s.combiners[sec.combinerType] || 0) + (sec.combinerCount || 1);
    });

    /* ---- what the sheet's own summary says ----
       These columns are stale on most sites. They are not trusted and not used;
       they are compared, and a disagreement is raised for a person to settle. */
    s.netRruTotal = s.sectors.reduce((a, x) => a + (x.netRru || 0), 0);
    s.netAntTotal = s.sectors.reduce((a, x) => a + (x.netAnt || 0), 0);
    s.netAauTotal = s.sectors.reduce((a, x) => a + (x.netAau || 0), 0);
    if (s.netRruTotal && s.netRruTotal !== s.rruCount) s.flags.push('RRU ' + s.rruCount + ' vs net ' + s.netRruTotal);
    if (s.netAntTotal && s.netAntTotal !== s.antennaCount) s.flags.push('Ant ' + s.antennaCount + ' vs net ' + s.netAntTotal);
    if (!s.sectorCount) s.flags.push('no active sector');
    s.sectors.forEach(sec => { if (sec.active && sec.azimuth == null) s.flags.push('Sector ' + sec.sector + ' has no azimuth'); });
    if (!s.txMode) s.flags.push('no TX row');

    /* ---- BBU and baseband ---- */
    const bank = pre => {
      const cards = kind => {
        const out = [];
        for (let i = 1; i <= 6; i++){
          /* the first card's heading carries a newline before "(slot 0)", which
             normalises to a space the others do not have */
          const v = g(pre + '_Baseband ' + kind + ' ' + i + ' (slot ' + (i - 1) + ')')
                 || g(pre + '_Baseband ' + kind + ' ' + i + '(slot ' + (i - 1) + ')');
          if (v) out.push({ slot: i - 1, card: v });
        }
        return out;
      };
      return {
        bbuExisting:      g(pre + '_BBU Existing'),
        bbuAddition:      g(pre + '_BBU Addition'),
        bbuFinal:         g(pre + '_BBU Final'),
        controlCardAdd:   g(pre + '_Control Board Card Addition Card Type'),
        controlCardFinal: g(pre + '_Control Board Card Final Card Type'),
        basebandAddCount: gn(pre + '_Baseband Addition Amount'),
        basebandAdd:      cards('Addition'),
        basebandFinal:    cards('Final'),
        gpsAntennaAdd:    g(pre + '_GPS Antenna Addition')
      };
    };
    s.lteMbb = bank('AP_LTE_MBB');
    s.lteHbb = bank('AP_LTE_HBB');
    s.g2 = {
      bbuExisting:   g('AP_2G_BBU Existing'),
      bbuAddition:   g('AP_2G_BBU Addition'),
      bbuFinal:      g('AP_2G_BBU Final'),
      basebandAdd:   g('AP_2G_Baseband card addition'),
      basebandFinal: g('AP_2G_Final Baseband configuration')
    };

    const uniq = a => a.filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i);
    s.bbuAddition   = uniq([s.lteMbb.bbuAddition, s.lteHbb.bbuAddition, s.g2.bbuAddition]);
    s.basebandCards = uniq([...s.lteMbb.basebandAdd, ...s.lteHbb.basebandAdd].map(c => c.card));
    s.controlCards  = uniq([s.lteMbb.controlCardAdd, s.lteHbb.controlCardAdd]);

    return s;
  }

  /* ------------------------------------------------------------ the whole */

  function extract(wb, XLSX){
    const ctx = parseWorkbook(wb, XLSX);
    return { ctx, sites: ctx.rows.map(r => extractSite(ctx, r)) };
  }

  /* What a site amounts to, in the order an engineer says it: how many
     sectors, how many radios, how many antennas, then which radios where. */
  function summarise(s){
    return {
      siteId: s.siteId,
      siteName: s.siteName,
      heightM: s.siteHeight,
      txMode: s.txMode,
      mwBand: s.mwBand,
      vendor: s.ftkVendor,
      sectors: s.sectorCount,
      rrus: s.rruCount,
      antennas: Object.entries(s.antennaByModel).map(([model, count]) => ({ model, count })),
      radios: Object.entries(s.rruByModel).map(([model, count]) => ({
        model, count, label: radioLabel(model), sectors: (s.rruSectors[model] || []).slice()
      })),
      shared: Object.entries(s.sharedRruRefs).map(([model, count]) => ({
        model, count, sectors: s.sectors.filter(x => x.radios.some(r => r.shared && r.model === model)).map(x => x.sector)
      })),
      flags: s.flags.slice()
    };
  }

  function envelope(sites, ctx){
    return {
      schema: 'emortia.design-extract/1',
      generatedAt: new Date().toISOString(),
      source: ctx ? { sheet: ctx.sheetName, headerRow: ctx.headerRow } : null,
      sites: sites
    };
  }

  return { TECHS, extract, parseWorkbook, extractSite, summarise, envelope, radioLabel,
           _internals: { norm, isBlank, val, num, findHeader, indexHeaders, vendor } };
});
