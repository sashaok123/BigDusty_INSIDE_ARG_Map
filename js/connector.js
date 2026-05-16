/* Connector turns an ordered vertex list (from router.js) into an SVG path
   `d` string. Knows about straight/orthogonal/manhattan polylines and smooth
   bezier (4-vertex form). jumpover draws a small arc bump at each crossing
   point against a list of other-edge segments. Picks the dasharray for the
   chosen style. */

import { segCrossPoint } from './bindings.js';

export const STYLES = ['solid', 'dashed', 'dotted'];

export function isValidStyle(s) { return STYLES.includes(s); }

const DASH = {
  solid:  null,
  dashed: '8 5',
  dotted: '2 4',
};

export function dashFor(style, scale) {
  const d = DASH[style];
  if (!d) return null;
  const s = scale || 1;
  return d.split(' ').map((n) => String(Number(n) / s)).join(' ');
}

/* Per-kind corner radius. Bigger = softer/more-curved bends. The first and
   LAST segments are always straight regardless of radius so the marker tip
   stays perpendicular to whichever node-side the endpoint is bound to (the
   dongle from findRoute makes that segment perpendicular). */
const CORNER_RADIUS = {
  elbow:      8,
  orthogonal: 8,
  manhattan:  8,
  curved:     28,
  smooth:     28,
  straight:   0,
};

export function vertexPathD(vertices, kind, opts) {
  if (!vertices.length) return '';
  if (vertices.length === 1) {
    const p = vertices[0];
    return `M ${fmt(p.x)} ${fmt(p.y)}`;
  }
  // Legacy 4-vertex smooth (user-edited C-form Bezier). Preserved so an edge
  // that was authored as a bezier still renders that way.
  if ((kind === 'smooth' || kind === 'curved') && vertices.length === 4
      && _looksLikeBezierControlPolygon(vertices)) {
    const [a, c1, c2, b] = vertices;
    return `M ${fmt(a.x)} ${fmt(a.y)} C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(b.x)} ${fmt(b.y)}`;
  }
  // Smooth / curved: Catmull-Rom-to-cubic-Bezier chain. The curve passes
  // through EVERY vertex (so user waypoints sit exactly on the rendered
  // line and the handle circle sits on the curve), and remains smooth
  // through every bend — no sharp angles. With the runway vertices
  // inserted by findRoute the tangent at each endpoint is also perpendicular
  // to the bound side, so the marker stays square-on.
  if (kind === 'smooth' || kind === 'curved') {
    if (vertices.length < 3) return _polylineD(vertices);
    return _catmullRomD(vertices);
  }
  const hasUserWaypoints = !!(opts && opts.hasUserWaypoints);
  // Elbow / orthogonal / manhattan WITH user waypoints: render as smooth
  // Catmull-Rom so the corners at user waypoints are soft (the user's
  // explicit request — they want elbow as default but smooth bends when
  // they actually route the line manually).
  if (hasUserWaypoints
      && (kind === 'elbow' || kind === 'orthogonal' || kind === 'manhattan')) {
    if (vertices.length < 3) return _polylineD(vertices);
    return _catmullRomD(vertices);
  }
  // Straight: always sharp (straight should stay straight).
  // Elbow without user waypoints: orthogonal polyline with auto-rounded corners.
  const radius = hasUserWaypoints
    ? 0
    : (CORNER_RADIUS[kind] != null ? CORNER_RADIUS[kind] : CORNER_RADIUS.elbow);
  if (radius <= 0 || vertices.length < 3) {
    return _polylineD(vertices);
  }
  return _polylineRoundedD(vertices, radius);
}

