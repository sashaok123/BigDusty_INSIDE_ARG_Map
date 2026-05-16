/* Non-uniform grid for the A* router. Vertical and horizontal grid lines
   are placed at:
   - the source point's x and y
   - the target point's x and y
   - each obstacle's left and right edges (offset by ROUTE_PAD outward)
   - each obstacle's top and bottom edges (offset by ROUTE_PAD outward)

   Two adjacent grid points are connected by an edge IFF the straight
   axis-aligned segment between them does not cross the interior of any
   obstacle. Endpoints sitting exactly on an obstacle perimeter are allowed.

   Output of `buildGrid` is a Grid:
     { nodes:    Map<key, {x, y, idx, neighbors: number[]}>,
       byIndex:  Array<node>,
       startIdx, endIdx,
       width, height }

   Keys are `${x},${y}` strings; idx is the node's position in byIndex. */

const ROUTE_PAD = 10;

function uniqueSorted(values) {
  const out = [...new Set(values)];
  out.sort((a, b) => a - b);
  return out;
}

function segmentInsideRect(p1, p2, rect) {
  // Returns true iff the axis-aligned segment p1→p2 intersects the OPEN
  // interior of the rect (touching the perimeter is OK). We assume
  // axis-aligned segments (one of dx, dy is zero) since grid edges are.
  const left   = rect.x;
  const right  = rect.x + rect.w;
  const top    = rect.y;
  const bottom = rect.y + rect.h;
  if (p1.x === p2.x) {
    const x = p1.x;
    if (x <= left || x >= right) return false;
    const lo = Math.min(p1.y, p2.y);
    const hi = Math.max(p1.y, p2.y);
    return lo < bottom && hi > top;
  }
  if (p1.y === p2.y) {
    const y = p1.y;
    if (y <= top || y >= bottom) return false;
    const lo = Math.min(p1.x, p2.x);
    const hi = Math.max(p1.x, p2.x);
    return lo < right && hi > left;
  }
  return false;
}

function segmentClear(p1, p2, obstacles) {
  for (const r of obstacles) {
    if (segmentInsideRect(p1, p2, r)) return false;
  }
  return true;
}

function pointInsideRect(pt, rect) {
  return pt.x > rect.x && pt.x < rect.x + rect.w
      && pt.y > rect.y && pt.y < rect.y + rect.h;
}

function filterObstaclesContainingEndpoint(obstacles, endpoints) {
  if (!Array.isArray(obstacles) || !obstacles.length) return [];
  return obstacles.filter((r) => {
    for (const p of endpoints) {
      if (pointInsideRect(p, r)) return false;
    }
    return true;
  });
}

export function buildGrid(start, end, rawObstacles, opts = {}) {
  const pad = opts.pad != null ? opts.pad : ROUTE_PAD;
  // Caller may pre-filter obstacles (e.g. findRoute uses the real perimeter
  // points, not the dongled grid endpoints). Pass `skipFilter: true` to opt out
  // of the internal containment check.
  const obstacles = opts.skipFilter
    ? (Array.isArray(rawObstacles) ? rawObstacles : [])
    : filterObstaclesContainingEndpoint(rawObstacles, [start, end]);

  const xs = [start.x, end.x];
  const ys = [start.y, end.y];
  for (const r of obstacles) {
    xs.push(r.x - pad, r.x + r.w + pad);
    ys.push(r.y - pad, r.y + r.h + pad);
  }
  const xLines = uniqueSorted(xs);
  const yLines = uniqueSorted(ys);

  const byIndex = [];
  const nodes = new Map();
  for (const y of yLines) {
    for (const x of xLines) {
      const idx = byIndex.length;
      const node = { x, y, idx, neighbors: [] };
      byIndex.push(node);
      nodes.set(`${x},${y}`, node);
    }
  }

  const W = xLines.length;
  const H = yLines.length;
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      const n = byIndex[row * W + col];
      // Right neighbor
      if (col + 1 < W) {
        const r = byIndex[row * W + (col + 1)];
        if (segmentClear(n, r, obstacles)) {
          n.neighbors.push(r.idx);
          r.neighbors.push(n.idx);
        }
      }
      // Down neighbor
      if (row + 1 < H) {
        const d = byIndex[(row + 1) * W + col];
        if (segmentClear(n, d, obstacles)) {
          n.neighbors.push(d.idx);
          d.neighbors.push(n.idx);
        }
      }
    }
  }

  const startNode = nodes.get(`${start.x},${start.y}`);
  const endNode   = nodes.get(`${end.x},${end.y}`);
  if (!startNode || !endNode) {
    throw new Error(`buildGrid: start or end not on grid (start=${start.x},${start.y} end=${end.x},${end.y})`);
  }

  return {
    nodes,
    byIndex,
    startIdx: startNode.idx,
    endIdx: endNode.idx,
    width: W,
    height: H,
    obstacles,
  };
}

export { ROUTE_PAD, segmentClear, segmentInsideRect, pointInsideRect, filterObstaclesContainingEndpoint };
