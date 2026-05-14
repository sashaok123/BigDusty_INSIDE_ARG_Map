# Breach SHA-256 hashes (5 unsolved)

## Status

**Unsolved.** 5 SHA-256 hashes from the `breach_contribution_reg.html` registry remain uncracked. The cross-cipher attack run (900 pairs x 3 modes) returned 0 hits across the canonical ARG token set used as keys.

## TLDR

- `terminal41.link/dat/breach_contribution_reg.html` contains a registry of 70+ SHA-256 hashes interleaved with status lines.
- A subset of 5 hashes is annotated as `[BREACH SUSPECT [tag]<PROBE>]` or `[Investigate][MARKED]` and is the high-priority target.
- Standard dictionary, common-password, and rainbow-table lookups returned no preimages.
- The cross-cipher attack (use known ARG strings as Vigenere keys to "unlock" each other) returned 0 hits in 900 pairs x 3 modes.

## Background

The registry file is structured as a sequence of hex SHA-256 hashes (64 hex chars each, uppercase) separated by status markers in square brackets. Example slice from the file:

```
51AACD0FF8C780CC84757B2D0C90B0A5F84297ED21166C44A44E16BE83FB89FE
E0469F9B314DE003B32C41BFBB32D10F0550B92649ACEFFC7B28543B0A498AEE
D69F9B2E7F899D5D7F0DF8651B703612221FC62260F8C6AB069400459EEFBCC8[*]
[                 BREACH SUSPECT [tag]<PROBE>                  ]
A8057C135217AEB7E04A38DEEC17A8D9645B05803EDCB36DB55B22681F0EF50B
11E7AE7752AAC89E67938B1422269E12970FD2B667B096497D323449AC8B5BB0
315B4E2197086194A40F704420ED11442C880B400A384509DF78AC3F1FF1F9FF[*]
[Investigate][MARKED]
```

The `[*]` markers next to certain hashes are a within-registry pointer. The `[BREACH SUSPECT [tag]<PROBE>]` and `[Investigate][MARKED]` lines act as section headers separating the registry into bands.

The 5 marked / suspect hashes (subject to confirmation as the canonical "5 unsolved"; see references for source):

1. `03270F87256776F0C841F6318B5F04F5A6BCD2584B94025FE88B3C851EF7BB7E`
2. `D69F9B2E7F899D5D7F0DF8651B703612221FC62260F8C6AB069400459EEFBCC8`
3. `315B4E2197086194A40F704420ED11442C880B400A384509DF78AC3F1FF1F9FF`
4. `434DF03D5C63288BF56D3FF7125A2F82C67EDBA90A750704CDFA7F785DE7CEB1`
5. `62FC15D4176E36713130F59DEA9FA93C6234A0D1005010B9C36B4F8FB34148EA`

## Current state

- All hashes are preserved bit-for-bit in the local mirror.
- No preimage has been recovered for any of the 5.
- The remaining 65+ registry hashes are presumed plaintext-of-known-string for ARG flavour and are not the target of cracking attempts.

## Techniques tried

### Direct preimage attacks

- **Dictionary** (English words, common passwords, leaked-credentials lists) - 0 hits.
- **Rainbow tables** for SHA-256 - 0 hits.
- **Mask attack** over short alphanumeric strings up to 8 chars - 0 hits.
- **Common ARG tokens** (`HIBERNATIONINPROGRESSREBOOTPENDING`, `MULTIPLEPROBESDISPATCHED`, `NEWPLANETDISCOVERED`, `LIFEDETECTED`, `HASTYANSWERSETRINGS`, the 22-char viewgate token, `pe^!02un`, individual residue chain numbers) - 0 hits.

### Cross-cipher attack

`code/loose_scripts/cross_cipher_attack.py` runs Vigenere-style decryptions where each canonical ARG string is used as a key against each unsolved hash (treating the hash as ciphertext). Three modes:

- **Mode A**: 32-byte raw hash bytes as ciphertext, ARG string as key, scored by English letter frequency.
- **Mode B**: 64-char hex hash as ciphertext, ARG string as key.
- **Mode C**: SHA-256 of `key + hash`, looking for "self-referential" key-as-preimage collisions.

Across 300 ARG-token x 5-hash pairs x 3 modes = 4500 attempts. Filter: needle hits (`PROBE`, `LIFE`, `PLANET`, `HIBERN`, `BREACH`, `VIEWGATE`, etc., 60+ words). Top score is at noise level. 0 hits in `code/loose_scripts/cross_cipher_attack.py`.

### Structural

- **Hash spacing** in the registry - are the hashes ordered by some hidden key? Sorting by lexicographic order doesn't reveal a pattern.
- **Bit statistics** on the 5 marked hashes - distribution within standard bounds for cryptographic hash output, no anomalies.
- **`[*]` pointer reading** - the `[*]` marker on hashes 2 and 5 might index back to hashes 1 and 3, suggesting a 3+2 grouping. No decoder built around that hypothesis has produced output.

## References

- `D:\INSIDE_ARG\ARG\terminal41.link\dat\breach_contribution_reg.html` - source file
- `D:\INSIDE_ARG\code\loose_scripts\cross_cipher_attack.py` - attack runner
- `D:\INSIDE_ARG\code\loose_scripts\sticker_sha_brute.py` - earlier related sticker-hash brute (negative)
- twinysam GitHub - the 118 breach hashes mirror (`D:\INSIDE_RE\ARG\Wayback_Machine\analysis\twinysam_archive\`)

## Open questions

- Are the 5 marked hashes preimages of (a) short ARG tokens (need new key sources), (b) long natural-language strings (need cleverer dictionary derivation), or (c) raw binary content (e.g. an embedded image we already have)?
- Could the registry's status-line text itself (`[BREACH SUSPECT [tag]<PROBE>]`) be the cipher key, with the hashes being SHA-256(`status_line + ARG_token`)?
- Is the `[*]` marker actually a pointer to a row index in the registry, or shorthand for "expanded elsewhere"?
- Should we mojibake-reverse the registry file (per Tier 29 method 34) before treating the visible hash list as canonical? If the visible page is itself a mojibake artefact, the "real" hashes might differ.
