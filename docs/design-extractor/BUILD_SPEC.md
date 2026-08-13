# Design Sheet Extractor — build spec

**For:** Claude Code, working in the `Sithuwaaa/emortia-musix` repo
**Goal:** upload the Dialog MBB design workbook → read the fields the BOM needs → hand them to the existing BOM Builder.
**Prototype:** `design-extractor.html` (single file, works today — use it as the reference implementation).

---

## 1. What the two files actually are

**Input — `2026_MBB_New_Sites_Design_*.xlsx`, sheet `Design Sheet`**
765 columns × ~245 site rows. Header on **row 4**, data from **row 6**. Row 5 is a sub-header used only by the summary block at the far right.

**Output — `Master_LP_BOM_Database.xlsx`**
A matrix, not a list. Rows are materials (`Category` / `Material Detail` / `Unit` / `Remarks`), columns are sites. The site header block above the materials carries `Site ID`, `Site Name`, `Tx plan`, `Vendor`, `Site Height (m)`, `Team`, a `Delivery Status` row, and a `Sum` note reading e.g. `3 Sectors / 5 RRUs`.

The extractor's job is to produce, per site, exactly the inputs that block needs plus the equipment counts the material quantities are derived from.

---

## 2. Column contract

Never hard-code column letters or indexes — the design sheet gains and loses columns between batches. **Look every field up by header text.** Normalise headers first: replace all whitespace runs (including the embedded newlines in the baseband headers) with a single space, then trim.

**Finding the header row:** scan the first 20 rows for the one containing both `Site ID` and `Operation Region`.

**Duplicate headers:** `New AP Batch Name` appears at columns 2 and 7. First occurrence wins.

### Site identity and context — direct lookups

| Field | Header |
|---|---|
| Batch Name | `New AP Batch Name` |
| Site ID / Name | `Site ID`, `Site Name` |
| Operation Region | `Operation Region` |
| AP Region / District | `AP Region`, `District` |
| Supply model | `FTK or In-House` |
| FTK Vendor | `FTK Vendor` — `Huawei` or `Ericsson` |
| Site Owner | `Site Owner` |
| Site Type | `Site Type` — `Lamp-Pole`, `GB-Tower(SS)`, `Macro`, `Sharing`, `Tree`, … |
| Site Height | `Site Height` |
| Scope | `AP_Project_Scope` |
| Coordinates | `Finalized Latitude`, `Finalized Longitude` |

### Technologies

Nine flags, `Yes` / `No`. Note some cells are `"Yes "` with a trailing space — match on `/^y/i`.

```
AP_Upgrade_Flag_G900   AP_Upgrade_Flag_G1800  AP_Upgrade_Flag_L850
AP_Upgrade_Flag_L900   AP_Upgrade_Flag_L1800  AP_Upgrade_Flag_L2100
AP_Upgrade_Flag_L2600  AP_Upgrade_Flag_L2300(HBB)  AP_Upgrade_Flag_L2300(MBB)
```

### RRU types — per technology, per sector

For each of the nine technologies `T` and each sector `n` in 1–4:

```
AP_{T}_Radio addition Sec {n}          → model string
AP_{T}_Radio addition source Sec {n}   → where it comes from
AP_{T}_Radio removal Sec {n}
AP_{T}_Radio Final configuration Sec {n}     (LTE naming)
AP_{T}_Final Radio configuration Sec {n}     (G900 / G1800 naming — note the word order flips)
```

Observed models: `RRU5909`, `RRU5910`, `RRU 4490 B1+B3`, `Radio 2271`, `Radio 4415`, `Radio 4499`, `RRU12B1`, `RRU5258`, `RRU5501`, `12B3`, `13B1`.

### Antennas, azimuth, tilts — per sector

For sector `n` in 1–4:

