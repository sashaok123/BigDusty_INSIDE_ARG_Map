/* Pure maths for normalised endpoint bindings. fixedPoint is in [0,1]^2 in the
   node's local space. Mode "inside" returns the raw anchor; "orbit" projects
   the anchor onto the perimeter (plus a 6 px gap) along the line towards the
   other endpoint. Also exposes perimeter projection used by drag-to-create. */

const ORBIT_GAP = 0;

export function rectOf(node) {
  return { x: node.x, y: node.y, w: node.width, h: node.height };
}

export function anchorWorld(rect, fixedPoint) {
  const fp = (fixedPoint && fixedPoint.length === 2) ? fixedPoint : [0.5, 0.5];
  return {
    x: rect.x + rect.w * fp[0],
    y: rect.y + rect.h * fp[1],
  };
}

export function bindingPoint(rect, binding, otherPoint) {
  const fp = (binding && Array.isArray(binding.fixedPoint)) ? binding.fixedPoint : [0.5, 0.5];
  const mode = binding && binding.mode === 'inside' ? 'inside' : 'orbit';
  const base = anchorWorld(rect, fp);
  if (mode === 'inside') return base;
  return projectOutward(rect, base, otherPoint || base, ORBIT_GAP);
}

export function sideFromFixedPoint(fp) {
  if (!fp || fp.length !== 2) return null;
  const [u, v] = fp;
  const eps = 1e-6;
  if (Math.abs(u) < eps) return 'left';
  if (Math.abs(u - 1) < eps) return 'right';
  if (Math.abs(v) < eps) return 'top';
  if (Math.abs(v - 1) < eps) return 'bottom';
  return null;
}

export function sideNormal(side) {
  switch (side) {
    case 'left':   return { x: -1, y: 0 };
    case 'right':  return { x: 1, y: 0 };
    case 'top':    return { x: 0, y: -1 };
    case 'bottom': return { x: 0, y: 1 };
    default:       return { x: 0, y: 0 };
  }
}

export function inferSide(rect, point) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  const ax = Math.abs(dx) / (rect.w / 2 || 1);
  const ay = Math.abs(dy) / (rect.h / 2 || 1);
  if (ax >= ay) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

