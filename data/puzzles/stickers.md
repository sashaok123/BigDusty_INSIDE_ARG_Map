# 108-cell sticker puzzle (iam8bit Collector's Edition)

## Status

**Partial.** 65 of 108 residues are confirmed from 81 community-collected stickers. The first community-resolved hard residue (`#445 -> residue 13 = G`) was logged on 2026-03-09. 8 hard residues with confidence below 0.55 remain open. Symbol assignment is *not* a deterministic function of the residue, so the remaining cells need either physical confirmation or a layout-driven insight.

## TLDR

- Each INSIDE iam8bit CE box ships with one printed sticker carrying a chain number in the range `[001 .. 597]` and one of three symbols: `/`, `-`, `*` (bullet).
- Residue `r = chain_number % 108` (NOT `(chain_number - 1) % 108`).
- The 108 residues map onto a **12-row x 9-column grid** addressed row-major (`row = r // 9`, `col = r % 9`).
- Best deterministic feature is `r mod 54` at 84.6% accuracy. No perfect mathematical mapping exists.
- 8 residues are currently flagged as hard targets for community confirmation.

## Background

The Collector's Edition (released by iam8bit, c. 2018) shipped with a single physical sticker, randomly numbered, slotted into a stack inside the Huddle. Community member Raezores has tracked over a hundred sticker findings since 2019; twinysam mirrors the corpus at `https://github.com/twinysam/INSIDE-ARG`. Each sticker contributes:

1. A chain number `N` in `[1, 597]` (highest seen so far).
2. One of three symbol classes: slash `/`, dash `-`, bullet `*` (rendered as `BULLET`).
3. A 9-piece puzzle image marker `A..I`, which is decorative for the cryptographic puzzle but useful as a forgery-detection signal.

The hypothesised chain length is `648 = 6 x 108`, the smallest multiple of 108 above the highest observed number 597. This implies 6 copies of each residue in production and 51 sticker chain numbers `(#598..#648)` that physically exist but the community has never found.

> **Established facts (from `tasks/lessons.md`)**:
> The INSIDE ARG sticker `mod 108` puzzle uses a **12-row x 9-column** layout (NOT 9x12), addressed row-major: `row = residue // 9, col = residue % 9`. Top 9 rows (residues 0..80) only contain `/` or `-`. Bottom 3 rows (residues 81..107) only contain `/` or `BULLET`. This is consistent across `sticker_9x12_decoder.py`, `sticker_pattern_finder.py`, and `9x12_analysis_report.md`.

## Current state

