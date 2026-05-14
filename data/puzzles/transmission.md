# Transmission PNG / Chip JPEG

## Status

**Unsolved.** Two image assets recovered from the ARG corpus carry visible structure that has resisted every standard image steganography test. The chip JPEG (`534brn9653f9j8mmd`) and the transmission PNG appear adjacent in the asset tree and may be a single message split across two formats.

## TLDR

- The "transmission PNG" is a community-named bitmap asset recovered from the terminal41 mirror's data sub-directory.
- The "chip JPEG" lives at `terminal41.link/dat/534brn9653f9j8mmd/` - filename appears to be a 16-char random token, possibly a chip ID.
- Both assets show visible noise / scanline patterns suggestive of a deliberately encoded image, but no standard steganography decoder has produced a clean message.
- They have NOT yet been swept with the Tier 29 method 34 mojibake reversal that worked on `saf_dat_col` (Sleep BMP recovery).

## Background

The ARG site (`terminal41.link`) hosted multiple binary data assets behind cryptic URLs. The two image assets:

1. **Transmission PNG** - first surfaced from a Wayback capture of the data root. The file is a small (sub-megabyte) PNG with visible vertical scanlines and what looks like a low-bit-depth noise channel.
2. **Chip JPEG** at `/dat/534brn9653f9j8mmd/` - the directory name is a 16-character lowercase-alphanumeric token. Inside the directory is a single JPEG with a chip-like appearance and visible artefacts.

Both are linked from the breach contributor registry (`/dat/breach_contribution_reg.html`) implicitly - the registry references "[Transmission reloaded]" and "[err. corr.(1)]" status lines that gesture at an upstream transmission stream of which the images would be representative samples.

Raw asset locations:

- `D:\INSIDE_RE\ARG\Wayback_Machine\` (canonical capture)
- `D:\INSIDE_ARG\ARG\terminal41.link\dat\534brn9653f9j8mmd\` (local mirror)

## Current state

- Both images are preserved bit-for-bit.
- Visible structure: scanline regularity, palette anomalies, EXIF data largely stripped.
- No known steganography decoder has produced a clean human-readable message from either file.
- The visual patterns are consistent with either (a) a deliberately encoded message at the pixel level or (b) JPEG / PNG transcoding artefacts from a low-quality source.

## Techniques tried

### Standard steganography

- **LSB extraction** in R, G, B and combined channels - high entropy output, no recognisable English.
- **Bit-plane visualisation** for all 8 planes of each channel - no hidden image, no QR-like structure.
- **EXIF / metadata** - stripped on both files. PNG `tEXt` chunks empty.
- **F5 / JSteg** style JPEG attacks - no decoded payload.
- **Outguess** - no decoded payload.

### Format-specific

- **PNG chunk audit** - only standard chunks present; no oversized chunks, no chunks past `IEND`.
- **JPEG marker audit** - standard JFIF + DQT + DHT; no `COM` blocks, no oversized restart intervals.
- **Sample padding** - JPEG sample data length matches the encoded image size with no trailing bytes.

### Cross-puzzle

- The Tier 29 method 34 mojibake reversal (proven reversible on `saf_dat_col` blob_1, where it recovered a 42x42 BMP "Sleep" at offset `1,008,305`) has NOT yet been attempted on the transmission PNG or the chip JPEG. This is a high-priority next step.

## References

- Tier 29 master summary: `D:\INSIDE_RE\ARG\Wayback_Machine\decryption_research\tier29_new_methods\TIER29_MASTER_SUMMARY.md`
- Wayback Machine archive root: `D:\INSIDE_RE\ARG\Wayback_Machine\`
- terminal41 dat sub-directory: `D:\INSIDE_ARG\ARG\terminal41.link\dat\`
- Sleep BMP recovery: documented under tier29 method 34

## Open questions

- Are the PNG and JPEG two views of one upstream transmission, or two unrelated assets that happen to be co-located in the dat directory?
- Does the directory name `534brn9653f9j8mmd` carry meaning (16 chars; the leading `534` resembles a chip BR number) or is it noise?
- Can mojibake reversal recover a hidden bitmap from either of these the way it did from `saf_dat_col`? Until that sweep is run, both files cannot be declared "exhaustively tested".
- The visible scanline regularity in the transmission PNG: is it consistent with a known encoding (e.g. SSTV, Hellschreiber, Slow-Scan TV) or is it format noise? An audio-domain demodulation pass over the bitmap-as-waveform might be worth running.
