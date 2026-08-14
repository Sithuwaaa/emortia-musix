# Design Extractor

Reads the Dialog MBB new-sites design workbook and pulls out what a bill of
materials needs: how many sectors, how many radios and of which model, how many
antennas, the TX plan, the BBU and baseband cards.

- `parser.js` — the reading. No DOM, no network; SheetJS is handed in rather
  than imported, which is what lets the same file run in the browser and under
  node against the real workbook.
- `parser.test.js` — runs the parser against a real batch and checks the counts.
- `index.html` — the tool.

## Running the tests

The workbook is **not** in the repository. Everything here is served, so
committing it would publish a Dialog design sheet — coordinates and all — at
`emortia.com/samples/`. Put a batch workbook here yourself:

```
samples/2026_MBB_New_Sites_Design__9_.xlsx
```

then:

```bash
node tools/design-extractor/parser.test.js
```

SheetJS is found automatically if it is installed or cached; otherwise point at
a copy:

```bash
node tools/design-extractor/parser.test.js --sheetjs path/to/xlsx.full.min.js
```

To look at one site rather than assert anything:

```bash
node tools/design-extractor/parser.test.js MU5051
```

## The rule that matters

A multi-band radio is written into the sheet **once per technology it carries**.
`RRU5909` serving G900, L900 and L2100 in sector 1 fills three cells and is one
physical unit. Counting cells triples the site.

So a radio is counted **once per distinct model per sector**, after dropping:

- anything matching `/^shared?\b/i` — that sector is fed from a radio already on
  the pole, so it is not hardware to order. Kept in `sharedRruRefs`.
- source strings that leaked into the model column (`DAP WH`).

MU5051 is the worked example, and it is why the rule is written this way:

```
sec 1   G900=RRU5910, L900=RRU5910, L2100=RRU5909      → 2 radios
sec 2   G900=RRU5910, L900=RRU5910, L2100=RRU5909      → 2 radios
sec 3   G900=Share sec 2 L9 RRU, L900=Share…, L2100=RRU5909 → 1 radio
```

Nine cells, five radios. The July Target BOM, built by hand from the same
design, says `3 Sectors / 5 RRUs` with `RRU 5909(L21)` × 3 and
`RRU5910 (GL900)` × 2. The parser agrees, and `KI5032` agrees at 4 sectors /
6 RRUs. Those two sites are the only ones whose answers are known
independently, which is why the tests assert on them and nothing else.

## What is not trusted

The sheet carries its own net-addition summary columns. They are stale on most
sites — on MU5051 they read 0 where five radios are planned. They are never
used, only compared, and a disagreement becomes a flag for a person to settle.
53 of 245 sites in batch 9 carry at least one.

Also expected, and flagged rather than fixed:

- 49 of 245 sites have no row on the TX sheet, so `txMode` is null
- `Addition Type` holds a bare `1` on some sectors — a slip in the source
- vendor is spelled `Ericssion` in places; normalised on read
- some site IDs carry a trailing `.` on the TX sheet only

## Output

One versioned envelope, `emortia.design-extract/1`, so the BOM Builder can
refuse a stale shape. The tool hands it over in
`localStorage['emortia.bom.designPayload']`, or as a downloaded `.json` when the
two tools are open on different machines.

The extractor's job ends there. It supplies inputs; it does not decide
materials — those rules belong to the BOM Builder.
