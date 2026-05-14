# terminal41.link

## Status

**Unsolved.** The site went dark via `sys/terminate_terminal/41/y/` on 2020-04-21. A 74-file local mirror exists, but the `pe^!02un` page fragment, the breach contributor registry, and the `comms_main_viewgate.html` form are all decoded only at the surface level.

## TLDR

- `terminal41.link` was a Playdead-affiliated ARG site that went live some time before 2020 and was kill-switched on `2020-04-21` via a self-triggered `sys/terminate_terminal/41/y/` endpoint.
- The community captured a 74-file Wayback Machine archive and saved local copies of every reachable URL.
- Headline puzzles: `comms_main_viewgate.html` form, `breach_contribution_reg.html` SHA-256 hash list, `saf_dat_col.html` data blob registry, and the un-decoded `pe^!02un` fragment that appears on the home page after the kill switch.
- Status remains unsolved because the live site is offline, the form does not accept any known input, and the static content has resisted standard cryptographic attack.

## Background

The ARG site presented itself as a fictional in-universe administration console. Notable URLs and what's on them:

| URL | Content |
|---|---|
| `/index.html` | Main landing; post-kill-switch shows `pe^!02un` fragment |
| `/comms_main_viewgate.html` | Form expecting a 22-char input (no help text) |
| `/comms_main_viewgate_002.html` | Variant of the form, status unclear |
| `/dat/saf_dat_col.html` | Data blob registry with 4+ blobs visible |
| `/dat/breach_contribution_reg.html` | List of 70+ SHA-256 hashes labelled with `[Transmission halted]`, `[BREACH SUSPECT [tag]<PROBE>]`, `[Investigate][MARKED]` |
| `/dat/breachlog.html` | Sub-registry referenced from the breach reg |
| `/dat/534brn9653f9j8mmd/` | Sub-directory containing chip-JPEG and Morse-like assets |
| `/sys/terminate_terminal/41/y/` | The kill-switch endpoint (2020-04-21) |

The mirror lives at `D:\INSIDE_ARG\ARG\terminal41.link\` and is the canonical offline reference. Wayback Machine captures live under `D:\INSIDE_RE\ARG\Wayback_Machine\`.

## Current state

- All static HTML and JS is preserved; the dynamic endpoints (`viewgate` form submission, `terminate_terminal` redirect) are dead.
- `pe^!02un` fragment is undecoded - it's 8 characters appearing as a header pseudo-glitch after the kill-switch hit. Standard ASCII / shift / numeric encodings have been tried.
- The 22-char viewgate input field has one known structurally matching token (`38546uy754j9j6tuk5fi34` from saf_dat_col blob_1, see `viewgate-22char` hotspot) but no acceptance proof because the endpoint is dead.

## Techniques tried

### Direct content attacks

- **Caesar / Vigenere / ROT13** on `pe^!02un` and short-string fragments - no English-likeness above noise.
- **Byte-level mojibake reversal** (Tier 29 method 34, see `D:\INSIDE_RE\ARG\Wayback_Machine\decryption_research\tier29_new_methods\`) - proven reversible on `saf_dat_col` (recovered a 42x42 BMP "Sleep" at offset `1,008,305`). The same reversal has NOT been attempted on `pe^!02un` or `printreqstatus_005-007`.
- **HTML / JS source diff** between Wayback snapshots of `index.html` - no hidden comments, no embedded data URIs, no JS-side state.

### Live-site replay

- **Form submission** to `comms_main_viewgate.html` with the known 22-char token - dead endpoint, no reply (post-kill-switch). Wayback Machine never captured a positive form response.

### Network / infrastructure

- **DNS history** for `terminal41.link` - registrar swap history pre-dates the kill-switch. The kill-switch behaviour is a server-side redirect, not a DNS revocation.
- **`sys/terminate_terminal/41/y/`** - the URL path itself encodes the kill-switch action (`41` = terminal id; `y` = confirm). No further obfuscation observed.

### Cross-puzzle keys

- **`HIBERNATIONINPROGRESSREBOOTPENDING`** (printer 5th passcode candidate) as a Vigenere key against the breach hashes - `code/loose_scripts/cross_cipher_attack.py` returned 0 hits across 900 pairs x 3 modes.
- **22-char viewgate token** (`38546uy754j9j6tuk5fi34`) as a key against the breach hashes - same attack, 0 hits.

## References

- Local mirror: `D:\INSIDE_ARG\ARG\terminal41.link\`
- Wayback Machine archive: `D:\INSIDE_RE\ARG\Wayback_Machine\`
- Tier 29 method ledger: `D:\INSIDE_RE\ARG\Wayback_Machine\decryption_research\tier29_new_methods\TIER29_MASTER_SUMMARY.md`
- Mojibake reversal recovery (Sleep BMP): see `D:\INSIDE_RE\ARG\Wayback_Machine\decryption_research\tier29_new_methods\`
- Twinysam GitHub mirror of breach contributor list + the chip-JPEG referenced from the registry

## Open questions

- Was the 22-char viewgate token actually expected input for the form, or is the length match a coincidence?
- The `pe^!02un` fragment: is it (a) glitchy footer text that the kill-switch renderer never finished, (b) a deliberate plaintext puzzle, or (c) the visible portion of a longer string the renderer truncated?
- Can we mojibake-reverse `printreqstatus_005-007`, the chip JPEG (534brn9653f9j8mmd), and the transmission PNG the same way `saf_dat_col` was reversed? The Sleep BMP recovery is a strong proof-of-concept; the same approach has not yet been swept across the other terminal41 assets.
- The breach registry's `[BREACH SUSPECT [tag]<PROBE>]` row sits between two specific hashes - is the row position itself a pointer, e.g. an index into a hash list elsewhere?