| metric | value |
|---|---|
| Stickers collected | 81 |
| Lost / disposed | 40 (Raezores' `L` register) |
| Owner unknown / awaiting reply | 25 (`U` register) |
| Residues known | 65 of 108 |
| Residues predicted | 43 |
| Hard residues (confidence below 0.55) | 8 |
| Chain numbers wanted for proof | 48 |

The 8 hard residues and their proof-chain numbers:

| residue | zone | predicted | conf | chain numbers wanted |
|---|---|---|---|---|
| 8   | TOP    | G (slash) | 0.524 | 8, 116, 224, 332, 440, 548 |
| 28  | TOP    | G (slash) | 0.511 | 28, 136, 244, 352, 460, 568 |
| 34  | TOP    | R (dash)  | 0.520 | 34, 142, 250, 358, 466, 574 |
| 68  | TOP    | R (dash)  | 0.519 | 68, 176, 284, 392, 500, 608 |
| 77  | TOP    | R (dash)  | 0.507 | 77, 185, 293, 401, 509, 617 |
| 100 | BOTTOM | G (slash) | 0.539 | 100, 208, 316, 424, 532, 640 |
| 102 | BOTTOM | Y (dot)   | 0.546 | 102, 210, 318, 426, 534, 642 |
| 104 | BOTTOM | G (slash) | 0.536 | 104, 212, 320, 428, 536, 644 |

> **Residue formula (verified 2026-05-12)**:
> `residue = N % 108` (NOT `(N-1) % 108`). All 80 community-collected sticker files match `KNOWN[N % 108]` with zero mismatches. The alternative gives 26 mismatches.
> Chain numbers for residue `r`: `{r, r+108, r+216, r+324, r+432, r+540}` for `r > 0`; for `r = 0` they are `{108, 216, 324, 432, 540, 648}`.

## Techniques tried

Cryptographic / steganographic approaches that have been attempted, with their outcomes. Each item is a single experiment; negative results are kept on the list for BHKR and the wider community to avoid repeating work.

### Mathematical / structural

- **Single-residue-bit partitions** (bits 0..6) - tested, no clean split.
- **All 21 pairs and 35 triples of residue bits** - exhaustive search, no perfect split.
- **Modular partitions** for `K in {2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 16, 18, 27, 36, 54}` - best is `r mod 54` at 84.6% (not deterministic).
- **Grid coordinates** (row, col, anti / main diagonal, row * col) - no clean partition.
- **Chebyshev / Manhattan / squared distance** from centre `(4, 4)` - no signal.
- **Popcount, digit sum, digital root, primality** of `r` - no signal.
- **Conway's Game of Life** with the known grid as seed - no recognised glyph after N iterations in tested ranges.
- **Coupon-collector** on the 108-residue assumption (`code/loose_scripts/chain_length_coupon.py`) - chain length 648 is consistent with 81 draws producing 65 unique residues (within 1 sigma of mean).

### Image / pixel-level

- **Pixel morphology + channel statistics** on 79 of 80 stickers - 4 morphology outliers + 4 channel outliers - all explained by transfer ghost halos, crop distance and ambient light cast. No hidden pigment signal beyond the known three symbols.
- **Sticker pixel pairs at the same residue** - NCC vs IoU disconnect on residue 9 pair (`118 vs 334`): NCC = 0.43, IoU = 0.992 - confirms variance is photo noise.
- **Slash orientation audit** on 45 slashes - 45/45 lean forward, mean +56.5deg, std 4.4deg. No back-slash class. One outlier (`#317 @ +77.5deg`) is camera rotation, not a sign flip.
- **Foreground extraction with ring-mean gate** - robust against bright wall backgrounds; 80/80 stickers measured without failure.

### Cross-list overlays

- **External 108-element table overlay** (`code/loose_scripts/external_table_overlay.py`) against:
  - Messier catalogue M1..M108
  - 108 Stars of Destiny (Water Margin)
  - 108 Upanishads (Muktika)
  - 108 Vishnu Sahasranama names
  - Periodic table 1..108

  All five tables produced no rare ARG-specific term in the R/Y residue projections. Surviving hits are common English words (PLANET in "Planetary nebula", LIFE / FOREST in Outlaws English nickname glosses, PROT / FORD inside Protactinium / Rutherfordium). G-baseline control eliminated all of them as content noise.

- **Printer-image overlay** at the 12x9 grid (`code/loose_scripts/sticker_overlay_on_printer.py`) - chi2 = 18.89, dof = 4, `p = 0.0008` rejects independence: Y is over-represented in dark cells (12/36) and absent from bright cells (0/36). So symbol class correlates with the underlying printer image, but the correlation is not a direct lookup.

### Prediction engine

- **Zone-aware partner voting** (`code/predict_648_chain.py`). Every period's forward / backward walk plus row / column tally filters partners by zone (TOP = 0..80, BOTTOM = 81..107). Cross-zone mode kept in parallel; both written to `predicted_compare.md`. The first community resolution (`#445 -> 13 = G`) falsified zoned `R/0.534` and confirmed cross `G/0.560` - one data point, not a generalisation.

### Brute force (negative results, kept for inventory)

- **GPU-side combinatorial unranking** brute over the unknown space, Hamming radius up to 10 on 2x RTX 4090 (`code/sticker_mod54_gpu/`) - ~10 min wall time. No structural decoder match in `gpu_check_survivors.bin`.
- **Numba CPU parallel exotic decoders** (Morse, Braille, binary row/column scans on the survivor masks) - no clean message above the validity gate.

## References

- twinysam mirror (canonical sticker corpus): https://github.com/twinysam/INSIDE-ARG
- Reddit weekly thread tag: r/PlaydeadsInside flair `Stickers`
- Our prediction engine: `code/predict_648_chain.py`
- Our GUI tool: `code/sticker_random_gen.py` (run with `python code/sticker_random_gen.py`)
- Proof-stickers wanted list: `reports/proof_stickers.md`
- 12x9 analysis report (DarkMatter et al.): `D:\INSIDE_RE\ARG\arg_graph_tiles\9x12_analysis_report.md`

## Open questions

- Whether the layout is really 12 rows by 9 cols, OR an isomorphic 9-piece grouping with internal 4x3 sub-blocks. Motif overlap test (`code/loose_scripts/motif_overlap_test.py`, 2026-05-13) returned `p = 0.813` against a zone-aware null, so no significant cross-layout signal.
- Whether the printer-image correlation (`p = 0.0008`) is a designer's hand-printed hint or a coincidence of how the printer's dark pixels happen to align with cells the designer also wanted to mark with bullets.
- Whether ONE physical confirmation per hard residue (48 chain numbers wanted) will collapse the prediction into a closed-form rule. Resolving residue 13 propagated to residues 49 and 67 via the column-vote partner: more resolutions plus column-feature instrumentation should clarify this.
- The 51 chain numbers `(#598 .. #648)` that are predicted to exist but have never been sighted - are they on shelves somewhere, were the boxes pulped, or is the chain shorter than 648?
