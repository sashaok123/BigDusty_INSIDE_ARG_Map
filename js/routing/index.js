/* Public API for the routing engine.

   Geometric router (no A*, no obstacle awareness). Three kinds:

     elbow    — orthogonal L or Z shape, last segment perpendicular to toSide
     curved   — single auto-bow waypoint perpendicular to the chord midpoint
     straight — direct line a → b

   Legacy mapping:
     orthogonal | manhattan → elbow
     smooth                 → curved
     straight               → straight   (kept; was a direct diagonal line)

   Obstacle avoidance was removed in favour of user-driven manual routing:
   the user drags the arrow's midpoint to insert a waypoint that bends the
   path around whatever they want to avoid. opts.waypoints is honored
   directly when set (no further geometric inference).

   The A*-based modules (astar.js, grid.js, binary-heap.js) are kept in tree
   so they can be re-enabled as an opt-in mode later, but they are NOT used
   by the default render path.

   findRoute(start, end, opts) → { vertices, kind }
     vertices: ordered [{x, y}, ...] from start to end inclusive
     kind:     'elbow' | 'curved' | 'straight'
   opts:
     kind:      one of the supported / legacy values (see migrateRouting)
     fromSide:  'left' | 'right' | 'top' | 'bottom' (optional)
     toSide:    same
     waypoints: [{x, y}, ...] — explicit user waypoints; bypasses auto shape

   The renderer (connector.js vertexPathD) expects the LAST polyline
   segment to be perpendicular to the rect side the endpoint is bound to;
   that gives the marker tip the correct rotation. Our geometric L / Z /
   bow shapes set that up by construction. */

const CURVED_BOW_FRACTION = 0.18;

/* Length of the perpendicular straight segment we force right before the
   endpoint (and right after the start) so the marker tip always approaches
   the rect perpendicular to the bound side, and so the arrowhead has a
   short visible straight body in front of it instead of fading into a
   curve. Auto-collapses if the segment otherwise would be shorter. */
const RUNWAY_LEN = 22;

/* INTO-rect unit vector per bound side (used both as 'end runway shifts
   AWAY from endpoint by this vector × runway-length' and as 'start runway
   shifts AWAY from start by NEGATIVE this vector × length'). */
const SIDE_INWARD = {
  left:   { x:  1, y:  0 },
  right:  { x: -1, y:  0 },
  top:    { x:  0, y:  1 },
  bottom: { x:  0, y: -1 },
};

const LEGACY_KIND_MAP = {
  orthogonal: 'elbow',
  manhattan:  'elbow',
  smooth:     'curved',
  elbow:      'elbow',
  curved:     'curved',
  straight:   'straight',
};

export function migrateRouting(legacyKind) {
  if (!legacyKind) return 'elbow';
  return LEGACY_KIND_MAP[legacyKind] || 'elbow';
}

function ptEq(a, b) {
  return a && b && a.x === b.x && a.y === b.y;
}

/* Force the LAST segment of the route to be a perpendicular straight runway
   into the endpoint. Without this, the last segment can sit at an angle
   (curved bow, straight from offset start), and the marker — which orients
   along the path tangent at the endpoint — would render rotated to that
   angle instead of pointing straight into the bound side. */
function _withEndRunway(verts, end, toSide, len) {
  if (!toSide || !SIDE_INWARD[toSide] || verts.length < 2) return verts;
  const dir = SIDE_INWARD[toSide];
  const runway = { x: end.x - dir.x * len, y: end.y - dir.y * len };
  const prev = verts[verts.length - 2];
  const distPrevToEnd = Math.hypot(end.x - prev.x, end.y - prev.y);
  if (distPrevToEnd <= len) return verts;
  return [...verts.slice(0, -1), runway, end];
}

/* Symmetric: force the FIRST segment to leave the source perpendicular to
   the bound side. Visually parallel to the end-runway treatment. */
function _withStartRunway(verts, start, fromSide, len) {
  if (!fromSide || !SIDE_INWARD[fromSide] || verts.length < 2) return verts;
  const dir = SIDE_INWARD[fromSide];
  const runway = { x: start.x - dir.x * len, y: start.y - dir.y * len };
  const next = verts[1];
  const distStartToNext = Math.hypot(next.x - start.x, next.y - start.y);
  if (distStartToNext <= len) return verts;
  return [start, runway, ...verts.slice(1)];
}

function _withRunways(verts, start, end, fromSide, toSide) {
  let v = _withStartRunway(verts, start, fromSide, RUNWAY_LEN);
  v = _withEndRunway(v, end, toSide, RUNWAY_LEN);
  // When the geometric router already produced a perpendicular leg (elbow
  // with sides), the inserted runway is collinear with its neighbours; drop
  // those redundant vertices so the rounded-corner renderer doesn't emit
  // degenerate Q commands.
  return simplifyCollinear(v);
}

function _isHorizSide(side) {
  return side === 'left' || side === 'right';
}

