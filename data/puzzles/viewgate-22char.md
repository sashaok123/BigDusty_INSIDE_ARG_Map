# 22-character token (saf_dat_col blob_1)

## Status

**Unsolved.** The 22-character token `38546uy754j9j6tuk5fi34` is the only ARG-corpus token whose length exactly matches the input expected by the viewgate form on `terminal41.link/comms_main_viewgate.html`. Its structural anchor (length match + position adjacent to `gvylmveqwr...`) keeps it on the open-puzzle list, but no standard cipher battery has produced a meaningful transformation.

## TLDR

- The viewgate form on the live (pre-kill-switch) terminal41 site expected a 22-char input.
- `saf_dat_col` blob_1 contains the substring `38546uy754j9j6tuk5fi34` (22 chars).
- This is the only 22-char-length token found anywhere in the ARG corpus.
- Standard cipher attempts (Caesar, Vigenere, ROT, base64-ish, hex-misread) return nothing.
- The endpoint is dead, so even if we had the right answer we cannot verify it server-side.

## Background

`saf_dat_col.html` (located at `terminal41.link/dat/saf_dat_col.html`) is the data blob registry. It holds 4+ named blobs. Blob_1 begins with a long alphanumeric run that includes the token `38546uy754j9j6tuk5fi34` followed by another run `gvylmveqwr...`. The transition between the two runs has no visible separator - they could be two adjacent fields or one continuous string.

Length anchor: `comms_main_viewgate.html` has a single text input with `maxlength=22` and no help text. The page title is `// COMMS / MAIN / VIEWGATE` which is the only label hint.

The structural facts:

- `len('38546uy754j9j6tuk5fi34') == 22` matches the form's `maxlength`.
- Position-wise, the token sits at a non-trivial offset in blob_1 (not start, not end), surrounded by other character runs.
- Character class: lowercase alphanumeric only; no symbols.
- Repeat structure inside the token: `5`, `4`, `j` each appear twice; no repeats span more than 2 occurrences.

## Current state

- The token is preserved in the local mirror at `D:\INSIDE_ARG\ARG\terminal41.link\dat\saf_dat_col.html`.
- All standard cipher transformations have been applied; none produce English.
- The endpoint cannot accept input (dead since `2020-04-21`).
- No additional 22-char tokens have been found elsewhere in the corpus.

## Techniques tried

### Cipher battery

- **Caesar / ROT-N** (all 26 shifts) - no English likeness; some shifts produce QWERTY-adjacent runs but no words.
- **Vigenere** with every canonical ARG string as key (`HIBERNATIONINPROGRESSREBOOTPENDING`, `MULTIPLEPROBESDISPATCHED`, `NEWPLANETDISCOVERED`, `LIFEDETECTED`, `HASTYANSWERSETRINGS`, sticker chain numbers as ASCII, `pe^!02un`, etc.) - no decoded plaintext.
- **Atbash / mirror** - reversed token `43if5kut6j9j457yu64583` - no English.
- **Base64 / base32 / base58** decode attempts - the character set fits base58 but the byte output is binary noise.
- **Hex-misread** (read `0/O`, `1/l/I`, `5/S` swaps as if hex digit confusion) - no canonical hex hash match.
- **QWERTY remap** (treat each char as the key one row above / below / left / right on a US QWERTY layout) - no English likeness.

### Structural

- **Length-22 grid embedding** - `22 = 2 x 11 = 11 x 2`. Reshape into 2x11 / 11x2 grids; read row / col / diagonal - no signal.
- **Hash output** - SHA-256(`38546uy754j9j6tuk5fi34`) compared against the 5 unsolved breach hashes - no match.
- **Cross-puzzle joint match** - check if the token is a one-time-pad output XOR'd against any known ARG string of length 22 - no match.

### Coincidence flags (logged but not actioned)

- `22 = len('LIFEDETECTED' [12]) + 10` (LIFEDETECTED + 10 red pixels in the recovered "Sleep" BMP).
- `41 - 22 = 19 = len('NEWPLANETDISCOVERED')`.
- `blob_1 / blob_4 size ratio = 3.0007` (exact within rounding).

These are flagged as possible designer mathematical signals OR coincidences; neither has driven a working decoder.

## References

- Form: `D:\INSIDE_ARG\ARG\terminal41.link\comms_main_viewgate.html`
- Source blob: `D:\INSIDE_ARG\ARG\terminal41.link\dat\saf_dat_col.html`
- Cross-cipher attack runner: `D:\INSIDE_ARG\code\loose_scripts\cross_cipher_attack.py`
- Tier 29 mojibake recovery (Sleep BMP from blob_1): `D:\INSIDE_RE\ARG\Wayback_Machine\decryption_research\tier29_new_methods\`

## Open questions

- Is the 22-char token a single contiguous answer, or two halves (e.g. 11+11) of a longer string with the seam matching the blob_1 transition into `gvylmveqwr...`?
- Could the token be a positional pointer into another blob - e.g. read characters at offsets `[3, 8, 5, 4, 6, 7, 5, 4, ...]` of the breach registry?
- Was the form ever validated server-side, or did it always accept any 22-char input and return generic content?
- Should we mojibake-reverse the entire `saf_dat_col` payload before treating the token as canonical? The Sleep BMP recovery proves that reversal yields hidden content from this same file; the token might be downstream of the reversal, not above it.
