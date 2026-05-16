# Vendored dependencies

Single-file ES-module bundles. We have no build step — every dep here is loaded directly by the browser via `import` from `js/*.js`. To upgrade or replace, fetch a new bundle and overwrite the file in place.

| File | Version | License | Source repo | Why we use it |
|---|---|---|---|---|
| `rbush.js` | 4.0.1 | ISC | [mourner/rbush](https://github.com/mourner/rbush) | 2D R-tree spatial index. Powers snap-to-guides, marquee hit-tests, obstacle queries in the new A* router. |
| `d3-hierarchy.js` | 3.1.2 | ISC | [d3/d3-hierarchy](https://github.com/d3/d3-hierarchy) | Tree / cluster / pack / treemap layouts. Used by GitHub-import to lay out folder trees. |
| `perfect-arrows.js` | 0.3.7 | MIT | [steveruizok/perfect-arrows](https://github.com/steveruizok/perfect-arrows) | Arc-through-three-points geometry for the new `curved` routing mode. |

All three are MIT/ISC, fine for any use including commercial.

## How to upgrade

Each file is downloaded as a pre-bundled ESM from [esm.sh](https://esm.sh) and given a small banner. The bundle includes all transitive dependencies inline (none of these three have runtime deps, but the workflow scales if a future vendor pulls some).

```bash
cd "Inside ARG Concept tool/_repo"

# Pick new version on npm. Example: rbush 4.1.0
VER=4.1.0
curl -fsSL "https://esm.sh/rbush@${VER}/es2022/rbush.bundle.mjs" -o js/vendor/rbush.js

# Strip the trailing sourceMappingURL comment (the .map isn't vendored)
sed -i '/sourceMappingURL/d' js/vendor/rbush.js

# Replace the auto-generated banner with our richer one (edit the file in place,
# replacing the first `/* esm.sh - rbush@<VER> */` line with the multi-line
# banner the other vendored files use).

# Smoke-test (in repo root)
node --check js/vendor/rbush.js
# Plus open tests/index.html in a browser and confirm green.
```

For `d3-hierarchy`: bundle URL is `https://esm.sh/d3-hierarchy@${VER}/es2022/d3-hierarchy.mjs` (no `.bundle.` suffix — d3-hierarchy has no deps so the non-bundled file is already self-contained).

For `perfect-arrows`: `https://esm.sh/perfect-arrows@${VER}/es2022/perfect-arrows.mjs` (same reasoning).

## Why esm.sh

- Each bundle is one file, no relative imports back to a CDN.
- Browser-ready (ES2022, no transpilation needed for evergreen browsers).
- Free and pinned by version — the URL we fetch is immutable for that version.
- Alternative would be: pull each package's `dist/*.esm.js` from npm tarball and concatenate. esm.sh saves an hour per upgrade.

## Smoke test

After any change to a vendored file:

1. `node --check js/vendor/<file>.js` — must parse.
2. Open `tests/index.html` in a browser (Chrome / Firefox / Safari) — every row must say PASS in green.
3. Hard-refresh the main app and confirm no console errors mentioning the vendored file.

## Total size

- rbush: ~5.8 KB
- d3-hierarchy: ~14.8 KB
- perfect-arrows: ~5.8 KB
- **Total: ~26 KB uncompressed** (gzipped, ~9 KB over the wire on GitHub Pages).

## What we DO NOT vendor

If a future dep does any of these, prefer a different lib:

- Pulls in CommonJS shims (`require()` polyfill).
- Imports CSS or assets at runtime.
- Requires Node-only APIs (`process`, `Buffer`, `fs`).
- Is split across many files with deep relative imports — bundling becomes manual.
