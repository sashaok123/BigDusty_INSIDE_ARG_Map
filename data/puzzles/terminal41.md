# terminal41.link

Status: unsolved. The site went dark via `sys/terminate_terminal/41/y/` on 2020-04-21. A 74-file local mirror exists, but the `pe^!02un` page fragment, the breach contributor registry, and the `comms_main_viewgate.html` form are decoded only at surface level.

`terminal41.link` was a Playdead-affiliated ARG site that went live before 2020 and kill-switched itself on 2020-04-21 via a self-triggered `sys/terminate_terminal/41/y/` endpoint. The community captured a 74-file Wayback archive and saved local copies of every reachable URL. Headline puzzles: the `comms_main_viewgate.html` form, the `breach_contribution_reg.html` SHA-256 hash list, the `saf_dat_col.html` data blob registry, and the undecoded `pe^!02un` fragment that shows on the home page after the kill switch.

## URL map

| URL | Content |
|---|---|
| `/index.html` | Main landing; post-kill-switch shows `pe^!02un` fragment |
| `/comms_main_viewgate.html` | Form expecting a 22-char input (no help text) |
| `/comms_main_viewgate_002.html` | Variant of the form, status unclear |
| `/dat/saf_dat_col.html` | Data blob registry with 4+ blobs visible |
| `/dat/breach_contribution_reg.html` | 70+ SHA-256 hashes labelled `[Transmission halted]`, `[BREACH SUSPECT [tag]<PROBE>]`, `[Investigate][MARKED]` |
| `/dat/breachlog.html` | Sub-registry referenced from the breach reg |
| `/dat/534brn9653f9j8mmd/` | Sub-directory with chip-JPEG and Morse-like assets |
| `/sys/terminate_terminal/41/y/` | Kill-switch endpoint (2020-04-21) |

Local mirror: `D:\INSIDE_ARG\ARG\terminal41.link\`. Wayback captures: `D:\INSIDE_RE\ARG\Wayback_Machine\`.

## What's been tried

Direct content attacks:

- Caesar / Vigenere / ROT13 on `pe^!02un` and short-string fragments: no English-likeness above noise.
- Byte-level mojibake reversal (Tier 29 method 34, see `D:\INSIDE_RE\ARG\Wayback_Machine\decryption_research\tier29_new_methods\`): proven reversible on `saf_dat_col` (recovered a 42x42 BMP "Sleep" at offset `1,008,305`). Has NOT been attempted on `pe^!02un` or `printreqstatus_005-007`.
- HTML / JS source diff between Wayback snapshots of `index.html`: no hidden comments, no embedded data URIs, no JS-side state.

Live-site replay: form submission to `comms_main_viewgate.html` with the known 22-char token, dead endpoint, no reply post-kill-switch. Wayback never captured a positive form response.

Network / infrastructure: DNS history for `terminal41.link` shows a registrar swap before the kill-switch. The kill-switch is a server-side redirect, not a DNS revocation. The URL path itself encodes the action (`41` = terminal id; `y` = confirm). No further obfuscation.

Cross-puzzle keys:

- `HIBERNATIONINPROGRESSREBOOTPENDING` (printer 5th passcode candidate) as a Vigenere key against the breach hashes: `code/loose_scripts/cross_cipher_attack.py` returned 0 hits across 900 pairs x 3 modes.
- 22-char viewgate token (`38546uy754j9j6tuk5fi34`) as a key against the breach hashes: same attack, 0 hits.

## References

- Local mirror: `D:\INSIDE_ARG\ARG\terminal41.link\`
- Wayback Machine archive: `D:\INSIDE_RE\ARG\Wayback_Machine\`
- Tier 29 method ledger: `D:\INSIDE_RE\ARG\Wayback_Machine\decryption_research\tier29_new_methods\TIER29_MASTER_SUMMARY.md`
- Twinysam GitHub mirror of the breach contributor list and the chip-JPEG referenced from the registry

## Still open

- Was the 22-char token actually expected input for the form, or is the length match a coincidence?
- The `pe^!02un` fragment: glitchy footer text the kill-switch renderer never finished, a deliberate plaintext puzzle, or the visible portion of a longer string the renderer truncated?
- Can mojibake reversal recover hidden bitmaps from `printreqstatus_005-007`, the chip JPEG (534brn9653f9j8mmd), and the transmission PNG the same way it did from `saf_dat_col`? The Sleep BMP recovery is a strong proof-of-concept; the sweep hasn't been run across the other terminal41 assets.
- The breach registry's `[BREACH SUSPECT [tag]<PROBE>]` row sits between two specific hashes. Is its row position itself a pointer, e.g. an index into a hash list elsewhere?
