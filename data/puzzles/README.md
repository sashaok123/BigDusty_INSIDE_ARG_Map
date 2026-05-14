# Puzzle Markdown

This directory holds the per-puzzle markdown bodies referenced by hotspot
slugs in `../hotspots.json`.

TODO: Puzzle content translations are deferred to a future iteration; only UI
chrome is currently localised. The MD bodies below stay in English regardless
of the selected GUI language.

## Files

- `breach-hashes.md`
- `printer.md`
- `stickers.md`
- `terminal41.md`
- `transmission.md`
- `viewgate-22char.md`

## Conventions

Each file should open with `# Title`, then sections `## Status`, `## TLDR`,
`## Background`, `## Current state`, `## Techniques tried`, `## References`,
`## Open questions`. The side panel renders whatever shape it gets, but the
filter / search heuristics expect the title line as `# ...`.
