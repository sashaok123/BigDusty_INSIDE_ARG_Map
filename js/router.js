/* Pure routers. Each takes endpoints + side normals (+ optional obstacles +
   optional waypoints) and returns an ordered vertex list. Connector.js turns
   that list into an SVG `d` string. Manhattan attempts a 5-segment route
   around obstacle bboxes; falls back to orthogonal if still blocked. */

import { sideNormal, rectIntersectsSegment } from './bindings.js';

const STEP_OUT = 40;
const SMOOTH_K = 0.4;
const OBSTACLE_INFLATE = 12;

export const ROUTINGS = ['straight', 'orthogonal', 'manhattan', 'smooth'];

export function isValidRouting(r) { return ROUTINGS.includes(r); }

export function routeEdge(kind, start, end, opts) {
  const o = opts || {};
  if (Array.isArray(o.waypoints) && o.waypoints.length) {
    return [start, ...o.waypoints, end];
  }
  switch (kind) {
    case 'straight':   return routeStraight(start, end);
    case 'orthogonal': return routeOrthogonal(start, end);
    case 'manhattan':  return routeManhattan(start, end, o.fromSide, o.toSide, o.obstacles);
    case 'smooth':     return routeSmooth(start, end, o.fromSide, o.toSide);
    default:           return routeStraight(start, end);
  }
}

function routeStraight(a, b) {
  return [a, b];
}

function routeOrthogonal(a, b) {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx <= dy) {
    return [a, { x: a.x, y: b.y }, b];
  }
  return [a, { x: b.x, y: a.y }, b];
}

function routeManhattan(a, b, sideA, sideB, obstacles) {
  const oa = sideNormal(sideA || 'right');
  const ob = sideNormal(sideB || 'left');
  const a1 = { x: a.x + oa.x * STEP_OUT, y: a.y + oa.y * STEP_OUT };
  const b1 = { x: b.x + ob.x * STEP_OUT, y: b.y + ob.y * STEP_OUT };
  const base = [a, a1, b1, b];
  const obs = filterObstacles(obstacles, [a, b]);
  if (!pathIntersectsObstacles(base, obs)) return base;
  const detour = findDetour(a, a1, b1, b, obs);
  if (detour) {
    const out = [a, a1, detour, b1, b];
    if (!pathIntersectsObstacles(out, obs)) return out;
  }
  return routeOrthogonal(a, b);
}

function routeSmooth(a, b, sideA, sideB) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const span = Math.hypot(dx, dy);
  const oa = sideA ? sideNormal(sideA) : normaliseVec(dx, dy);
  const ob = sideB ? sideNormal(sideB) : normaliseVec(-dx, -dy);
  const k = Math.max(40, span * SMOOTH_K);
  const c1 = { x: a.x + oa.x * k, y: a.y + oa.y * k };
  const c2 = { x: b.x + ob.x * k, y: b.y + ob.y * k };
  return [a, c1, c2, b];
}

function normaliseVec(dx, dy) {
  const l = Math.hypot(dx, dy);
  if (l < 1e-3) return { x: 0, y: 0 };
  return { x: dx / l, y: dy / l };
}

function filterObstacles(list, endpoints) {
  if (!Array.isArray(list) || !list.length) return [];
  const inflated = list.map((r) => ({
    x: r.x - OBSTACLE_INFLATE,
    y: r.y - OBSTACLE_INFLATE,
    w: r.w + OBSTACLE_INFLATE * 2,
    h: r.h + OBSTACLE_INFLATE * 2,
  }));
  return inflated.filter((r) => {
    for (const p of endpoints) {
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return false;
    }
    return true;
  });
}

function pathIntersectsObstacles(vertices, obstacles) {
  if (!obstacles.length) return false;
  for (let i = 0; i + 1 < vertices.length; i++) {
    for (const r of obstacles) {
      if (rectIntersectsSegment(r, vertices[i], vertices[i + 1])) return true;
    }
  }
  return false;
}

function findDetour(a, a1, b1, b, obstacles) {
  const cands = [
    { x: a1.x, y: b1.y },
    { x: b1.x, y: a1.y },
    { x: (a1.x + b1.x) / 2, y: Math.min(a1.y, b1.y) - STEP_OUT },
    { x: (a1.x + b1.x) / 2, y: Math.max(a1.y, b1.y) + STEP_OUT },
    { x: Math.min(a1.x, b1.x) - STEP_OUT, y: (a1.y + b1.y) / 2 },
    { x: Math.max(a1.x, b1.x) + STEP_OUT, y: (a1.y + b1.y) / 2 },
  ];
  for (const c of cands) {
    const segs = [a, a1, c, b1, b];
    if (!pathIntersectsObstacles(segs, obstacles)) return c;
  }
  return null;
}

export function pathLength(vertices) {
  let s = 0;
  for (let i = 0; i + 1 < vertices.length; i++) {
    s += Math.hypot(vertices[i + 1].x - vertices[i].x, vertices[i + 1].y - vertices[i].y);
  }
  return s;
}

export function pointAlong(vertices, t, kind) {
  if (!vertices.length) return { x: 0, y: 0 };
  if (kind === 'smooth' && vertices.length === 4) {
    const u = clamp01(t);
    const m = 1 - u;
    const x = m * m * m * vertices[0].x + 3 * m * m * u * vertices[1].x + 3 * m * u * u * vertices[2].x + u * u * u * vertices[3].x;
    const y = m * m * m * vertices[0].y + 3 * m * m * u * vertices[1].y + 3 * m * u * u * vertices[2].y + u * u * u * vertices[3].y;
    return { x, y };
  }
  const total = pathLength(vertices);
  if (total < 1e-6) return { ...vertices[0] };
  const target = clamp01(t) * total;
  let acc = 0;
  for (let i = 0; i + 1 < vertices.length; i++) {
    const seg = Math.hypot(vertices[i + 1].x - vertices[i].x, vertices[i + 1].y - vertices[i].y);
    if (acc + seg >= target) {
      const u = seg < 1e-6 ? 0 : (target - acc) / seg;
      return {
        x: vertices[i].x + (vertices[i + 1].x - vertices[i].x) * u,
        y: vertices[i].y + (vertices[i + 1].y - vertices[i].y) * u,
      };
    }
    acc += seg;
  }
  return { ...vertices[vertices.length - 1] };
}

function clamp01(v) {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export { STEP_OUT };
