/* A* over a non-uniform grid (see grid.js).

   Cost model (Excalidraw-style, scale-invariant):
     bendBase = manhattan(start, end)           — natural length scale
     g(n)     = g(parent) + manhattan(parent, n)
                + (turnedAtParent ? bendBase * 3 : 0)
     h(n)     = manhattan(n, end) + estimatedBends(n, end) * bendBase * 2

   Reverse prevention: a node cannot revisit the heading that brought it in
   (going east, you can next go north/south/east but never west).

   Returns an ordered list of vertices {x, y} from start to end inclusive,
   or null if unreachable. */

import { BinaryHeap } from './binary-heap.js';

const DIR_NONE  = 0;
const DIR_EAST  = 1;
const DIR_SOUTH = 2;
const DIR_WEST  = 3;
const DIR_NORTH = 4;

const REVERSE = { 0: 0, 1: DIR_WEST, 2: DIR_NORTH, 3: DIR_EAST, 4: DIR_SOUTH };

function headingBetween(from, to) {
  if (to.x > from.x) return DIR_EAST;
  if (to.x < from.x) return DIR_WEST;
  if (to.y > from.y) return DIR_SOUTH;
  if (to.y < from.y) return DIR_NORTH;
  return DIR_NONE;
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function estimatedBends(node, end) {
  if (node.x === end.x || node.y === end.y) return 0;
  return 1;
}

export function astar(grid, opts = {}) {
  const { byIndex, startIdx, endIdx } = grid;
  if (startIdx === endIdx) {
    return [{ x: byIndex[startIdx].x, y: byIndex[startIdx].y }];
  }

  const start = byIndex[startIdx];
  const end   = byIndex[endIdx];
  const bendBase = Math.max(1, manhattan(start, end));
  const bendCost     = opts.bendCost     != null ? opts.bendCost     : bendBase * 3;
  const bendEstimate = opts.bendEstimate != null ? opts.bendEstimate : bendBase * 2;

  const n = byIndex.length;
  const gScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const incomingDir = new Uint8Array(n);
  const closed = new Uint8Array(n);

  gScore[startIdx] = 0;
  const open = new BinaryHeap();
  open.push(startIdx, manhattan(start, end));

  while (open.size > 0) {
    const currentIdx = open.pop();
    if (currentIdx === endIdx) {
      const path = [];
      let cur = endIdx;
      while (cur !== -1) {
        const node = byIndex[cur];
        path.push({ x: node.x, y: node.y });
        cur = cameFrom[cur];
      }
      path.reverse();
      return path;
    }
    if (closed[currentIdx]) continue;
    closed[currentIdx] = 1;
    const current = byIndex[currentIdx];
    const curDir = incomingDir[currentIdx];
    const forbidden = REVERSE[curDir];

    for (const neighborIdx of current.neighbors) {
      if (closed[neighborIdx]) continue;
      const neighbor = byIndex[neighborIdx];
      const nextDir = headingBetween(current, neighbor);
      if (forbidden && nextDir === forbidden) continue;
      const stepCost = manhattan(current, neighbor)
                     + ((curDir !== DIR_NONE && nextDir !== curDir) ? bendCost : 0);
      const tentativeG = gScore[currentIdx] + stepCost;
      if (tentativeG < gScore[neighborIdx]) {
        gScore[neighborIdx]    = tentativeG;
        cameFrom[neighborIdx]  = currentIdx;
        incomingDir[neighborIdx] = nextDir;
        const f = tentativeG + manhattan(neighbor, end) + estimatedBends(neighbor, end) * bendEstimate;
        open.push(neighborIdx, f);
      }
    }
  }

  return null;
}

export { manhattan, headingBetween, DIR_NONE, DIR_EAST, DIR_SOUTH, DIR_WEST, DIR_NORTH };
