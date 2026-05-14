# Transmission PNG / Chip JPEG

Status: unsolved. Two image assets from the ARG corpus carry visible structure but have resisted every standard image steganography test we've thrown at them. The chip JPEG (`534brn9653f9j8mmd`) and the transmission PNG sit adjacent in the asset tree and might be a single message split across two formats.

The "transmission PNG" is a community-named bitmap pulled from a Wayback capture of the data root. Sub-megabyte file with visible vertical scanlines and what looks like a low-bit-depth noise channel. The "chip JPEG" lives at `/dat/534brn9653f9j8mmd/`. The directory name is a 16-char lowercase-alphanumeric token, possibly a chip ID. Inside the directory is a single JPEG with a chip-like appearance and visible artefacts.

Both are linked from the breach contributor registry (`/dat/breach_contribution_reg.html`) implicitly: the registry references `[Transmission reloaded]` and `[err. corr.(1)]` status lines that gesture at an upstream transmission stream of which these images would be samples.

Raw asset locations:

- `D:\INSIDE_RE\ARG\Wayback_Machine\` (canonical capture)
- `D:\INSIDE_ARG\ARG\terminal41.link\dat\534brn9653f9j8mmd\` (local mirror)

Visible structure on both: scanline regularity, palette anomalies, EXIF largely stripped. No known stego decoder has pulled a clean human-readable message out of either. The visual patterns are consistent with either a deliberately encoded message at the pixel level, or with JPEG / PNG transcoding artefacts from a low-quality source.

## What's been tried

Standard steganography: LSB extraction in R, G, B and combined channels returned high-entropy output, no recognisable English. Bit-plane visualisation for all 8 planes of each channel showed no hidden image and no QR-like structure. EXIF / metadata stripped on both files; PNG `tEXt` chunks empty. F5 / JSteg style JPEG attacks: no decoded payload. Outguess: same.

Format-specific: PNG chunk audit shows only standard chunks, no oversized chunks, nothing past `IEND`. JPEG marker audit: standard JFIF + DQT + DHT, no `COM` blocks, no oversized restart intervals. JPEG sample data length matches the encoded image size with no trailing bytes.

Cross-puzzle: the Tier 29 method 34 mojibake reversal (proven reversible on `saf_dat_col` blob_1, where it recovered a 42x42 BMP "Sleep" at offset `1,008,305`) has NOT yet been attempted on the transmission PNG or the chip JPEG. This is the high-priority next step.

## References

- Tier 29 master summary: `D:\INSIDE_RE\ARG\Wayback_Machine\decryption_research\tier29_new_methods\TIER29_MASTER_SUMMARY.md`
- Wayback Machine archive root: `D:\INSIDE_RE\ARG\Wayback_Machine\`
- terminal41 dat sub-directory: `D:\INSIDE_ARG\ARG\terminal41.link\dat\`
- Sleep BMP recovery: documented under tier29 method 34

## Still open

- Are the PNG and JPEG two views of one upstream transmission, or two unrelated assets that happen to be co-located in the dat directory?
- Does the directory name `534brn9653f9j8mmd` carry meaning (16 chars; the leading `534` resembles a chip BR number) or is it just noise?
- Can mojibake reversal recover a hidden bitmap from either file the way it did from `saf_dat_col`? Until that sweep runs, neither file can be called exhaustively tested.
- The visible scanline regularity in the transmission PNG: does it match a known encoding (SSTV, Hellschreiber, Slow-Scan TV) or is it format noise? An audio-domain demodulation pass over the bitmap-as-waveform might be worth running.
