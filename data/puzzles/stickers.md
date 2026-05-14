# 108-cell sticker puzzle (iam8bit Collector's Edition)

Status: partial. 65 of 108 residues nailed down from 81 community-collected stickers. The first community-resolved hard residue (`#445 -> residue 13 = G`) landed on 2026-03-09. 8 residues still sit below 0.55 confidence. Symbol assignment is not a clean function of the residue, so the rest needs physical confirmation or a fresh layout insight.

Each iam8bit CE box ships with one printed sticker. Each sticker has a chain number in `[001..597]` and one of three symbols: `/`, `-`, `*` (bullet). The residue is `r = chain_number % 108` (not `(chain_number - 1) % 108`). The 108 residues map onto a 12-row x 9-column grid, row-major (`row = r // 9`, `col = r % 9`). Best mathematical feature so far is `r mod 54` at 84.6% accuracy. No perfect rule.

Top 9 rows (residues 0..80) only show `/` or `-`. Bottom 3 rows (residues 81..107) only show `/` or bullet. That zone split holds across every analysis we've run.

Hypothesised chain length: `648 = 6 x 108`, the smallest multiple of 108 above the highest observed chain number 597. That implies 6 copies of every residue in production and 51 chain numbers (`#598..#648`) that physically exist but nobody has found.

## Numbers

| metric | value |
|---|---|
| Stickers collected | 81 |
| Lost / disposed | 40 (Raezores' `L` register) |
| Owner unknown / awaiting reply | 25 (`U` register) |
| Residues known | 65 of 108 |
| Residues predicted | 43 |
| Hard residues (conf < 0.55) | 8 |
| Chain numbers wanted for proof | 48 |

The 8 hard residues and the chain numbers we still want:

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

Chain numbers for residue `r > 0`: `{r, r+108, r+216, r+324, r+432, r+540}`. For `r = 0`: `{108, 216, 324, 432, 540, 648}`.

## What's been tried

Mathematical and structural:

- Single residue bits 0..6: no clean split.
- All 21 pairs and 35 triples of residue bits: exhaustive, no perfect split.
- Modular partitions for `K in {2,3,4,5,6,7,8,9,11,12,13,14,16,18,27,36,54}`: best is `r mod 54` at 84.6%.
- Grid coordinates (row, col, anti / main diagonal, row * col): no clean partition.
- Chebyshev / Manhattan / squared distance from centre (4, 4): nothing.
- Popcount, digit sum, digital root, primality of `r`: nothing.
- Conway's Game of Life seeded with the known grid: no recognisable glyph after N iterations.
- Coupon-collector on the 108-residue assumption (`code/loose_scripts/chain_length_coupon.py`): chain length 648 sits within 1 sigma of the mean for 81 draws producing 65 unique residues.

Image and pixel level:

- Pixel morphology + channel statistics on 79 of 80 stickers: 4 morphology outliers + 4 channel outliers, all explained by transfer ghost halos, crop distance and ambient light cast. No hidden pigment signal.
- Sticker pairs at the same residue: NCC vs IoU disconnect on the residue 9 pair (`118 vs 334`): NCC = 0.43, IoU = 0.992. Variance is photo noise.
- Slash orientation audit on 45 slashes: every one leans forward, mean +56.5deg, std 4.4deg. No back-slash class. One outlier (`#317 @ +77.5deg`) is camera rotation, not a sign flip.
- Foreground extraction with ring-mean gate: 80/80 stickers measured without failure, even against bright wall backgrounds.

Cross-list overlays (`code/loose_scripts/external_table_overlay.py`) tested against:

- Messier catalogue M1..M108
- 108 Stars of Destiny (Water Margin)
- 108 Upanishads (Muktika)
- 108 Vishnu Sahasranama names
- Periodic table 1..108

None of those produced a rare ARG-specific term in the R/Y projections. The hits that survived (PLANET inside "Planetary nebula", LIFE / FOREST inside Outlaws English nickname glosses, PROT / FORD inside Protactinium / Rutherfordium) are common English fragments and get killed by the G-baseline control.

Printer-image overlay at the 12x9 grid (`code/loose_scripts/sticker_overlay_on_printer.py`): chi2 = 18.89, dof = 4, `p = 0.0008` rejects independence. Y is over-represented in dark cells (12/36) and absent from bright cells (0/36). So symbol class correlates with the underlying printer image, but it's not a direct lookup.

Prediction engine (`code/predict_648_chain.py`): zone-aware partner voting, each period's forward / backward walk plus row / column tally, partners filtered by zone (TOP = 0..80, BOTTOM = 81..107). Cross-zone mode kept in parallel; both go to `predicted_compare.md`. The first community resolution (`#445 -> 13 = G`) falsified zoned `R/0.534` and confirmed cross `G/0.560`. One data point, not a rule.

Brute force (negative, kept for inventory): GPU combinatorial unranking on 2x RTX 4090 (`code/sticker_mod54_gpu/`), Hamming radius up to 10, ~10 min wall time. No structural decoder match in `gpu_check_survivors.bin`. Numba CPU exotic decoders (Morse, Braille, binary row/column scans) on the survivor masks: no clean message above the validity gate.

## References

- twinysam mirror (canonical sticker corpus): https://github.com/twinysam/INSIDE-ARG
- Reddit weekly thread tag: r/PlaydeadsInside flair `Stickers`
- Our prediction engine: `code/predict_648_chain.py`
- Our GUI tool: `code/sticker_random_gen.py` (run with `python code/sticker_random_gen.py`)
- Proof-stickers wanted list: `reports/proof_stickers.md`
- 12x9 analysis report (DarkMatter et al.): `D:\INSIDE_RE\ARG\arg_graph_tiles\9x12_analysis_report.md`

## Still open

- Is the layout really 12x9, or an isomorphic 9-piece grouping with internal 4x3 sub-blocks? Motif overlap test (`code/loose_scripts/motif_overlap_test.py`, 2026-05-13) returned `p = 0.813` against a zone-aware null. No significant cross-layout signal.
- Is the printer-image correlation (`p = 0.0008`) a designer hint, or do the printer's dark pixels happen to align with cells the designer wanted to mark with bullets for unrelated reasons?
- Will one physical confirmation per hard residue (48 chain numbers wanted) collapse the prediction into a closed-form rule? Resolving residue 13 propagated to residues 49 and 67 via the column-vote partner, so more resolutions plus column-feature instrumentation might do it.
- The 51 chain numbers (`#598..#648`) predicted to exist but never sighted: are they on shelves somewhere, were the boxes pulped, or is the chain shorter than 648?
