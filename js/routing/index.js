/* Public API for the routing engine. Replaces the three fragmented detour
   algorithms that used to live in router.js and arrows.js.

   findRoute(start, end, opts) → { vertices, kind }
     vertices: ordered [{x, y}, ...] from start to end inclusive
     kind:     'elbow' | 'curved' (what was actually produced)

   opts:
     kind:       'elbow' | 'curved' (default 'elbow'). Legacy values
                 'orthogonal' / 'manhattan' / 'straight' / 'smooth' are
                 mapped via migrateRouting().
     obstacles:  AABB[]  rects [{x, y, w, h}] to route around
     fromSide:   'left' | 'right' | 'top' | 'bottom' (optional, for dongle)
     toSide:     same
     waypoints:  [{x, y}, ...] — if set and non-empty, bypass A* and return
                 [start, ...waypoints, end] unchanged (with kind preserved)
     dongleLen:  perpendicular exit length from start/end rect side (default 24)
     bendCost / bendEstimate: forwarded to A*

   Edge cases:
     - start === end: returns [start]
     - A* returns null (unreachable, shouldn't happen with axis-aligned grid
       but defensive): falls back to a direct two-point line. */

import { buildGrid, filterObstaclesContainingEndpoint, pointInsideRect } from './grid.js';
import { astar } from './astar.js';

const DEFAULT_DONGLE = 24;

const LEGACY_KIND_MAP = {
  orthogonal: 'elbow',
  manhattan:  'elbow',
  straight:   'curved',
  smooth:     'curved',
  elbow:      'elbow',
  curved:     'curved',
};

export function migrateRouting(legacyKind) {
  if (!legacyKind) return 'elbow';
  return LEGACY_KIND_MAP[legacyKind] || 'elbow';
}

const SIDE_OFFSET = {
  left:   { x: -1, y:  0 },
  right:  { x:  1, y:  0 },
  top:    { x:  0, y: -1 },
  bottom: { x:  0, y:  1 },
};

function applyDongle(point, side, len) {
  if (!side || !SIDE_OFFSET[side] || len <= 0) return point;
  const o = SIDE_OFFSET[side];
  return { x: point.x + o.x * len, y: point.y + o.y * len };
}

function collinear(a, b, c) {
  return (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
}

function simplifyCollinear(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) return vertices;
  const out = [vertices[0]];
  for (let i = 1; i < vertices.length - 1; i++) {
    if (!collinear(out[out.length - 1], vertices[i], vertices[i + 1])) {
      out.push(vertices[i]);
    }
  }
  out.push(vertices[vertices.length - 1]);
  return out;
}

function ptEq(a, b) {
  return a && b && a.x === b.x && a.y === b.y;
}

export function findRoute(start, end, opts = {}) {
  const kind = migrateRouting(opts.kind);

  if (ptEq(start, end)) {
    return { vertices: [{ x: start.x, y: start.y }], kind };
  }

  // Explicit waypoints bypass A*
  if (Array.isArray(opts.waypoints) && opts.waypoints.length) {
    return {
      vertices: [start, ...opts.waypoints, end].map((p) => ({ x: p.x, y: p.y })),
      kind,
    };
  }

  const rawObstacles = Array.isArray(opts.obstacles) ? opts.obstacles : [];

  // Filter against the REAL endpoints first (not dongles). An endpoint sitting
  // on a rect perimeter is treated as "this rect is the source/target, ignore
  // it" — but a dongle that happens to land inside an unrelated rect must NOT
  // cause us to drop that rect. Using the actual endpoints for the filter
  // preserves obstacles that the dongle slides into.
  const obstacles = filterObstaclesContainingEndpoint(rawObstacles, [start, end]);

  const dongleLen = opts.dongleLen != null ? opts.dongleLen : DEFAULT_DONGLE;
  let startDongle = applyDongle(start, opts.fromSide, dongleLen);
  let endDongle   = applyDongle(end,   opts.toSide,   dongleLen);

  // If a dongle ended up inside an obstacle (e.g., target's rect side faces
  // a wall close by), shorten or drop it. We want the dongle to be a grid
  // node the A* can navigate from — if it's trapped inside an obstacle's
  // interior, the grid edges that connect it would be considered blocked.
  if (obstacles.some((r) => pointInsideRect(startDongle, r))) startDongle = { x: start.x, y: start.y };
  if (obstacles.some((r) => pointInsideRect(endDongle,   r))) endDongle   = { x: end.x,   y: end.y };

  let polyline = null;
  try {
    const grid = buildGrid(startDongle, endDongle, obstacles, { skipFilter: true });
    const path = astar(grid, {
      bendCost: opts.bendCost,
      bendEstimate: opts.bendEstimate,
    });
    if (path && path.length) {
      polyline = path;
    }
  } catch (e) {
    // Degenerate grid (e.g., endpoints coincide after dongling). Fall through
    // to direct line.
    polyline = null;
  }

  if (!polyline) {
    polyline = [
      { x: startDongle.x, y: startDongle.y },
      { x: endDongle.x,   y: endDongle.y },
    ];
  }

  // Glue the original endpoints back on if dongling pushed them inward.
  const full = [];
  if (!ptEq(start, polyline[0])) full.push({ x: start.x, y: start.y });
  for (const p of polyline) full.push(p);
  if (!ptEq(end, full[full.length - 1])) full.push({ x: end.x, y: end.y });

  const simplified = simplifyCollinear(full);
  return { vertices: simplified, kind };
}

/* For Phase 1C wire-in: expose helpers callers might need. */
export { simplifyCollinear };
