/* Auto-layout algorithms. Each function takes a list of node descriptors
   ({id, x, y, width, height}) plus optional edges/bounds and returns a
   Map<id, {x, y}> with the new top-left positions. None of these mutate
   their inputs; the caller writes the result back into state. */

const DEFAULT_BOUNDS = { x: 0, y: 0, w: 4000, h: 3000 };

function nodeCenter(n) {
  return { x: (n.x || 0) + (n.width || 0) / 2, y: (n.y || 0) + (n.height || 0) / 2 };
}

function boundsCenter(b) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function computeBounds(nodes) {
  if (!nodes || !nodes.length) return { ...DEFAULT_BOUNDS };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const x = n.x || 0;
    const y = n.y || 0;
    const w = n.width || 0;
    const h = n.height || 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }
  if (!Number.isFinite(minX)) return { ...DEFAULT_BOUNDS };
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

export function applyForceDirected(nodes, edges, bounds) {
  const out = new Map();
  if (!nodes || !nodes.length) return out;
  const b = bounds && Number.isFinite(bounds.x) ? bounds : computeBounds(nodes);
  const centerBase = boundsCenter(b);
  const positions = new Map();
  const velocities = new Map();
  const area = Math.max(1, b.w * b.h);
  const k = Math.sqrt(area / nodes.length) * 0.85;
  const k2 = k * k;
  for (const n of nodes) {
    const c = nodeCenter(n);
    positions.set(n.id, { x: c.x, y: c.y });
    velocities.set(n.id, { x: 0, y: 0 });
  }
  const iterations = 60;
  const damping = 0.85;
  const maxStep = Math.min(b.w, b.h) * 0.08;
  const adjacency = new Map();
  for (const e of (edges || [])) {
    if (!e || !e.fromNode || !e.toNode) continue;
    if (!positions.has(e.fromNode) || !positions.has(e.toNode)) continue;
    if (!adjacency.has(e.fromNode)) adjacency.set(e.fromNode, []);
    if (!adjacency.has(e.toNode)) adjacency.set(e.toNode, []);
    adjacency.get(e.fromNode).push(e.toNode);
    adjacency.get(e.toNode).push(e.fromNode);
  }
  const ids = nodes.map((n) => n.id);
  for (let iter = 0; iter < iterations; iter++) {
    const forces = new Map();
    for (const id of ids) forces.set(id, { x: 0, y: 0 });
    for (let i = 0; i < ids.length; i++) {
      const a = positions.get(ids[i]);
      for (let j = i + 1; j < ids.length; j++) {
        const c = positions.get(ids[j]);
        let dx = a.x - c.x;
        let dy = a.y - c.y;
        let dist2 = dx * dx + dy * dy;
        if (dist2 < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          dist2 = dx * dx + dy * dy + 0.01;
        }
        const force = k2 / dist2;
        const dist = Math.sqrt(dist2);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fa = forces.get(ids[i]);
        const fb = forces.get(ids[j]);
        fa.x += fx; fa.y += fy;
        fb.x -= fx; fb.y -= fy;
      }
    }
    for (const [fromId, toList] of adjacency.entries()) {
      const from = positions.get(fromId);
      for (const toId of toList) {
        if (fromId >= toId) continue;
        const to = positions.get(toId);
        const dx = from.x - to.x;
        const dy = from.y - to.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const att = (dist * dist) / k;
        const fx = (dx / dist) * att;
        const fy = (dy / dist) * att;
        const ff = forces.get(fromId);
        const ft = forces.get(toId);
        ff.x -= fx; ff.y -= fy;
        ft.x += fx; ft.y += fy;
      }
    }
    for (const id of ids) {
      const f = forces.get(id);
      const v = velocities.get(id);
      v.x = (v.x + f.x) * damping;
      v.y = (v.y + f.y) * damping;
      const mag = Math.sqrt(v.x * v.x + v.y * v.y);
      if (mag > maxStep) {
        v.x = (v.x / mag) * maxStep;
        v.y = (v.y / mag) * maxStep;
      }
      const p = positions.get(id);
      p.x += v.x;
      p.y += v.y;
    }
  }
  let minPX = Infinity, minPY = Infinity, maxPX = -Infinity, maxPY = -Infinity;
  for (const p of positions.values()) {
    if (p.x < minPX) minPX = p.x;
    if (p.y < minPY) minPY = p.y;
    if (p.x > maxPX) maxPX = p.x;
    if (p.y > maxPY) maxPY = p.y;
  }
  const layoutCx = (minPX + maxPX) / 2;
  const layoutCy = (minPY + maxPY) / 2;
  const shiftX = centerBase.x - layoutCx;
  const shiftY = centerBase.y - layoutCy;
  for (const n of nodes) {
    const p = positions.get(n.id);
    out.set(n.id, {
      x: Math.round(p.x + shiftX - (n.width || 0) / 2),
      y: Math.round(p.y + shiftY - (n.height || 0) / 2),
    });
  }
  return out;
}

