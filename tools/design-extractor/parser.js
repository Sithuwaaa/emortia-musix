/* Design sheet parser.

   Ported from docs/design-extractor/prototype.html, whose counting rules are
   already verified against the BOM database. Nothing here touches the DOM or
   the network: it takes a SheetJS workbook and gives back plain objects, so it
   runs the same under node for the tests as it does in the page.

   The one rule worth reading before changing anything: a multi-band radio is
   written into the sheet once per technology it carries, so RRU5909 serving
   G900 + L900 + L2100 in one sector fills three cells and is one unit. Count
   distinct models per sector, never cells. See countRadios below. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;   // node, for the tests
  else root.DesignParser = api;                                            // the page
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------- constants */

  const TECHS = ['G900', 'G1800', 'L850', 'L900', 'L1800', 'L2100',
                 'L2600', 'L2300(HBB)', 'L2300(MBB)'];

  // what the sheet writes when it means nothing
  const BLANK = new Set(['', '-', '–', 'n/a', '#n/a', 'na', 'null', 'none']);

  // "Share sec 2 L21 RRU" reuses a radio that is already up the pole
  const SHARE = /^\s*shared?\b/i;

  // where a radio came from, pasted into the column for what the radio is
  const SOURCE_NOISE = /^(dap wh|inhouse|in-house)/i;

  const SCHEMA = 'emortia.design-extract/1';

  /* ------------------------------------------------------------ helpers */

  const norm = v => v == null ? '' : String(v).replace(/\s+/g, ' ').trim();
  const isBlank = v => v == null || BLANK.has(norm(v).toLowerCase());
  const val = v => isBlank(v) ? null : (typeof v === 'number' ? v : norm(v));
  const num = v => { const n = parseFloat(val(v)); return Number.isFinite(n) ? n : null; };

  // Ericssion / Ericsson are the same vendor; §8 of the spec asks for this on read
  const vendor = v => { const s = val(v); return s ? String(s).replace(/ericssion/ig, 'Ericsson') : s; };

  /* ------------------------------------------------------- the workbook */

  function pickSheet(wb){
    return wb.SheetNames.find(n => /design\s*sheet/i.test(n)) || wb.SheetNames[0];
  }

  /* The header is found by what it contains, never by row number — the sheet
     gains and loses rows above it between batches. */
  function findHeader(grid){
    for (let i = 0; i < Math.min(grid.length, 20); i++){
      const set = new Set((grid[i] || []).map(c => norm(c).toLowerCase()));
      if (set.has('site id') && set.has('operation region')) return i;
    }
    return -1;
  }

  /* First occurrence wins: "New AP Batch Name" is written twice, at columns 2
     and 7, and the first is the one the rest of the row belongs to. */
  function indexHeaders(row){
    const idx = {};
    (row || []).forEach((h, i) => { const k = norm(h); if (k && !(k in idx)) idx[k] = i; });
    return idx;
  }

  /* Tx plan is not on the design sheet at all. It lives on TX, joined by site
     ID — some of which are written with a trailing full stop. */
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
    if (h < 0) throw new Error('No header row found. Expected a row carrying both "Site ID" and "Operation Region".');
    const idx = indexHeaders(grid[h]);
    const iId = idx['Site ID'];
    const rows = grid.slice(h + 1).filter(r =>
      r && !isBlank(r[iId]) && norm(r[iId]).toLowerCase() !== 'site id');
    return { sheetName, headerRow: h + 1, idx, rows, tx: parseTx(wb, XLSX) };
  }

  /* --------------------------------------------------------- one site */

  /* One physical radio per distinct model per sector.

     Shared entries name a radio that already exists, so they are set aside
     rather than counted; source strings that leaked into the model column are
     dropped outright. */
  function countRadios(sectors){
    const byModel = {}, sharedRefs = {};
    sectors.forEach(sec => {
      const seen = new Set();
      sec.radios.forEach(r => {
        if (r.noise) return;
        if (r.shared){ sharedRefs[r.model] = (sharedRefs[r.model] || 0) + 1; return; }
        if (seen.has(r.model)) return;                 // same unit, another band
        seen.add(r.model);
        byModel[r.model] = (byModel[r.model] || 0) + 1;
      });
      sec.rruModels = [...seen];
    });
    return { byModel, sharedRefs, total: Object.values(byModel).reduce((a, b) => a + b, 0) };
  }

  /* The model as it is written carries its bands in brackets —
     ADU451816v01(GSM_1, L21_A) is one antenna type, not several. */
  function countAntennas(sectors){
    const byModel = {};
    sectors.forEach(sec => {
      const t = sec.antennaFinal || sec.antennaAdd;
      if (!t) return;
      const base = String(t).replace(/\(.*?\)/g, '').trim();
      const c = sec.antennaFinalCount != null ? sec.antennaFinalCount
              : (sec.antennaAddCount != null ? sec.antennaAddCount : 1);
      byModel[base] = (byModel[base] || 0) + c;
    });
    return { byModel, total: Object.values(byModel).reduce((a, b) => a + b, 0) };
  }

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
    s.txMode = tx.txMode || null;
    s.mwMapping = tx.mwMapping || null;
    const b = /(\d{2})\s*G/.exec(s.mwMapping || '');
    s.mwBand = b ? b[1] + 'G' : null;

    // some cells read "Yes " with a trailing space
    s.technologies = TECHS.filter(t => /^y/i.test(g('AP_Upgrade_Flag_' + t) || ''));

    s.sectors = [];
    for (let n = 1; n <= 4; n++){
      const sec = {
        sector: n,
        changeScope:       g(`AP_Sector_Antenna/AAU_Change Scope Sec ${n}`),
        antennaAdd:        g(`AP_Sector_Antenna_Addition Type Sec ${n}`),
        antennaAddCount:   gn(`AP_Sector_Antenna_Addition Count Sec ${n}`),
        antennaSource:     g(`AP_Sector_Antenna_Addition Source Sec ${n}`),
        antennaFinal:      g(`AP_Sector_Antenna_Final Types Sec ${n}`),
        antennaFinalCount: gn(`AP_Sector_Antenna_Final Count Sec ${n}`),
        combinerType:      g(`AP_Sector_Antenna_Combiner Addition Type Sec ${n}`),
        combinerCount:     gn(`AP_Sector_Antenna_Combiner Addition Count Sec ${n}`),
        azimuth:           gn(`AP_Sector_Antenna_Final Azimuth Sec ${n}`),
        height:            gn(`AP_Sector_Antenna_Final Height Sec ${n}`),
        eTilt:             gn(`AP_Sector_Antenna_Final E-Tilt Sec ${n}`),
        mTilt:             gn(`AP_Sector_Antenna_Final M-Tilt Sec ${n}`),
        netAnt:            gn(`AP_Sector_Antenna_Net Addition Ant Sec ${n}`) || 0,
        netAau:            gn(`AP_Sector_Antenna_Net Addition AAU Sec ${n}`) || 0,
        netRru:            gn(`AP_Sector_Antenna_Net Addition RRU Sec ${n}`) || 0,
        radios: []
      };
      TECHS.forEach(t => {
        const m = g(`AP_${t}_Radio addition Sec ${n}`);
        if (!m) return;
        sec.radios.push({
          tech: t,
          model: m,
          shared: SHARE.test(m),
          noise: SOURCE_NOISE.test(m),
          source: g(`AP_${t}_Radio addition source Sec ${n}`)
        });
      });
      sec.active = !!(sec.antennaFinal || sec.antennaAdd || sec.radios.length || sec.azimuth != null);
      s.sectors.push(sec);
    }
    s.sectorCount = s.sectors.filter(x => x.active).length;

    const rru = countRadios(s.sectors);
    s.rruByModel = rru.byModel;
    s.sharedRruRefs = rru.sharedRefs;
    s.rruCount = rru.total;

    const ant = countAntennas(s.sectors);
    s.antennaByModel = ant.byModel;
    s.antennaCount = ant.total;

    s.combiners = {};
    s.sectors.forEach(sec => {
      if (sec.combinerType)
        s.combiners[sec.combinerType] = (s.combiners[sec.combinerType] || 0) + (sec.combinerCount || 1);
    });

    /* The sheet's own summary columns are stale — they disagree with the sector
       blocks on most sites. Compute from the blocks, compare, and say so;
       never quietly pick one. */
    s.netRruTotal = s.sectors.reduce((a, x) => a + (x.netRru || 0), 0);
    s.netAntTotal = s.sectors.reduce((a, x) => a + (x.netAnt || 0), 0);
    s.netAauTotal = s.sectors.reduce((a, x) => a + (x.netAau || 0), 0);
    if (s.netRruTotal && s.netRruTotal !== s.rruCount) s.flags.push(`RRU ${s.rruCount} vs net ${s.netRruTotal}`);
    if (s.netAntTotal && s.netAntTotal !== s.antennaCount) s.flags.push(`Ant ${s.antennaCount} vs net ${s.netAntTotal}`);
    if (!s.sectorCount) s.flags.push('no active sector');
    s.sectors.forEach(sec => {
      if (sec.active && sec.azimuth == null) s.flags.push(`Sec ${sec.sector} azimuth missing`);
      // the bare value 1 turns up in 85 antenna-type cells: a slip at the source
      if (sec.antennaAdd != null && /^\d+$/.test(String(sec.antennaAdd)))
        s.flags.push(`Sec ${sec.sector} antenna type is a bare number`);
    });

    const bank = pre => {
      const cards = kind => {
        const out = [];
        for (let i = 1; i <= 6; i++){
          // the i=1 header carries a newline before "(slot 0)"; after
          // normalising it gains a space the others do not have
          const v = g(`${pre}_Baseband ${kind} ${i} (slot ${i - 1})`)
                 ?? g(`${pre}_Baseband ${kind} ${i}(slot ${i - 1})`);
          if (v) out.push({ slot: i - 1, card: v });
        }
        return out;
      };
      return {
        bbuExisting:      g(`${pre}_BBU Existing`),
        bbuAddition:      g(`${pre}_BBU Addition`),
        bbuFinal:         g(`${pre}_BBU Final`),
        controlCardAdd:   g(`${pre}_Control Board Card Addition Card Type`),
        controlCardFinal: g(`${pre}_Control Board Card Final Card Type`),
        basebandAddCount: gn(`${pre}_Baseband Addition Amount`),
        basebandAdd:      cards('Addition'),
        basebandFinal:    cards('Final'),
        gpsAntennaAdd:    g(`${pre}_GPS Antenna Addition`)
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
    s.basebandCards = [...s.lteMbb.basebandAdd, ...s.lteHbb.basebandAdd].map(c => c.card);
    s.controlCards  = uniq([s.lteMbb.controlCardAdd, s.lteHbb.controlCardAdd]);
    return s;
  }

  /* ------------------------------------------------- reading it back out */

  /* The engineer describes a radio by the job it does, not by its part number:
     "L21 RRU 3යි" rather than "RRU5909 ×3". The label comes from the
     technologies that model carries in that sector, which is also how the BOM
     names the material — RRU5910 (GL900), RRU 5909(L21). */
  const TECH_SHORT = { 'G900':'G9', 'G1800':'G18', 'L850':'L8', 'L900':'L9',
                       'L1800':'L18', 'L2100':'L21', 'L2600':'L26',
                       'L2300(HBB)':'L23H', 'L2300(MBB)':'L23M' };

  function techLabel(techs){
    const set = new Set(techs);
    // a unit carrying both G900 and L900 is spoken of as one thing
    if (set.size === 2 && set.has('G900') && set.has('L900')) return 'GL900';
    return techs.map(t => TECH_SHORT[t] || t).join('+');
  }

  /* One entry per radio role: which model, what it carries, how many, and the
     sectors it stands in — plus the ones that are shared rather than new. */
  function radioRoles(site){
    const roles = {}, shared = {};
    site.sectors.forEach(sec => {
      if (!sec.active) return;
      const byModel = {};
      sec.radios.forEach(r => {
        if (r.noise) return;
        if (r.shared){
          (shared[r.model] = shared[r.model] || { model: r.model, sectors: [] });
          if (!shared[r.model].sectors.includes(sec.sector)) shared[r.model].sectors.push(sec.sector);
          return;
        }
        (byModel[r.model] = byModel[r.model] || []).push(r.tech);
      });
      Object.entries(byModel).forEach(([model, techs]) => {
        const label = techLabel(techs);
        const k = label + '|' + model;
        (roles[k] = roles[k] || { label, model, count: 0, sectors: [] });
        roles[k].count++;
        roles[k].sectors.push(sec.sector);
      });
    });
    return { roles: Object.values(roles), shared: Object.values(shared) };
  }

  /* The whole site in the shape it gets talked about. */
  function summarise(site){
    const { roles, shared } = radioRoles(site);
    return {
      siteId: site.siteId,
      siteName: site.siteName,
      heightM: site.siteHeight,
      txMode: site.txMode,
      mwBand: site.mwBand,
      vendor: site.ftkVendor,
      sectors: site.sectorCount,
      rrus: site.rruCount,
      antennas: Object.entries(site.antennaByModel).map(([model, count]) => ({ model, count })),
      radios: roles.sort((a, b) => a.label.localeCompare(b.label)),
      shared,
      flags: site.flags
    };
  }

  /* ------------------------------------------------------------- entry */

  function extract(wb, XLSX){
    const ctx = parseWorkbook(wb, XLSX);
    const sites = ctx.rows.map(r => extractSite(ctx, r));
    return { ctx, sites };
  }

  function envelope(sites, ctx){
    return {
      schema: SCHEMA,
      generatedAt: new Date().toISOString(),
      source: { sheet: ctx.sheetName, headerRow: ctx.headerRow },
      sites
    };
  }

  return { SCHEMA, TECHS, norm, isBlank, val, num,
           pickSheet, findHeader, indexHeaders, parseTx, parseWorkbook,
           countRadios, countAntennas, extractSite, extract, envelope,
           techLabel, radioRoles, summarise };
});