```
AP_Sector_Antenna/AAU_Change Scope Sec {n}
AP_Sector_Antenna_Addition Type Sec {n}      / _Addition Count Sec {n} / _Addition Source Sec {n}
AP_Sector_Antenna_Final Types Sec {n}        / _Final Count Sec {n}
AP_Sector_Antenna_Combiner Addition Type Sec {n} / _Combiner Addition Count Sec {n}
AP_Sector_Antenna_Final Azimuth Sec {n}
AP_Sector_Antenna_Final Height Sec {n}
AP_Sector_Antenna_Final E-Tilt Sec {n}
AP_Sector_Antenna_Final M-Tilt Sec {n}
AP_Sector_Antenna_Net Addition Ant Sec {n} / _Net Addition AAU Sec {n} / _Net Addition RRU Sec {n}
```

### BBU and baseband

Three banks, same shape. Prefixes: `AP_LTE_MBB`, `AP_LTE_HBB`, and `AP_2G` (2G is flatter — see below).

```
{P}_BBU Existing / _BBU Addition / _BBU Final
{P}_Control Board Card Addition Card Type / _Control Board Card Final Card Type
{P}_Baseband Addition Amount
{P}_Baseband Addition {i}(slot {i-1})     for i = 1..6
{P}_Baseband Final {i}(slot {i-1})        for i = 1..6
{P}_GPS Antenna Addition
```

**Gotcha:** the `i = 1` headers contain a literal newline before `(slot 0)`. After whitespace normalisation this becomes `... Addition 1 (slot 0)` — with a space that `i = 2..6` don't have. Try both spellings.

2G bank: `AP_2G_BBU Existing / Addition / Final`, `AP_2G_Baseband card addition`, `AP_2G_Final Baseband configuration`.

Observed BBUs: `BBU3910`, `BBU5900`, `BB6631`, `BB6630`.
Baseband cards: `UBBPg1a`, `UBBPg1`, `UBBPg2`, `UBBPd2`, `UBBPd4`, `UBBPd6`, `UBBPe4`, `UBBPe6`, `BB5216`.
Control cards: `UMPTb1`, `UMPTb2`, `UMPTe1`, `UMPTe2`, `UMPTg2`.

### TX plan — second sheet

The BOM needs `Tx plan`, and it is **not** on the Design Sheet. Read sheet `TX`, header on row 1, and join on `Site ID` (strip a trailing `.` — some IDs are written `HA0074.`).

```
TX Mode      → MW-HYB | OFN | WiBAS | OFN/MW-HYB
MW Mapping   → e.g. "18G3345" — leading 2 digits + G give the band (18G / 23G / 10G)
WO ID
```

MW band drives ODU selection (`18G-H (Huawei)`, `23G-L (Ericsson)`, `10G-H (Wi-Bas)` …), and TX Mode drives whether the site takes an IDU, a Wi-Bas POE, or neither.

---

## 3. The counting rules (this is the part that matters)

### Blank values
Treat as empty: `null`, `""`, `-`, `–`, `N/A`, `#N/A`, `NA`.

### Sector count
A sector is active if **any** of: `Final Types`, `Addition Type`, a radio addition on any technology, or a non-null azimuth. Count active sectors.
Observed spread: 3 sectors (221 sites), 4 sectors (18), 2 sectors (6).

### RRU count — one physical radio per *distinct model* per sector

A multi-band radio is written once **per technology it carries**. `RRU5909` serving G900 + L900 + L2100 in sector 1 appears in three cells but is one unit. Counting cells triples the number.

```
for each sector:
    models = distinct non-shared model strings across all 9 technologies
    rruCount += models.length
    for each model: rruByModel[model] += 1
```

**Exclusions before counting:**
- Anything matching `/^shared?\b/i` — `"Share sec 2 L21 (B1+B3) RRU"`, `"Shared Sec 01 RRU5501"`. These reuse an existing radio, so no new hardware. Keep them in a separate `sharedRruRefs` field for reference.
- Source strings that leaked into the model column — `"DAP WH"`, `"DAP WH-Sasika"`.

**This rule is verified against the BOM database.** Two sites appear in both files:

| Site | Design sheet → rule output | `July Target V4` BOM says |
|---|---|---|
| MU5051 | 3 sectors, 5 RRUs, `RRU5909×3 + RRU5910×2` | `3 Sectors / 5 RRUs`; `RRU 5909(L21)` = 3, `RRU5910 (GL900)` = 2 |
| KI5032 | 4 sectors, 6 RRUs | `4 Sectors / 6 RRUs` |

