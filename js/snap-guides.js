/* Snap-guide overlay. Owns a single absolute <svg> over the viewport that
   draws guide lines + snap-point dots when a drag aligns with another node's
   edge/center. Returns snap deltas for the host to apply to the drag. */

const SVG_NS = 'http://www.w3.org/2000/svg';

export const DEFAULT_SNAP_PX = 8;

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

  show(payload) {
    if (!this.svg) return;
    this.clear();
    const lines = (payload && Array.isArray(payload.lines)) ? payload.lines : (Array.isArray(payload) ? payload : []);
    const dots = (payload && Array.isArray(payload.dots)) ? payload.dots : [];
    const t = this.getTransform();
    for (const ln of lines) {
      const a = this._toScreen(ln.x1, ln.y1, t);
      const b = this._toScreen(ln.x2, ln.y2, t);
      const el = document.createElementNS(SVG_NS, 'line');
      el.setAttribute('x1', String(a.x));
      el.setAttribute('y1', String(a.y));
      el.setAttribute('x2', String(b.x));
      el.setAttribute('y2', String(b.y));
      el.setAttribute('stroke', ln.snapped ? '#ff4f8a' : 'var(--accent)');
      el.setAttribute('stroke-width', ln.snapped ? '1.5' : '1');
      el.setAttribute('stroke-dasharray', '4 3');
      el.setAttribute('opacity', ln.snapped ? '0.95' : '0.85');
      this.svg.appendChild(el);
    }
    for (const d of dots) {
      const a = this._toScreen(d.x, d.y, t);
      const el = document.createElementNS(SVG_NS, 'circle');
      el.setAttribute('cx', String(a.x));
      el.setAttribute('cy', String(a.y));
      el.setAttribute('r', '3');
      el.setAttribute('fill', '#ff4f8a');
      el.setAttribute('opacity', '0.95');
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
  let bestXTarget = null;
  let bestYTarget = null;
  const dragXs = [
    { v: draggingRect.x, role: 'left' },
    { v: draggingRect.x + draggingRect.w, role: 'right' },
    { v: draggingRect.x + draggingRect.w / 2, role: 'centerH' },
  ];
  const dragYs = [
    { v: draggingRect.y, role: 'top' },
    { v: draggingRect.y + draggingRect.h, role: 'bottom' },
    { v: draggingRect.y + draggingRect.h / 2, role: 'middleV' },
  ];
  for (const r of otherRects) {
    const otherXs = [
      { v: r.x, rect: r },
      { v: r.x + r.w, rect: r },
      { v: r.x + r.w / 2, rect: r },
    ];
    const otherYs = [
      { v: r.y, rect: r },
      { v: r.y + r.h, rect: r },
      { v: r.y + r.h / 2, rect: r },
    ];
    for (const dxg of dragXs) for (const ox of otherXs) {
      const d = ox.v - dxg.v;
      if (Math.abs(d) < Math.abs(bestX)) {
        bestX = d;
        bestXTarget = { value: ox.v, otherRect: ox.rect, dragRole: dxg.role };
      }
    }
    for (const dyg of dragYs) for (const oy of otherYs) {
      const d = oy.v - dyg.v;
      if (Math.abs(d) < Math.abs(bestY)) {
        bestY = d;
        bestYTarget = { value: oy.v, otherRect: oy.rect, dragRole: dyg.role };
      }
    }
  }
  const snappedX = Math.abs(bestX) <= sx;
  const snappedY = Math.abs(bestY) <= sx;
  if (snappedX) dx = bestX;
  if (snappedY) dy = bestY;
  return {
    dx, dy,
    snappedX, snappedY,
    snapX: snappedX ? bestXTarget : null,
    snapY: snappedY ? bestYTarget : null,
  };
}