/* CENTRIPETAL Catmull-Rom-to-cubic-Bezier chain (alpha = 0.5) that
   interpolates every vertex. Centripetal parameterisation (vs the older
   uniform variant) is the standard for tight, no-overshoot smoothing —
   the curve never bulges far past a control point even when adjacent
   waypoints have very different distances and sharp direction changes.
   The waypoint handles always sit exactly on the visible curve, which
   was the user's 'waypoints disappearing under high tension' complaint.

   The FIRST segment is now a C (cubic Bezier) too — it used to be a
   plain L which made the line look 'stiff' at the source. Now the line
   flexes smoothly from a single perpendicular runway pixel after the
   source point.

   The LAST segment stays as a straight L so the SVG marker (placed at
   the path end with refX=0) auto-orients to a strict perpendicular
   tangent. _adjustEndForMarker in arrows.js inserts a 1 px perpendicular
   tail right before the endpoint exactly for this purpose. */
function _catmullRomD(verts) {
  const n = verts.length;
  if (n === 0) return '';
  if (n === 1) return `M ${fmt(verts[0].x)} ${fmt(verts[0].y)}`;
  if (n === 2) return _polylineD(verts);

  let d = `M ${fmt(verts[0].x)} ${fmt(verts[0].y)}`;
  // Interior cubic Bezier segments via centripetal Catmull-Rom. Goes from
  // i=0 (segment start→verts[1]) to i=n-3 (segment verts[n-3]→verts[n-2]).
  for (let i = 0; i < n - 2; i++) {
    const p0 = verts[Math.max(0, i - 1)];
    const p1 = verts[i];
    const p2 = verts[i + 1];
    const p3 = verts[Math.min(n - 1, i + 2)];
    const { c1, c2 } = _centripetalControls(p0, p1, p2, p3);
    d += ` C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  // Final straight L for marker tangent.
  d += ` L ${fmt(verts[n - 1].x)} ${fmt(verts[n - 1].y)}`;
  return d;
}

/* Centripetal Catmull-Rom → cubic Bezier conversion (Yuksel 2011).
   Returns { c1, c2 } such that the cubic Bezier (p1, c1, c2, p2)
   matches the centripetal CR spline segment between p1 and p2 with
   p0 and p3 as neighbour context. alpha = 0.5 gives the centripetal
   parameterisation (between uniform alpha=0 and chordal alpha=1). */
function _centripetalControls(p0, p1, p2, p3) {
  const EPS = 1e-6;
  const d01 = Math.max(EPS, Math.pow(Math.hypot(p1.x - p0.x, p1.y - p0.y), 0.5));
  const d12 = Math.max(EPS, Math.pow(Math.hypot(p2.x - p1.x, p2.y - p1.y), 0.5));
  const d23 = Math.max(EPS, Math.pow(Math.hypot(p3.x - p2.x, p3.y - p2.y), 0.5));

  // Tangents at p1 and p2 using Catmull-Rom formula adapted for
  // non-uniform parameterisation.
  const m1x = ((p1.x - p0.x) / d01 - (p2.x - p0.x) / (d01 + d12) + (p2.x - p1.x) / d12) * d12;
  const m1y = ((p1.y - p0.y) / d01 - (p2.y - p0.y) / (d01 + d12) + (p2.y - p1.y) / d12) * d12;
  const m2x = ((p2.x - p1.x) / d12 - (p3.x - p1.x) / (d12 + d23) + (p3.x - p2.x) / d23) * d12;
  const m2y = ((p2.y - p1.y) / d12 - (p3.y - p1.y) / (d12 + d23) + (p3.y - p2.y) / d23) * d12;

  return {
    c1: { x: p1.x + m1x / 3, y: p1.y + m1y / 3 },
    c2: { x: p2.x - m2x / 3, y: p2.y - m2y / 3 },
  };
}

/* Polyline with rounded corners. Each interior corner becomes a quadratic
   Bezier whose handle sits at the corner vertex and whose endpoints are
   inset along the adjoining segments by `r` (capped at half the shorter
   adjacent segment so the rounding never overshoots). The first and last
   segments of the polyline are emitted as straight L commands so the
   marker tangent at the path end equals (last - secondToLast) direction —
   which is exactly the perpendicular-to-side direction findRoute set up
   via its dongle waypoint. */
function _polylineRoundedD(vertices, r) {
  const n = vertices.length;
  let d = `M ${fmt(vertices[0].x)} ${fmt(vertices[0].y)}`;
  for (let i = 1; i < n - 1; i++) {
    const prev = vertices[i - 1];
    const cur  = vertices[i];
    const next = vertices[i + 1];
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    if (d1 < 1e-3 || d2 < 1e-3) {
      d += ` L ${fmt(cur.x)} ${fmt(cur.y)}`;
      continue;
    }
    const cap = Math.min(r, d1 / 2, d2 / 2);
    const inX  = cur.x - (cur.x - prev.x) / d1 * cap;
    const inY  = cur.y - (cur.y - prev.y) / d1 * cap;
    const outX = cur.x + (next.x - cur.x) / d2 * cap;
    const outY = cur.y + (next.y - cur.y) / d2 * cap;
    d += ` L ${fmt(inX)} ${fmt(inY)}`;
    d += ` Q ${fmt(cur.x)} ${fmt(cur.y)} ${fmt(outX)} ${fmt(outY)}`;
  }
  const last = vertices[n - 1];
  d += ` L ${fmt(last.x)} ${fmt(last.y)}`;
  return d;
}

function _polylineD(vertices) {
  let d = `M ${fmt(vertices[0].x)} ${fmt(vertices[0].y)}`;
  for (let i = 1; i < vertices.length; i++) {
    d += ` L ${fmt(vertices[i].x)} ${fmt(vertices[i].y)}`;
  }
  return d;
}

/* The legacy "smooth" routing produced exactly 4 vertices: [start, c1, c2,
   end] where c1 and c2 were bezier control handles OFF the curve. After the
   A* router landed, a 4-vertex polyline is much more commonly [start, w1,
   w2, end] where every vertex is ON the path. We tell them apart by
   checking whether the inner two points lie "obviously off" the line from
   start to end — control points typically sit perpendicular-far from the
   chord, A* waypoints typically lie roughly between. */
function _looksLikeBezierControlPolygon(verts) {
  const [a, c1, c2, b] = verts;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1) return false;
  const perpDist = (p) => Math.abs(((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / chord);
  const tParam  = (p) => ((p.x - a.x) * dx + (p.y - a.y) * dy) / (chord * chord);
  const t1 = tParam(c1);
  const t2 = tParam(c2);
  // Control points typically sit "above" the chord with t in [0, 1].
  // A* waypoints can lie anywhere; the giveaway is perpDist > 0.25 * chord
  // for at least one of them, indicating an explicit handle pull.
  return (perpDist(c1) > chord * 0.25 || perpDist(c2) > chord * 0.25)
      && t1 >= -0.1 && t1 <= 1.1 && t2 >= -0.1 && t2 <= 1.1;
}

export function jumpoverPathD(vertices, kind, otherSegments, bumpRadius) {
  if (kind === 'smooth') return vertexPathD(vertices, kind);
  const r = bumpRadius || 6;
  let d = `M ${fmt(vertices[0].x)} ${fmt(vertices[0].y)}`;
  for (let i = 0; i + 1 < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const crossings = collectCrossings(a, b, otherSegments).filter((c) => c.t > 0.04 && c.t < 0.96);
    crossings.sort((u, v) => u.t - v.t);
    for (const c of crossings) {
      const seg = unit(a, b);
      const back = { x: c.x - seg.x * r, y: c.y - seg.y * r };
      const fwd  = { x: c.x + seg.x * r, y: c.y + seg.y * r };
      d += ` L ${fmt(back.x)} ${fmt(back.y)}`;
      d += ` A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(fwd.x)} ${fmt(fwd.y)}`;
    }
    d += ` L ${fmt(b.x)} ${fmt(b.y)}`;
  }
  return d;
}

function collectCrossings(a, b, others) {
  if (!Array.isArray(others) || !others.length) return [];
  const out = [];
  for (const seg of others) {
    const p = segCrossPoint(a, b, seg[0], seg[1]);
    if (p) out.push(p);
  }
  return out;
}

function unit(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) return { x: 0, y: 0 };
  return { x: dx / l, y: dy / l };
}

function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  return Math.abs(n) < 1e-4 ? '0' : (Math.round(n * 100) / 100).toString();
}