### Antenna count
Per active sector take `Final Types` (fall back to `Addition Type`), strip any parenthetical suffix — `ADU451816v01(GSM_1, L21_A, L9_A)` → `ADU451816v01` — and add `Final Count` (fall back to `Addition Count`, default 1). MU5051 gives `SXPWL4WH-16/18-65/65-IVT-R1_10P × 3`, matching the BOM.

### Do not trust these columns
Columns 691–712 (`Sec_01 Net RRU`, `Total RRU Adition Count`, …) are a stale summary block. On AM5155 they report 2/2/1 where the sector blocks report 2/2/2. On MU5051 and KI5032 the per-sector `Net Addition RRU` cells are 0 even though radios are planned.

**Compute from the sector blocks. Compare to the net columns. Flag disagreements rather than silently picking one.** The prototype raises `RRU 5 vs net 0` and shows it in amber.

### Other flags worth raising
- Active sector with no azimuth
- Site with zero active sectors
- `Addition Type` containing a bare number (the value `1` shows up in 85 antenna-type cells — a data-entry slip in the source sheet)

---

## 4. Output shape

One JSON envelope, versioned, so the BOM Builder can reject a stale format:

```jsonc
{
  "schema": "emortia.design-extract/1",
  "generatedAt": "2026-08-13T…",
  "source": { "sheet": "Design Sheet", "headerRow": 4 },
  "sites": [{
    "siteId": "MU5051", "siteName": "Iyankankulam_Lamp",
    "batchName": "…", "operationRegion": "Northern", "district": "Mullaitivu",
    "ftkVendor": "Huawei", "ftkOrInhouse": "Inhouse", "siteOwner": "ESLL",
    "siteType": "Lamp-Pole", "siteHeight": 20,
    "txMode": "MW-HYB", "mwMapping": "18G2695", "mwBand": "18G",
    "latitude": 9.12, "longitude": 80.44,
    "technologies": ["G900","L900","L2100"],
    "sectorCount": 3, "antennaCount": 3, "rruCount": 5,
    "antennaByModel": { "SXPWL4WH-16/18-65/65-IVT-R1_10P": 3 },
    "rruByModel": { "RRU5909": 3, "RRU5910": 2 },
    "sharedRruRefs": {}, "combiners": {},
    "sectors": [{
      "sector": 1, "active": true,
      "antennaAdd": "…", "antennaAddCount": 1, "antennaFinal": "…", "antennaFinalCount": 1,
      "azimuth": 0, "height": 20, "eTilt": 2, "mTilt": 0,
      "netAnt": 1, "netAau": 0, "netRru": 0,
      "rruModels": ["RRU5909","RRU5910"],
      "radios": [{ "tech": "G900", "model": "RRU5910", "shared": false, "source": "DAP WH" }]
    }],
    "lteMbb": { "bbuAddition": "BBU3910", "controlCardAdd": "UMPTg2",
                "basebandAddCount": 1, "basebandAdd": [{ "slot": 0, "card": "UBBPg1a" }],
                "basebandFinal": [], "gpsAntennaAdd": null },
    "lteHbb": { … }, "g2": { … },
    "bbuAddition": ["BBU3910"], "basebandCards": ["UBBPg1a"], "controlCards": ["UMPTg2"],
    "flags": ["RRU 5 vs net 0"]
  }]
}
```

---

## 5. Integration with the existing BOM Builder

Two pieces, one contract. Do **not** merge the extractor into the BOM Builder page — keep them separate so a design-sheet format change can't break BOM generation.

```
/design-extractor/   reads the workbook, emits emortia.design-extract/1
        │
        ├── localStorage['emortia.bom.designPayload']   ← same-origin handoff
        └── download JSON                               ← manual / offline path
                    ↓
/bom-builder/?src=design   reads the key, prefills, then applies BOM rules
```

**On the BOM Builder side, add an import path:**

1. On load, if `?src=design` is present, read `localStorage['emortia.bom.designPayload']`.
2. Reject anything whose `schema` isn't `emortia.design-extract/1`. Show what it got.
3. Show an import preview — site count, batch, flagged sites — and require a click to commit. Never auto-overwrite work in progress.
4. Also accept a dropped `.json` file with the same schema, so the two tools work when opened from different devices.
5. Clear the key after a successful import.

