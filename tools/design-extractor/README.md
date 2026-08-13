# Design Sheet Extractor

Reads the Dialog MBB new-sites design workbook and pulls out what a BOM needs:
sectors, radios, antennas, and the Tx plan from the TX sheet.

Built to `docs/design-extractor/BUILD_SPEC.md`. The counting rules come from
`docs/design-extractor/prototype.html`, which was already verified against the
BOM database — they were ported, not re-derived.

## Where things are

| File | What it is |
|---|---|
| `parser.js` | The whole of it. No DOM, no network — takes a SheetJS workbook, returns plain objects, so the same code runs in the page and under node. |
| `parser.test.js` | Assertions against the real workbook. |

## Running the tests

The workbooks are not in the repository — it is public, and a design sheet
committed here is a design sheet published on the web. Put the file at
`samples/2026_MBB_New_Sites_Design__9_.xlsx` yourself, fetch SheetJS once, then
run:

```bash
mkdir -p .tools && curl -sL -o .tools/xlsx.js https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js
node tools/design-extractor/parser.test.js
```

Note it is SheetJS 0.20.2, not the 0.18.5 the browser tools load from cdnjs —
that build throws when required into node. And `XLSX.readFile` does not work
from the browser bundle either; read the bytes yourself and use `XLSX.read`.

## The rule that matters

A multi-band radio is written into the sheet **once per technology it carries**.
`RRU5909` serving G900 + L900 + L2100 in one sector fills three cells and is one
unit. Count distinct models per sector, never cells, or every count comes out
two to three times too high.

Two more exclusions before counting:

- anything reading `Share sec 2 …` names a radio already up the pole. Set aside
  into `sharedRruRefs`, not counted.
- `DAP WH` and friends are where a radio came from, pasted into the column for
  what the radio is. Dropped.

## Verified against

Three sites whose answers are known independently of this code:

| Site | Expected | From |
|---|---|---|
| MU5051 | 3 sectors, 5 RRUs, `RRU5909×3 + RRU5910×2`, 3 antennas | the BOM database |
| KI5032 | 4 sectors, 6 RRUs | the BOM database |
| VA5038 | 3 sectors, 6 RRUs, L21×3 / L18×1 / GL900×2, sector 3 sharing sector 2's GL900 | read off the sheet by hand |

VA5038 is the one that exercises the shared-radio path — without it, six radios
could be counted as seven and both other sites would still pass.

The whole-book figures also match the spec's own survey: 245 sites, sector
spread 3×221 / 4×18 / 2×6, and 49 sites with no TX row.

## Do not trust

The sheet's net-addition summary columns (691–712) are stale and disagree with
the sector blocks on most sites. The parser computes from the blocks, compares,
and raises a flag on the difference rather than quietly picking one. 103 of the
245 sites carry at least one flag.
