# Inside ARG Map Editor — smoke-test checklist

Run after every merge to `main` and before each Railway / GitHub Pages deploy. Each scenario should pass without console errors. If any fail, do not deploy — `git revert` the offending commit and reopen the work.

## How to run

```powershell
# from inside `Inside ARG Concept tool/_repo`
python -m http.server 9123
# open http://localhost:9123/ in Chrome (preferably incognito to skip cache)
```

The backend can be offline for most of these — the warns about `backend fetch failed, falling back to local file: network` are expected and not a failure.

Unit tests live at `http://localhost:9123/tests/index.html` — every badge must read PASS. Currently 51 tests across 7 suites.

---

## A. Routing engine (Phase 1)

| # | Scenario | Expected |
|---|---|---|
| A1 | Drag an arrow between two text-nodes with no obstacles between them | Direct line, smooth elbow path (`elbow`) or curved (`curved`) — no detour |
| A2 | Place an image-block between two nodes, then create an arrow source→target through it | Arrow routes AROUND the image (does NOT cross its interior) |
| A3 | Same as A2 but with **two** image-blocks stacked between source and target | Arrow finds a U-shape around both, no segments cross either image |
| A4 | Set arrow to "smooth" mode, drag through the same obstacle layout | Smooth curve wraps tightly around the obstacle, no triangular polyline |
| A5 | Set arrow to "orthogonal" mode | Right-angle L or U shape, no diagonal segments |
| A6 | Toggle `passThrough` on an obstacle-crossing arrow | Arrow becomes direct line, ignores obstacles |
| A7 | Drag explicit waypoints via the arrow-edit popover | User waypoints respected, A* not invoked |

## B. Clipboard / paste (Phase 2B)

| # | Scenario | Expected |
|---|---|---|
| B1 | Take a screenshot to system clipboard, Ctrl+V on the canvas | Image uploads and a new image-block appears at viewport center |
| B2 | Same as B1 but right-click → Paste from the browser context menu | Same — image appears |
| B3 | Copy 3 nodes (Ctrl+C), Ctrl+V in same canvas | 3 duplicates appear 20px offset, with new IDs |
| B4 | Copy 3 nodes in tab 1, Ctrl+V in a different tab loaded with our app | Same — 3 nodes appear (cross-tab via system clipboard) |
| B5 | Ctrl+V image while canvas-area focus is lost (click on toolbar first) | Image still paste-attaches — the viewport pointerdown handler re-focuses it |
| B6 | Select an image-block, Ctrl+X | Copy + delete; Ctrl+V brings it back |
| B7 | Ctrl+D on a selected node | Immediate duplicate (no round-trip through system clipboard) |

## C. Lock semantics (Phase 2C)

| # | Scenario | Expected |
|---|---|---|
| C1 | Select a node, press L | Node gets a lock badge |
| C2 | Try to drag a locked node | Nothing happens, no toast |
| C3 | Try to resize a locked node via handle | Handles are hidden for locked nodes |
| C4 | Drag from a locked node's side anchor (left/right/top/bottom dot) | Arrow drag STARTS — lock does NOT block linking |
| C5 | Press Delete on a locked node | Toast "node is locked", node persists |
| C6 | Press L again to unlock | Lock badge gone; all interactions work |

## D. Undo / redo (Phase 3C/2H)

| # | Scenario | Expected |
|---|---|---|
| D1 | Make 5 separate edits (move A, edit B's text, create C, etc.), Ctrl+Z 5 times | Each undo reverts only its own edit; no other state changes |
| D2 | With a second user connected, you move node A, they move node B, you press Ctrl+Z | A reverts to its pre-move position; B stays where THEY put it |
| D3 | Same as D2 but both users edited node A | Your undo reverts A to YOUR pre-edit value (their change on A is lost — documented limitation) |
| D4 | Ctrl+Y after a Ctrl+Z | Re-applies your edit |
| D5 | Undo stack has 100 items, do another edit | Oldest entry shifts out; stack stays at 100 |

## E. Image / video / audio nodes (Phase 2B + general)

| # | Scenario | Expected |
|---|---|---|
| E1 | Upload an image via toolbar → drop on canvas | Image appears at drop point |
| E2 | Paste an image (B1) | Image appears at viewport center |
| E3 | Copy an image-block, Ctrl+V | Duplicate visible (not just a dot) — `viewer.addBlock` correctly called |
| E4 | Drag an image to a new location | Position updates, arrows reroute around it |
| E5 | Resize an image via corner handle | Image scales, no rendering artifacts |
| E6 | Delete an image-block that has arrows pointing to it | Arrows DELETED (no floating arrowheads) |

## F. GitHub import (Phase 5)

Requires admin user account + ideally a GitHub PAT.

| # | Scenario | Expected |
|---|---|---|
| F1 | Click GitHub import → enter `twinysam/INSIDE-ARG`, no token, Preview | Plan summary shows ~250 files, ~60+ in plan, ~190 skipped (rate-limited without PAT) |
| F2 | Same with a PAT in the token field | Plan summary shows ~300 in plan, ~50 skipped (only truly unsupported extensions remain) |
| F3 | Apply with folder_layout=true | Canvas shows a tree-like layout: root files in a column on the left, sub-folders nested to the right, recursively |
| F4 | Apply with folder_layout=false | Canvas shows a flat 6-per-row grid |
| F5 | Switch to the Local tab → pick a folder with mixed .md/.png/.json | Each file becomes the right node kind; folder structure preserved if folder_layout=true |

## G. Realtime / collaboration (Phase 6B + 2G)

Requires two browsers logged in as different users.

| # | Scenario | Expected |
|---|---|---|
| G1 | User A creates a node; User B sees it within 1s | Node appears in B's canvas without refresh |
| G2 | User A edits A1's text; User B sees update | Text updates live |
| G3 | User A starts dragging A1; User B sees a "locked by A" badge on A1 | Live-edit lock indicator (not the persistent lock) |
| G4 | A's network drops mid-edit, reconnects | Pending changes flush; no duplicates |
| G5 | Same edit on A1 by both A and B simultaneously | Last-write-wins or merge per node-level resolution; no console errors |

## H. Halo / arrowhead rendering (Phase 2D)

| # | Scenario | Expected |
|---|---|---|
| H1 | Smooth arrow between two nodes | Cyan curve with a white halo BEHIND, perfectly aligned — no parallel grey "shadow" |
| H2 | Delete the target node of an arrow | Entire arrow disappears, no floating arrowhead remains |
| H3 | Zoom in/out 10x | Halo width and arrowhead size scale proportionally to stroke width |

---

## Failure protocol

If a scenario fails:
1. Reproduce in incognito to rule out cache.
2. Open DevTools → Console; copy any error.
3. Note the commit SHA from `git log -1 --oneline` and the failed scenario number.
4. Open a GitHub issue with: commit, scenario, console error, reproduction steps.
5. `git revert <SHA>` and redeploy unless the fix is < 30 minutes.

Don't deploy a build with any A/B/D scenario failing — those are user-blocking. C/E/F/G/H failures can ship with a documented known-issue.
