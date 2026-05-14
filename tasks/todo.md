# Phase 3 of 3: UX features (minimap, command palette, outline panel, status filter polish, LOD, keyboard shortcuts, detective-board theme)

Branch: `refactor/json-canvas`. Phases 1 (JSON Canvas) and 2 (arrows) already landed. This phase adds 5 new JS modules and 4 new CSS files plus an outline.json.

## Plan

- [x] Recon: viewer, arrows, app, i18n, data-loader, persistence, side-panel, editor, nodes
- [x] Add ~30 new i18n keys (minimap_toggle, outline_toggle, palette_*, shortcut_*, command_*, detective_theme_toggle, outline_*, filter_clear, node_*) to js/i18n.js, translated to 5 langs
- [x] Add Subscribe/observer hook to viewer so minimap can listen for transform/nodes changes
- [x] Add LOD helper module js/lod.js (levelFromZoom + flags)
- [x] Wire LOD into viewer.js draw loop (skip text rendering, replace image at lowest LOD)
- [x] Wire LOD into arrows.js (hide labels at LOD < 0.5)
- [x] Extract status-filter logic into js/status-filter.js with multi-select Shift-click, fade non-matching to 0.1
- [x] Write js/minimap.js + css/minimap.css (220x160 panel, viewport rect, click/drag/wheel)
- [x] Write js/outline.js + css/outline.css (drawer 260 px, tree of items, drag/depth/add/remove)
- [x] Seed data/outline.json with 6 puzzle node entries
- [x] Write js/command-palette.js + css/command-palette.css (Ctrl+K, fuzzy search, categories)
- [x] Write js/keyboard.js (global shortcuts, skip on input focus)
- [x] Write css/theme-detective.css (corkboard bg, pin pseudos, sticky tape labels, warm red edges)
- [x] Add HTML mount points to index.html (minimap, outline drawer, palette overlay, shortcut overlay)
- [x] Wire all new modules into app.js
- [x] Verify HTTP-serve via python -m http.server, node --check on all .js
- [x] Verify total project under 13000 lines
- [x] Mark done
- [x] Append lessons
- [x] Report to parent

## Constraints
- Vanilla JS / ES modules / no external deps
- No em-dashes anywhere
- No AI-tells in UI strings
- Total project under 13000 lines after this phase
- Don't break existing layer model
- Don't push to git