export function applyHierarchical(nodes, edges, bounds) {
  const out = new Map();
  if (!nodes || !nodes.length) return out;
  const b = bounds && Number.isFinite(bounds.x) ? bounds : computeBounds(nodes);
  const idSet = new Set(nodes.map((n) => n.id));
  const incoming = new Map();
  const outgoing = new Map();
  for (const n of nodes) { incoming.set(n.id, []); outgoing.set(n.id, []); }
  for (const e of (edges || [])) {
    if (!e || !e.fromNode || !e.toNode) continue;
    if (!idSet.has(e.fromNode) || !idSet.has(e.toNode)) continue;
    outgoing.get(e.fromNode).push(e.toNode);
    incoming.get(e.toNode).push(e.fromNode);
  }
  const level = new Map();
  const visiting = new Set();
  function lvl(id) {
    if (level.has(id)) return level.get(id);
    if (visiting.has(id)) { level.set(id, 0); return 0; }
    visiting.add(id);
    const parents = incoming.get(id) || [];
    let best = 0;
    for (const p of parents) {
      const v = lvl(p);
      if (v + 1 > best) best = v + 1;
    }
    visiting.delete(id);
    level.set(id, best);
    return best;
  }
  for (const n of nodes) lvl(n.id);
  const buckets = new Map();
  for (const n of nodes) {
    const l = level.get(n.id) || 0;
    if (!buckets.has(l)) buckets.set(l, []);
    buckets.get(l).push(n);
  }
  const layers = Array.from(buckets.keys()).sort((a, c) => a - c);
  const rowHeight = 220;
  const colSpacing = 60;
  let topY = b.y + 40;
  for (const lv of layers) {
    const list = buckets.get(lv);
    list.sort((a, c) => (a.id < c.id ? -1 : 1));
    let totalW = 0;
    for (const n of list) totalW += (n.width || 100);
    totalW += colSpacing * Math.max(0, list.length - 1);
    let maxH = 0;
    for (const n of list) maxH = Math.max(maxH, n.height || 100);
    let startX = b.x + (b.w - totalW) / 2;
    let curX = startX;
    for (const n of list) {
      out.set(n.id, { x: Math.round(curX), y: Math.round(topY) });
      curX += (n.width || 100) + colSpacing;
    }
    topY += maxH + rowHeight - 100;
  }
  return out;
}

export function applyGrid(nodes, bounds, cols) {
  const out = new Map();
  if (!nodes || !nodes.length) return out;
  const colCount = Math.max(1, Math.min(20, Math.floor(cols || 5)));
  const b = bounds && Number.isFinite(bounds.x) ? bounds : computeBounds(nodes);
  const sorted = nodes.slice().sort((a, c) => (a.id < c.id ? -1 : 1));
  let cellW = 0;
  let cellH = 0;
  for (const n of sorted) {
    cellW = Math.max(cellW, n.width || 100);
    cellH = Math.max(cellH, n.height || 100);
  }
  const gap = 40;
  const startX = b.x;
  const startY = b.y;
  for (let i = 0; i < sorted.length; i++) {
    const col = i % colCount;
    const row = Math.floor(i / colCount);
    const n = sorted[i];
    out.set(n.id, {
      x: Math.round(startX + col * (cellW + gap)),
      y: Math.round(startY + row * (cellH + gap)),
    });
  }
  return out;
}

export function applyCircle(nodes, bounds) {
  const out = new Map();
  if (!nodes || !nodes.length) return out;
  const b = bounds && Number.isFinite(bounds.x) ? bounds : computeBounds(nodes);
  const c = boundsCenter(b);
  let maxDim = 0;
  for (const n of nodes) maxDim = Math.max(maxDim, n.width || 0, n.height || 0);
  const radius = Math.max(150, Math.min(b.w, b.h) / 2 - maxDim);
  const sorted = nodes.slice().sort((a, n2) => (a.id < n2.id ? -1 : 1));
  const n = sorted.length;
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const cx = c.x + Math.cos(angle) * radius;
    const cy = c.y + Math.sin(angle) * radius;
    const node = sorted[i];
    out.set(node.id, {
      x: Math.round(cx - (node.width || 0) / 2),
      y: Math.round(cy - (node.height || 0) / 2),
    });
  }
  return out;
}

export { computeBounds };