**Field mapping into the BOM header block:**

| BOM header row | From |
|---|---|
| Site ID | `siteId` |
| Site Name | `siteName` |
| Tx plan | `txMode` |
| Vendor | `ftkVendor` |
| Site Height (m) | `siteHeight` |
| Team | left blank — assigned manually |
| Sum note | `` `${sectorCount} Sectors\n${rruCount} RRUs` `` |

**Quantity rules the BOM Builder should own** (the extractor supplies inputs, it does not decide materials):

- `LP RRU Bracket`, `RRU Power Cable`, `Fiber Cable (40m)` scale with `rruCount` and `siteHeight`
- `GSM Antenna` rows come from `antennaByModel` keys
- `Antenna GSM Pole (3m)`, `Clamp`, `Bonding`, ties scale with `sectorCount`
- `RRU with Brackets…` rows come from `rruByModel`, mapped model → material name (`RRU5910` → `RRU5910 (GL900)`, `RRU5909` → `RRU 5909(L21)`)
- `Huawei BBU3910 with UPEU…` / `BB6631 with Power Cables` from `bbuAddition`; `UMPTg2`, `UBBPg1a` from `controlCards` / `basebandCards`
- IDU, MW Antenna, ODU, SFP, Surge Arrestor rows from `txMode` + `mwBand` + `ftkVendor`
- Jumper lengths (`22-32 (3m)` / `22-32 (5m)` / `32-32 (3m)`) from `ftkVendor` + `siteHeight` — keep the existing manual override, this is the field's judgement call

Keep the model → material-name lookup in **one editable table** in the app, not scattered through the rules. New radio models turn up every batch.

---

## 6. Supabase (optional, phase 2)

Follows the existing pattern in `db.js`. Two tables, plus reuse of the dedupe fix already made there.

```sql
create table design_extracts (
  id uuid primary key default gen_random_uuid(),
  batch_name text not null,
  source_file text,
  extracted_at timestamptz default now(),
  device_id text,
  site_count int
);

create table design_sites (
  id uuid primary key default gen_random_uuid(),
  extract_id uuid references design_extracts(id) on delete cascade,
  site_id text not null,
  batch_name text not null,
  payload jsonb not null,          -- the per-site object from §4
  unique (extract_id, site_id)
);
create index on design_sites using gin (payload);
create index on design_sites (site_id);
```

Upsert on `(extract_id, site_id)`. Keep every extract rather than overwriting — being able to diff batch V3 against V4 is worth the rows.

---

## 7. Build order

1. Port the parser from `design-extractor.html` — `parseWorkbook`, `extractSite`, the rollup rules. Keep it as a standalone module with no DOM dependency so it can be unit-tested.
2. Write tests against the two verified sites before touching the UI. `MU5051` → 3 sectors / 5 RRUs / `{RRU5909:3, RRU5910:2}` / 3 antennas. `KI5032` → 4 sectors / 6 RRUs. Both must pass on the raw workbook.
3. Wire the UI (the prototype's layout is fine — filters, table, detail panel with the azimuth rose).
4. Add the JSON export and the localStorage handoff.
5. Add the import path on the BOM Builder side.
6. Supabase last, and only if cross-device access is actually wanted.

**Do not** rewrite the BOM quantity rules while doing this. The extractor's contract ends at the JSON envelope.

---

## 8. Known data problems in the source sheet

These are in the supplied workbook, not bugs to fix in code — surface them and let the engineer decide.

- Net-addition summary columns disagree with the sector blocks on most sites.
- `AP_Sector_Antenna_Addition Type Sec n` contains the bare value `1` on 85 cells.
- Source strings (`DAP WH`, `DAP WH-Sasika`) appear in radio *model* columns.
- Vendor is spelled `Ericssion` in some BTS-vendor cells, `Ericsson` elsewhere. Normalise on read.
- 49 of 245 sites have no TX row, so `txMode` comes back null.
- Site IDs occasionally carry a trailing `.` on the TX sheet.
