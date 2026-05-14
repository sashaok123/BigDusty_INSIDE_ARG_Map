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

export function vertexPathD(vertices, kind) {
  if (!vertices.length) return '';
  if (kind === 'smooth' && vertices.length === 4) {
    const [a, c1, c2, b] = vertices;
    return `M ${fmt(a.x)} ${fmt(a.y)} C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(b.x)} ${fmt(b.y)}`;
  }
  let d = `M ${fmt(vertices[0].x)} ${fmt(vertices[0].y)}`;
  for (let i = 1; i < vertices.length; i++) {
    d += ` L ${fmt(vertices[i].x)} ${fmt(vertices[i].y)}`;
  }
  return d;
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
