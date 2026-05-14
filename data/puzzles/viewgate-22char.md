# 22-character token (saf_dat_col blob_1)

Status: unsolved. The 22-character token `38546uy754j9j6tuk5fi34` is the only ARG-corpus token whose length matches the input the viewgate form on `terminal41.link/comms_main_viewgate.html` expected. The structural anchor (length match plus position right next to `gvylmveqwr...`) keeps it open, but no standard cipher battery has produced a meaningful transformation.

`saf_dat_col.html` (at `terminal41.link/dat/saf_dat_col.html`) is the data blob registry. It holds 4+ named blobs. Blob_1 starts with a long alphanumeric run that includes `38546uy754j9j6tuk5fi34`, then continues into another run `gvylmveqwr...`. No visible separator between the two, so they could be adjacent fields or one continuous string.

The form on `comms_main_viewgate.html` has a single text input with `maxlength=22` and no help text. The page title `// COMMS / MAIN / VIEWGATE` is the only label hint.

Structural facts:

- `len("38546uy754j9j6tuk5fi34") == 22` matches the form's `maxlength`.
- Token sits at a non-trivial offset in blob_1, not at start or end.
- Lowercase alphanumeric only; no symbols.
- Repeat structure inside the token: `5`, `4`, `j` each appear twice; nothing repeats more than 2 times.

The token sits in the local mirror at `D:\INSIDE_ARG\ARG\terminal41.link\dat\saf_dat_col.html`. All standard cipher transformations have been applied; none produce English. The endpoint can't accept input (dead since 2020-04-21). No additional 22-char tokens have surfaced elsewhere in the corpus.

## What's been tried

Cipher battery:

- Caesar / ROT-N (all 26 shifts): no English likeness. Some shifts produce QWERTY-adjacent runs but no words.
- Vigenere with every canonical ARG string as key (`HIBERNATIONINPROGRESSREBOOTPENDING`, `MULTIPLEPROBESDISPATCHED`, `NEWPLANETDISCOVERED`, `LIFEDETECTED`, `HASTYANSWERSETRINGS`, sticker chain numbers as ASCII, `pe^!02un`, etc.): no decoded plaintext.
- Atbash / mirror: reversed token `43if5kut6j9j457yu64583`, no English.
- Base64 / base32 / base58 decode attempts: the character set fits base58 but the byte output is binary noise.
- Hex-misread (read `0/O`, `1/l/I`, `5/S` swaps as if hex digit confusion): no canonical hex hash match.
- QWERTY remap (treat each char as the key one row above / below / left / right on a US QWERTY layout): no English likeness.

Structural:

- Length-22 grid embedding: `22 = 2 x 11 = 11 x 2`. Reshape into 2x11 / 11x2 grids; read row / col / diagonal. No signal.
- Hash output: SHA-256(`38546uy754j9j6tuk5fi34`) compared against the 5 unsolved breach hashes. No match.
- Cross-puzzle joint match: check if the token is a one-time-pad output XOR'd against any known ARG string of length 22. No match.

Coincidence flags (logged, not actioned):

- `22 = len("LIFEDETECTED" [12]) + 10` (LIFEDETECTED + 10 red pixels in the recovered "Sleep" BMP).
- `41 - 22 = 19 = len("NEWPLANETDISCOVERED")`.
- `blob_1 / blob_4 size ratio = 3.0007` (exact within rounding).

Could be designer mathematical signals, could be coincidences. Neither has driven a working decoder.

## References

- Form: `D:\INSIDE_ARG\ARG\terminal41.link\comms_main_viewgate.html`
- Source blob: `D:\INSIDE_ARG\ARG\terminal41.link\dat\saf_dat_col.html`
- Cross-cipher attack runner: `D:\INSIDE_ARG\code\loose_scripts\cross_cipher_attack.py`
- Tier 29 mojibake recovery (Sleep BMP from blob_1): `D:\INSIDE_RE\ARG\Wayback_Machine\decryption_research\tier29_new_methods\`

## Still open

- Is the token a single contiguous answer, or two halves (e.g. 11+11) of a longer string with the seam at the blob_1 transition into `gvylmveqwr...`?
- Could the token be a positional pointer into another blob, e.g. read characters at offsets `[3, 8, 5, 4, 6, 7, 5, 4, ...]` of the breach registry?
- Was the form ever validated server-side, or did it always accept any 22-char input and return generic content?
- Should we mojibake-reverse the entire `saf_dat_col` payload before treating the token as canonical? The Sleep BMP recovery proves reversal yields hidden content from this same file; the token might be downstream of the reversal, not above it.