export function sideFromBinding(rect, binding, otherPoint) {
  if (binding && Array.isArray(binding.fixedPoint)) {
    const s = sideFromFixedPoint(binding.fixedPoint);
    if (s) return s;
    const base = anchorWorld(rect, binding.fixedPoint);
    return inferSide(rect, otherPoint || base);
  }
  return inferSide(rect, otherPoint || { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
}

function projectOutward(rect, anchor, towardsPoint, gap) {
  const side = anchorPerimeterSide(rect, anchor);
  if (side) {
    const n = sideNormal(side);
    return { x: anchor.x + n.x * gap, y: anchor.y + n.y * gap };
  }
  return rayOutwardFromInterior(rect, anchor, towardsPoint, gap);
}

function anchorPerimeterSide(rect, anchor) {
  const eps = 0.5;
  const onLeft   = Math.abs(anchor.x - rect.x) < eps;
  const onRight  = Math.abs(anchor.x - (rect.x + rect.w)) < eps;
  const onTop    = Math.abs(anchor.y - rect.y) < eps;
  const onBottom = Math.abs(anchor.y - (rect.y + rect.h)) < eps;
  if (onLeft   && !onTop && !onBottom) return 'left';
  if (onRight  && !onTop && !onBottom) return 'right';
  if (onTop    && !onLeft && !onRight) return 'top';
  if (onBottom && !onLeft && !onRight) return 'bottom';
  if (onLeft && onTop)     return 'left';
  if (onLeft && onBottom)  return 'left';
  if (onRight && onTop)    return 'right';
  if (onRight && onBottom) return 'right';
  return null;
}

function rayOutwardFromInterior(rect, anchor, towardsPoint, gap) {
  const dx = (towardsPoint ? towardsPoint.x : anchor.x) - anchor.x;
  const dy = (towardsPoint ? towardsPoint.y : anchor.y) - anchor.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) {
    const side = inferSide(rect, anchor);
    const n = sideNormal(side);
    return { x: anchor.x + n.x * gap, y: anchor.y + n.y * gap };
  }
  const ux = dx / len;
  const uy = dy / len;
  const hit = rayExitRect(rect, anchor, ux, uy);
  if (!hit) {
    const side = inferSide(rect, anchor);
    const n = sideNormal(side);
    return { x: anchor.x + n.x * gap, y: anchor.y + n.y * gap };
  }
  return { x: hit.x + ux * gap, y: hit.y + uy * gap };
}

function rayExitRect(rect, origin, ux, uy) {
  let bestT = Infinity;
  let best = null;
  if (Math.abs(ux) > 1e-6) {
    const xEdge = ux > 0 ? rect.x + rect.w : rect.x;
    const t = (xEdge - origin.x) / ux;
    if (t > 1e-6) {
      const y = origin.y + t * uy;
      if (y >= rect.y - 1e-6 && y <= rect.y + rect.h + 1e-6 && t < bestT) {
        bestT = t; best = { x: xEdge, y };
      }
    }
  }
  if (Math.abs(uy) > 1e-6) {
    const yEdge = uy > 0 ? rect.y + rect.h : rect.y;
    const t = (yEdge - origin.y) / uy;
    if (t > 1e-6) {
      const x = origin.x + t * ux;
      if (x >= rect.x - 1e-6 && x <= rect.x + rect.w + 1e-6 && t < bestT) {
        bestT = t; best = { x, y: yEdge };
      }
    }
  }
  return best;
}

export function perimeterProjection(rect, worldPoint) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  let bestPoint = null;
  let bestDist = Infinity;
  const candidates = [
    { x: rect.x,           y: clamp(worldPoint.y, rect.y, rect.y + rect.h) },
    { x: rect.x + rect.w,  y: clamp(worldPoint.y, rect.y, rect.y + rect.h) },
    { x: clamp(worldPoint.x, rect.x, rect.x + rect.w), y: rect.y },
    { x: clamp(worldPoint.x, rect.x, rect.x + rect.w), y: rect.y + rect.h },
  ];
  for (const c of candidates) {
    const d = Math.hypot(c.x - worldPoint.x, c.y - worldPoint.y);
    if (d < bestDist) {
      bestDist = d;
      bestPoint = c;
    }
  }
  if (!bestPoint) bestPoint = { x: cx, y: cy };
  const fp = [
    rect.w > 0 ? (bestPoint.x - rect.x) / rect.w : 0.5,
    rect.h > 0 ? (bestPoint.y - rect.y) / rect.h : 0.5,
  ];
  return { point: bestPoint, fixedPoint: fp, dist: bestDist };
}

export function fixedPointFromWorld(rect, worldPoint) {
  return [
    rect.w > 0 ? clamp((worldPoint.x - rect.x) / rect.w, 0, 1) : 0.5,
    rect.h > 0 ? clamp((worldPoint.y - rect.y) / rect.h, 0, 1) : 0.5,
  ];
}

export function rectContains(rect, p) {
  return p.x >= rect.x && p.x <= rect.x + rect.w
      && p.y >= rect.y && p.y <= rect.y + rect.h;
}

export function rectIntersectsSegment(rect, a, b) {
  if (rectContains(rect, a) || rectContains(rect, b)) return true;
  return segIntersectSeg(a, b, { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y })
      || segIntersectSeg(a, b, { x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h })
      || segIntersectSeg(a, b, { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x, y: rect.y + rect.h })
      || segIntersectSeg(a, b, { x: rect.x, y: rect.y + rect.h }, { x: rect.x, y: rect.y });
}

function segIntersectSeg(p1, p2, p3, p4) {
  const d = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(d) < 1e-9) return false;
  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / d;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / d;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}

export function segCrossPoint(p1, p2, p3, p4) {
  const d = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  if (Math.abs(d) < 1e-9) return null;
  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / d;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / d;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
  return { x: p1.x + ua * (p2.x - p1.x), y: p1.y + ua * (p2.y - p1.y), t: ua };
}

function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

export { ORBIT_GAP };