/* Auto L / Z for elbow without waypoints. Side info determines which corner
   to use so the FIRST segment is perpendicular to fromSide and the LAST
   segment is perpendicular to toSide. */
function _elbowAuto(start, end, fromSide, toSide) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
    return [{ x: start.x, y: start.y }, { x: end.x, y: end.y }];
  }
  const fromHoriz = _isHorizSide(fromSide);
  const toHoriz   = _isHorizSide(toSide);
  const fromKnown = !!fromSide;
  const toKnown   = !!toSide;

  // Sides unknown: fall back to geometry (prefer the longer axis for the
  // first segment so the L looks visually balanced).
  if (!fromKnown && !toKnown) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      return [{ x: start.x, y: start.y }, { x: end.x, y: start.y }, { x: end.x, y: end.y }];
    }
    return [{ x: start.x, y: start.y }, { x: start.x, y: end.y }, { x: end.x, y: end.y }];
  }

  // Only one side known: orient the L around that side.
  const fHoriz = fromKnown ? fromHoriz : !toHoriz;
  const tHoriz = toKnown   ? toHoriz   : !fromHoriz;

  // Both sides horizontal (both ends exit/enter L-R) → Z bridging vertically.
  if (fHoriz && tHoriz) {
    const midX = (start.x + end.x) / 2;
    return [
      { x: start.x, y: start.y },
      { x: midX,    y: start.y },
      { x: midX,    y: end.y   },
      { x: end.x,   y: end.y   },
    ];
  }
  // Both vertical → Z bridging horizontally.
  if (!fHoriz && !tHoriz) {
    const midY = (start.y + end.y) / 2;
    return [
      { x: start.x, y: start.y },
      { x: start.x, y: midY    },
      { x: end.x,   y: midY    },
      { x: end.x,   y: end.y   },
    ];
  }
  // Mixed: a simple L. Corner orientation picked so BOTH the first and last
  // segments end up perpendicular to their bound side.
  if (fHoriz && !tHoriz) {
    // First segment horizontal, last vertical → corner at (end.x, start.y)
    return [
      { x: start.x, y: start.y },
      { x: end.x,   y: start.y },
      { x: end.x,   y: end.y   },
    ];
  }
  // !fHoriz && tHoriz: first vertical, last horizontal → corner at (start.x, end.y)
  return [
    { x: start.x, y: start.y },
    { x: start.x, y: end.y   },
    { x: end.x,   y: end.y   },
  ];
}

/* Auto bow for curved without waypoints: insert ONE perpendicular waypoint
   at the chord midpoint, offset by CURVED_BOW_FRACTION of the chord length.
   The renderer then draws a polyline with a large corner radius at that
   midpoint, producing a smooth bow. */
function _curvedAuto(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) {
    return [{ x: start.x, y: start.y }, { x: end.x, y: end.y }];
  }
  const offset = len * CURVED_BOW_FRACTION;
  const nx = -dy / len;
  const ny =  dx / len;
  return [
    { x: start.x, y: start.y },
    { x: (start.x + end.x) / 2 + nx * offset, y: (start.y + end.y) / 2 + ny * offset },
    { x: end.x, y: end.y },
  ];
}

export function findRoute(start, end, opts = {}) {
  const kind = migrateRouting(opts.kind);

  if (ptEq(start, end)) {
    return { vertices: [{ x: start.x, y: start.y }], kind };
  }

  if (Array.isArray(opts.waypoints) && opts.waypoints.length) {
    return {
      vertices: [start, ...opts.waypoints, end].map((p) => ({ x: p.x, y: p.y })),
      kind,
    };
  }

  if (kind === 'straight') {
    const verts = [{ x: start.x, y: start.y }, { x: end.x, y: end.y }];
    return { vertices: _withRunways(verts, start, end, opts.fromSide, opts.toSide), kind };
  }

  if (kind === 'elbow') {
    // Elbow corners are already placed perpendicular to the bound sides by
    // _elbowAuto, but applying runways here is a no-op via collinear-collapse
    // when the geometry already matches, and adds the perpendicular runway
    // when fromSide/toSide were null (geometric fallback path).
    const verts = _elbowAuto(start, end, opts.fromSide, opts.toSide);
    return { vertices: _withRunways(verts, start, end, opts.fromSide, opts.toSide), kind };
  }

  // curved
  const verts = _curvedAuto(start, end);
  return { vertices: _withRunways(verts, start, end, opts.fromSide, opts.toSide), kind };
}

/* Identity simplifier kept exported for existing test imports. The geometric
   router never produces redundant collinear vertices, so this is a no-op
   most of the time; we still call it on user-waypoint paths where colinear
   redundancy might occur. */
export function simplifyCollinear(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) return vertices;
  const out = [vertices[0]];
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = out[out.length - 1];
    const b = vertices[i];
    const c = vertices[i + 1];
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (!collinear) out.push(b);
  }
  out.push(vertices[vertices.length - 1]);
  return out;
}
