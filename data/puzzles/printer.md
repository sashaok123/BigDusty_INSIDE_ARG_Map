# Printer Easter Egg (Five-platform audit)

## Status

**Partial.** Four passcodes are documented and reproducibly decoded from the game binaries (iOS, Switch, PS4, PC). A fifth passcode (macOS Cutout) is community-derived from the in-game Morse-like dot/dash overlay and an E. E. Cummings poem reference, but is NOT verified against any code path - the printer endpoint returns `false` for it in 1189 brute attempts across 5 waves.

## TLDR

- The INSIDE printer (in-game) is a keypad / button puzzle that, when fed a passcode, prints an Easter Egg note.
- A community member published a 5-platform binary audit on r/PlaydeadsInside tracing the passcode and decoder logic in each port.
- Three of the five ports share the iOS-derived encoder. The Switch port is a fork of the iOS encoder with a re-mapped keypad. The macOS Cutout port appears to have no decoder at all in its binary.
- All printer dispatches lead to a server endpoint that no longer accepts the 5th passcode (or maybe never did - status ambiguous).

## Background

- **iOS / iPadOS** - the canonical encoder. `MULTIPLE PROBES DISPATCHED` is the verified output of decode().
- **Switch** - structurally an iOS fork. The keypad mapping uses `rrlrll-is-physical-attach` for left-right keys (physical attach order is preserved, label order is not).
- **PS4** - same logic as iOS, different mach-O layout. Confirmed via UABEA dump.
- **PC (Steam)** - same logic as iOS, x86-64 Mach-O fork.
- **macOS Cutout** - the official Mac port. the audit reports `no decoder is reachable in the macOS binary`. The Easter Egg behaviour seen on Mac comes from the server endpoint, not from any local decode step.

The four documented passcodes:

1. `MULTIPLEPROBESDISPATCHED`
2. `NEWPLANETDISCOVERED`
3. `LIFEDETECTED`
4. `HASTYANSWERSETRINGS`

The fifth (community-derived, *not* verified):

5. `HIBERNATIONINPROGRESSREBOOTPENDING`

Binary offsets from the audit:

| Port | Binary | Decoder offset |
|---|---|---|
| iOS / iPadOS | INSIDE Mach-O (arm64) | `0x5266D0` |
| Switch | NSO (aarch64) | `0xC6E5E8` |
| PS4 | PS4 ELF (FreeBSD ABI, x86-64) | `0x32A140` |
| PC (Steam) | Mach-O fork (x86-64) | `0x4B7920` |
| macOS Cutout | Mach-O (x86-64) | none reachable |

## Current state

- The four canonical passcodes are accepted by the live server (when reachable) and produce the expected Easter Egg printout.
- The 5th passcode `HIBERNATIONINPROGRESSREBOOTPENDING` was derived by the community from:
  - The in-game Morse-like dot/dash overlay seen during a specific late-game sequence
  - An E. E. Cummings poem ("pity this busy monster, manunkind") embedded as a visual cue
  - Length parity (`33` chars - matches the number of pulses in the Morse overlay)
- Posting `HIBERNATIONINPROGRESSREBOOTPENDING` to the printer endpoint returns `false` in 1189 brute attempts across 5 distinct waves of testing. Possible explanations:
  - The endpoint was deactivated before our discovery
  - The 5th passcode was never validated server-side
  - The Morse overlay was a content easter egg without a printer-endpoint counterpart
  - Encoding mismatch (case, separator, normalisation)
- macOS Cutout's lack of a local decoder means the 5th passcode (if it ever worked) only ever produced output via the server.

## Techniques tried

- **Mach-O cross-reference** between iOS / PS4 / PC binaries. Decoder strings match byte-for-byte at the offsets above (per the audit).
- **NSO unpack + disassembly** on Switch binary. Same decoder, different key map.
- **macOS Cutout linkable search** for the decoder string. Not found (per the audit).
- **Network capture** of the printer endpoint while submitting the 4 known passcodes - response confirmed.
- **Brute-force submission** of `HIBERNATIONINPROGRESSREBOOTPENDING` and its case / separator variants - 1189 attempts, all `false`.
- **E. E. Cummings overlay** as an annotation - manually transcribed `pity this busy monster, manunkind` from the in-game text, matched the rhythm of dot/dash overlay (community consensus, not code-verified).
- **`(symbol_count, hibernation_msg_length)` parity check** - both are 33, consistent with the construction but does not prove server acceptance.

## References

- Binary audit thread: https://www.reddit.com/r/PlaydeadsInside/comments/1sqij1h/
- DarkMatter's printer-art canonical assembly: `D:\INSIDE_RE\ARG\arg_graph_tiles\CANONICAL_PUZZLE.png`
- The 22-char viewgate token (potential related artefact): see `viewgate-22char` hotspot
- E. E. Cummings, "pity this busy monster, manunkind" - 1944

## Open questions

- Does the macOS Cutout build really have no decoder, or did the audit miss an indirect call?
- Is `HIBERNATIONINPROGRESSREBOOTPENDING` actually the 5th passcode, or is it a red herring derived from a coincidental Morse-rhythm match?
- The printer endpoint historically returned plain `false` for invalid input - did it ever return anything else for the 4 known passcodes after the kill-switch (`2020-04-21`), or did all five passcodes share the same endpoint state?
- If `HIBERNATIONINPROGRESSREBOOTPENDING` is a 5th passcode, where in the binary should a working decoder live? An iOS-port `0x5266D0`-style cross-reference search for the 33-char literal could confirm or rule out a static implementation.
