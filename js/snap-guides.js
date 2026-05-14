/* Tiny snap-guide overlay. Owns a single absolute <svg> over the viewport
   that draws 1 px accent lines when one node's edge is within snapPx of
   another node's edge during a drag. Visible only while drag is in flight. */

const SVG_NS = 'http://www.w3.org/2000/svg';

export const DEFAULT_SNAP_PX = 4;

export class SnapGuides {
  constructor(opts) {
    const o = opts || {};
    this.viewport = o.viewport;
    this.getTransform = o.getTransform || (() => ({ scale: 1, panX: 0, panY: 0 }));
    this._build();
  }

  _build() {
    if (!this.viewport) return;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('id', 'snap-guides');
    svg.setAttribute('class', 'snap-guides');
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '650';
    this.viewport.appendChild(svg);
    this.svg = svg;
  }

  clear() {
    if (!this.svg) return;
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
  }

  show(lines) {
    if (!this.svg) return;
    this.clear();
    const t = this.getTransform();
    for (const ln of lines || []) {
      const a = this._toScreen(ln.x1, ln.y1, t);
      const b = this._toScreen(ln.x2, ln.y2, t);
      const el = document.createElementNS(SVG_NS, 'line');
      el.setAttribute('x1', String(a.x));
      el.setAttribute('y1', String(a.y));
      el.setAttribute('x2', String(b.x));
      el.setAttribute('y2', String(b.y));
      el.setAttribute('stroke', 'var(--accent)');
      el.setAttribute('stroke-width', '1');
      el.setAttribute('stroke-dasharray', '4 3');
      el.setAttribute('opacity', '0.85');
      this.svg.appendChild(el);
    }
  }

  _toScreen(x, y, t) {
    return { x: x * t.scale + t.panX, y: y * t.scale + t.panY };
  }
}

export function computeSnapAdjust(draggingRect, otherRects, snapPx) {
  const sx = snapPx || DEFAULT_SNAP_PX;
  let dx = 0;
  let dy = 0;
  let bestX = sx + 1;
  let bestY = sx + 1;
  const guides = [];
  const dragXs = [draggingRect.x, draggingRect.x + draggingRect.w, draggingRect.x + draggingRect.w / 2];
  const dragYs = [draggingRect.y, draggingRect.y + draggingRect.h, draggingRect.y + draggingRect.h / 2];
  for (const r of otherRects) {
    const otherXs = [r.x, r.x + r.w, r.x + r.w / 2];
    const otherYs = [r.y, r.y + r.h, r.y + r.h / 2];
    for (const dx0 of dragXs) for (const ox of otherXs) {
      const d = ox - dx0;
      if (Math.abs(d) < Math.abs(bestX)) { bestX = d; }
    }
    for (const dy0 of dragYs) for (const oy of otherYs) {
      const d = oy - dy0;
      if (Math.abs(d) < Math.abs(bestY)) { bestY = d; }
    }
  }
  if (Math.abs(bestX) <= sx) dx = bestX;
  if (Math.abs(bestY) <= sx) dy = bestY;
  return { dx, dy, guides };
}
