# INSIDE ARG Investigation Map

Interactive map of the INSIDE Collector's Edition ARG puzzles. Browse every known piece of the puzzle, see what is solved and what is still open, click any block for a full write-up with techniques tried, references and open questions.

The original concept was sketched out by **BigDusty** on the Playdead Unofficial Discord in April 2026. This repository turns the concept into a permanent, collaborative tool that anyone can read and that approved contributors can edit.

## Quick start

```
python -m http.server 8000
```

Open `http://localhost:8000/` and the map loads in your browser.

No build step, no `npm install`, no external CDN. Vanilla HTML, CSS and ES modules. Works offline once the page is open.

## What is inside

- **9 ARG puzzles** documented in `data/puzzles/`, each with status, TLDR, background, current state, techniques tried, references and open questions.
- **99 content blocks** automatically extracted from the community-assembled ARG poster, stored as WebP in `data/blocks/`.
- **Magnetic arrow editor** for showing the relationships between blocks.
- **Five interface languages**: English, Russian, German, Italian, Danish.
- **Light browser-side persistence**: edits live in `localStorage` until you export them as JSON or push them back as a pull request.

## File layout

```
index.html              Entry, mounts the map
README.md
LICENSE                 MIT
css/                    Theme, toolbar, viewer, side panel, editor, markdown, arrows
js/                     ES modules: app, viewer, side-panel, editor, search, markdown, hotspots, persistence, data-loader, i18n, arrows
data/
  hotspots.json         Block-anchored hotspot rectangles
  arrows.json           Arrow graph between blocks
  blocks_raw.json       Auto-extracted block manifest
  blocks/               99 WebP block images
  puzzles/              Per-puzzle Markdown write-ups
tools/
  extract_blocks.py     Re-runs the block extraction from a source poster
```

## How the map works

The map renders by compositing all 99 WebP blocks onto a virtual canvas at their original coordinates. Pan with click-drag, zoom with the mouse wheel, search the toolbar to jump to a block by title.

Hotspots are rectangles overlaid on blocks. Each one is anchored to a `block_id` and points at a Markdown file in `data/puzzles/`. Click a hotspot to open the side panel.

Arrows are SVG paths that snap magnetically to block edges. Four routing styles are supported: orthogonal L-shape, multi-segment Manhattan, cubic Bezier and straight line. Edit them in editor mode.

## Editor mode

Press the **Editor** button in the toolbar.

- Drag on empty canvas to draw a new hotspot rectangle. Fill in title, status, tags and Markdown content.
- Hover over a block edge to reveal four arrow handles. Drag from one handle to another block to create an arrow. The endpoint snaps to the nearest block edge within 50 px.
- Right-click an arrow for label / delete.
- Click outside any popup is safe. If there are unsaved changes you get a Discard / Save / Cancel prompt before the popup closes.

When you are done, hit **Export** in the toolbar to download a JSON snapshot of all your edits. Share that snapshot in a pull request to merge changes upstream.

## Contributing

1. Fork this repository.
2. Run the map locally and use editor mode to add or improve content.
3. Export the JSON snapshot from the toolbar.
4. Commit the updated `data/hotspots.json`, `data/arrows.json` and any new or edited files in `data/puzzles/` to your fork.
5. Open a pull request.

Status changes (solved / partial / unsolved / no data) and new arrow connections are especially welcome. The puzzle Markdown is in English for now; translations are planned for a future iteration.

## Languages

Interface strings live in `js/i18n.js`. Five languages are wired in: English (default), Russian, German, Italian, Danish. Puzzle content is English only at this time, see `data/puzzles/README.md` for the translation deferral note.

## License

MIT. See `LICENSE`.

## Credits

- **BigDusty** — original concept and prototype
- **DarkMatter, Twinysam, Raezores** and the rest of the Playdead Unofficial Discord for the puzzle research that fills the map
- **Russell_Lylas** — code-level audit of the printer puzzle across five platforms
- Everyone whose write-ups and Discord threads are referenced inside `data/puzzles/`
