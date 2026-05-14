/* SVG arrow overlay. Path routing functions are pure: given two endpoints +
   kind they return an SVG path `d` string. Editor mode adds edge handles on
   blocks, magnetic drag-to-snap, selection + properties popover. */

import { tr } from './i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SNAP_PX = 50;

const COLOUR_VAR = {
  accent: 'var(--accent)',
  solved: 'var(--solved)',
  partial: 'var(--partial)',
  unsolved: 'var(--unsolved)',
  muted: 'var(--text-dim)',
};

const STYLE_DASH = {
  solid: null,
  dashed: '8 6',
  dotted: '2 4',
};

const KINDS = ['orthogonal', 'manhattan', 'bezier', 'straight'];
const STYLES = ['solid', 'dashed', 'dotted'];
const COLOURS = ['accent', 'solved', 'partial', 'unsolved', 'muted'];

export function isValidKind(k)    { return KINDS.includes(k); }
export function isValidStyle(s)   { return STYLES.includes(s); }
export function isValidColour(c)  { return COLOURS.includes(c); }

export function blockAnchor(rect, side) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  switch (side) {
    case 'left':   return { x: rect.x,           y: cy };
    case 'right':  return { x: rect.x + rect.w,  y: cy };
    case 'top':    return { x: cx,               y: rect.y };
    case 'bottom': return { x: cx,               y: rect.y + rect.h };
    default:       return { x: rect.x + rect.w,  y: cy };
  }
}

export function autoSide(fromRect, toRect) {
  const fcx = fromRect.x + fromRect.w / 2;
  const fcy = fromRect.y + fromRect.h / 2;
  const tcx = toRect.x + toRect.w / 2;
  const tcy = toRect.y + toRect.h / 2;
  const dx = tcx - fcx;
  const dy = tcy - fcy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
  }
  return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
}

export function resolveEndpoint(ep, blocksById) {
  if (ep && typeof ep === 'object' && typeof ep.block_id === 'string' && blocksById.has(ep.block_id)) {
    const blk = blocksById.get(ep.block_id);
    return blockAnchor(blk.rect, ep.side || 'auto');
  }
  if (ep && typeof ep.x === 'number' && typeof ep.y === 'number') {
    return { x: ep.x, y: ep.y };
  }
  return { x: 0, y: 0 };
}

function sideOf(ep, blocksById) {
  if (ep && typeof ep.side === 'string' && ep.side !== 'auto') return ep.side;
  if (ep && ep.block_id && blocksById.has(ep.block_id)) {
    return null;
  }
  return null;
}

function offsetFromSide(side, dist) {
  switch (side) {
    case 'left':   return { dx: -dist, dy: 0 };
    case 'right':  return { dx: dist,  dy: 0 };
    case 'top':    return { dx: 0,     dy: -dist };
    case 'bottom': return { dx: 0,     dy: dist };
    default:       return { dx: 0,     dy: 0 };
  }
}

export function pathFor(kind, a, b, sideA, sideB) {
  switch (kind) {
    case 'straight':   return straightPath(a, b);
    case 'orthogonal': return orthogonalPath(a, b, sideA, sideB);
    case 'manhattan':  return manhattanPath(a, b, sideA, sideB);
    case 'bezier':     return bezierPath(a, b, sideA, sideB);
    default:           return straightPath(a, b);
  }
}

function straightPath(a, b) {
  return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
}

function orthogonalPath(a, b, sideA, sideB) {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx <= dy) {
    return `M ${a.x} ${a.y} L ${a.x} ${b.y} L ${b.x} ${b.y}`;
  }
  return `M ${a.x} ${a.y} L ${b.x} ${a.y} L ${b.x} ${b.y}`;
}

function manhattanPath(a, b, sideA, sideB) {
  const dist = 40;
  const oa = offsetFromSide(sideA || 'right', dist);
  const ob = offsetFromSide(sideB || 'left', dist);
  const a1 = { x: a.x + oa.dx, y: a.y + oa.dy };
  const b1 = { x: b.x + ob.dx, y: b.y + ob.dy };
  const horizFirst = (sideA === 'left' || sideA === 'right' || (sideA == null && Math.abs(b.x - a.x) > Math.abs(b.y - a.y)));
  let mid;
  if (horizFirst) {
    mid = { x: b1.x, y: a1.y };
  } else {
    mid = { x: a1.x, y: b1.y };
  }
  return `M ${a.x} ${a.y} L ${a1.x} ${a1.y} L ${mid.x} ${mid.y} L ${b1.x} ${b1.y} L ${b.x} ${b.y}`;
}

function bezierPath(a, b, sideA, sideB) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const k = Math.max(40, dist * 0.3);
  const oa = sideA ? offsetFromSide(sideA, k) : { dx: dx * 0.3, dy: dy * 0.3 };
  const ob = sideB ? offsetFromSide(sideB, k) : { dx: -dx * 0.3, dy: -dy * 0.3 };
  const c1 = { x: a.x + oa.dx, y: a.y + oa.dy };
  const c2 = { x: b.x + ob.dx, y: b.y + ob.dy };
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}

export function tangentAtEnd(kind, a, b, sideA, sideB) {
  if (kind === 'straight') {
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
  if (kind === 'orthogonal') {
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx <= dy) {
      return b.y >= a.y ? Math.PI / 2 : -Math.PI / 2;
    }
    return b.x >= a.x ? 0 : Math.PI;
  }
  if (kind === 'manhattan') {
    switch (sideB) {
      case 'left':   return 0;
      case 'right':  return Math.PI;
      case 'top':    return Math.PI / 2;
      case 'bottom': return -Math.PI / 2;
      default:       return Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  if (kind === 'bezier') {
    if (sideB) {
      switch (sideB) {
        case 'left':   return 0;
        case 'right':  return Math.PI;
        case 'top':    return Math.PI / 2;
        case 'bottom': return -Math.PI / 2;
      }
    }
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
  return 0;
}

export function midpointOf(kind, a, b, sideA, sideB) {
  if (kind === 'straight') {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  if (kind === 'orthogonal') {
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx <= dy) {
      return { x: a.x, y: (a.y + b.y) / 2 };
    }
    return { x: (a.x + b.x) / 2, y: a.y };
  }
  if (kind === 'manhattan') {
    const dist = 40;
    const oa = offsetFromSide(sideA || 'right', dist);
    const ob = offsetFromSide(sideB || 'left', dist);
    const a1 = { x: a.x + oa.dx, y: a.y + oa.dy };
    const b1 = { x: b.x + ob.dx, y: b.y + ob.dy };
    return { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  }
  if (kind === 'bezier') {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export class ArrowLayer {
  constructor(opts) {
    this.svg = opts.svg;
    this.viewport = opts.viewport;
    this.getBlocks = opts.getBlocks;
    this.getTransform = opts.getTransform;
    this.onArrowsChange = opts.onArrowsChange || (() => {});
    this.onScheduleSave = opts.onScheduleSave || (() => {});

    this.arrows = [];
    this.mode = 'viewer';
    this.selectedId = null;
    this.dragState = null;
    this.hoverHandle = null;

    this._installRoot();
    this._installEvents();
  }

  _installRoot() {
    const ns = SVG_NS;
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    const defs = document.createElementNS(ns, 'defs');
    for (const c of COLOURS) {
      const mk = document.createElementNS(ns, 'marker');
      mk.setAttribute('id', `arrowhead-${c}`);
      mk.setAttribute('viewBox', '0 0 10 10');
      mk.setAttribute('refX', '8');
      mk.setAttribute('refY', '5');
      mk.setAttribute('markerWidth', '6');
      mk.setAttribute('markerHeight', '6');
      mk.setAttribute('orient', 'auto-start-reverse');
      const poly = document.createElementNS(ns, 'path');
      poly.setAttribute('d', 'M 0 0 L 10 5 L 0 10 Z');
      poly.setAttribute('fill', COLOUR_VAR[c]);
      mk.appendChild(poly);
      defs.appendChild(mk);
    }
    this.svg.appendChild(defs);
    this.world = document.createElementNS(ns, 'g');
    this.world.setAttribute('id', 'arrow-world');
    this.svg.appendChild(this.world);
    this.handlesGroup = document.createElementNS(ns, 'g');
    this.handlesGroup.setAttribute('id', 'arrow-handles');
    this.world.appendChild(this.handlesGroup);
    this.arrowsGroup = document.createElementNS(ns, 'g');
    this.arrowsGroup.setAttribute('id', 'arrow-paths');
    this.world.appendChild(this.arrowsGroup);
    this.previewGroup = document.createElementNS(ns, 'g');
    this.previewGroup.setAttribute('id', 'arrow-preview');
    this.world.appendChild(this.previewGroup);
  }

  _installEvents() {
    this.svg.addEventListener('mousedown', (e) => this._onMouseDown(e));
    window.addEventListener('mousemove', (e) => this._onMouseMove(e));
    window.addEventListener('mouseup', (e) => this._onMouseUp(e));
    this.svg.addEventListener('contextmenu', (e) => this._onContextMenu(e));
  }

  setArrows(arrows) {
    this.arrows = (arrows || []).map((a) => normaliseArrow(a));
    this.requestDraw();
  }

  getArrows() {
    return this.arrows.map((a) => ({ ...a, from: { ...a.from }, to: { ...a.to } }));
  }

  setMode(mode) {
    this.mode = mode;
    this.svg.style.pointerEvents = mode === 'editor' ? 'auto' : 'none';
    if (mode !== 'editor') {
      this.selectedId = null;
      this._hideProps();
    }
    this.requestDraw();
  }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._draw();
    });
  }

  _blocksById() {
    const m = new Map();
    for (const b of this.getBlocks()) m.set(b.id, b);
    return m;
  }

  _draw() {
    const t = this.getTransform();
    this.world.setAttribute('transform', `translate(${t.panX} ${t.panY}) scale(${t.scale})`);

    while (this.arrowsGroup.firstChild) this.arrowsGroup.removeChild(this.arrowsGroup.firstChild);
    while (this.handlesGroup.firstChild) this.handlesGroup.removeChild(this.handlesGroup.firstChild);
    while (this.previewGroup.firstChild) this.previewGroup.removeChild(this.previewGroup.firstChild);

    const blocksById = this._blocksById();
    const scale = t.scale || 1;

    for (const a of this.arrows) {
      this._renderArrow(a, blocksById, scale);
    }

    if (this.mode === 'editor') {
      for (const b of this.getBlocks()) {
        this._renderEdgeHandles(b, scale);
      }
    }

    if (this.dragState && this.dragState.kind === 'draw-arrow') {
      this._renderDragPreview(scale);
    }
  }

  _renderArrow(a, blocksById, scale) {
    const ns = SVG_NS;
    const aPt = resolveEndpoint(a.from, blocksById);
    const bPt = resolveEndpoint(a.to, blocksById);
    const sideA = (a.from && a.from.side && a.from.side !== 'auto') ? a.from.side : null;
    const sideB = (a.to   && a.to.side   && a.to.side   !== 'auto') ? a.to.side   : null;
    const d = pathFor(a.kind, aPt, bPt, sideA, sideB);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', COLOUR_VAR[a.colour] || COLOUR_VAR.accent);
    path.setAttribute('stroke-width', String(2.4 / scale));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('marker-end', `url(#arrowhead-${a.colour})`);
    const dash = STYLE_DASH[a.style];
    if (dash) {
      const parts = dash.split(' ').map((n) => String(Number(n) / scale));
      path.setAttribute('stroke-dasharray', parts.join(' '));
    }
    path.setAttribute('data-id', a.id);
    path.style.cursor = this.mode === 'editor' ? 'pointer' : 'default';
    if (this.selectedId === a.id) {
      path.setAttribute('stroke-width', String(4 / scale));
    }
    if (this.mode === 'editor') {
      path.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.stopPropagation();
        this._selectArrow(a.id);
      });
    }
    this.arrowsGroup.appendChild(path);

    if (a.label) {
      const mid = midpointOf(a.kind, aPt, bPt, sideA, sideB);
      const padX = 5;
      const padY = 2;
      const fontPx = 12 / scale;
      const approxW = a.label.length * fontPx * 0.55 + padX * 2;
      const approxH = fontPx + padY * 2;
      const bg = document.createElementNS(ns, 'rect');
      bg.setAttribute('x', String(mid.x - approxW / 2));
      bg.setAttribute('y', String(mid.y - approxH / 2));
      bg.setAttribute('width', String(approxW));
      bg.setAttribute('height', String(approxH));
      bg.setAttribute('rx', String(3 / scale));
      bg.setAttribute('fill', 'rgba(10,10,14,0.86)');
      bg.setAttribute('stroke', 'rgba(232,107,46,0.45)');
      bg.setAttribute('stroke-width', String(1 / scale));
      this.arrowsGroup.appendChild(bg);
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', String(mid.x));
      text.setAttribute('y', String(mid.y));
      text.setAttribute('font-size', String(fontPx));
      text.setAttribute('font-family', 'var(--font-mono)');
      text.setAttribute('fill', '#d4d4e8');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('pointer-events', 'none');
      text.textContent = a.label;
      this.arrowsGroup.appendChild(text);
    }
  }

  _renderEdgeHandles(block, scale) {
    const ns = SVG_NS;
    const r = block.rect;
    const sides = [
      { side: 'left',   x: r.x,             y: r.y + r.h / 2 },
      { side: 'right',  x: r.x + r.w,       y: r.y + r.h / 2 },
      { side: 'top',    x: r.x + r.w / 2,   y: r.y            },
      { side: 'bottom', x: r.x + r.w / 2,   y: r.y + r.h      },
    ];
    const radius = 6 / scale;
    for (const s of sides) {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', String(s.x));
      c.setAttribute('cy', String(s.y));
      c.setAttribute('r', String(radius));
      c.setAttribute('fill', 'rgba(232,107,46,0.95)');
      c.setAttribute('stroke', '#0a0a0c');
      c.setAttribute('stroke-width', String(1.2 / scale));
      c.style.cursor = 'crosshair';
      c.setAttribute('data-block', block.id);
      c.setAttribute('data-side', s.side);
      const isHover = this.hoverHandle
        && this.hoverHandle.blockId === block.id
        && this.hoverHandle.side === s.side;
      if (isHover) {
        c.setAttribute('r', String(radius * 1.4));
        c.setAttribute('fill', 'rgba(61,232,200,0.95)');
      }
      c.addEventListener('mousedown', (ev) => this._onHandleDown(ev, block.id, s.side));
      this.handlesGroup.appendChild(c);
    }
  }

  _renderDragPreview(scale) {
    const ns = SVG_NS;
    const d = this.dragState;
    const blocksById = this._blocksById();
    const fromPt = resolveEndpoint({ block_id: d.fromBlock, side: d.fromSide }, blocksById);
    let toPt;
    let sideB = null;
    if (d.snapped) {
      const blk = blocksById.get(d.snapped.blockId);
      toPt = blockAnchor(blk.rect, d.snapped.side);
      sideB = d.snapped.side;
    } else {
      toPt = d.cursorImg;
    }
    const dPath = pathFor('orthogonal', fromPt, toPt, d.fromSide, sideB);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', dPath);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', d.snapped ? COLOUR_VAR.solved : COLOUR_VAR.accent);
    path.setAttribute('stroke-width', String(2.2 / scale));
    path.setAttribute('stroke-dasharray', `${6 / scale} ${4 / scale}`);
    this.previewGroup.appendChild(path);
  }

  _onHandleDown(ev, blockId, side) {
    if (this.mode !== 'editor') return;
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const img = this._imgPointFromClient(ev.clientX, ev.clientY);
    this.dragState = {
      kind: 'draw-arrow',
      fromBlock: blockId,
      fromSide: side,
      cursorImg: img,
      snapped: null,
    };
    this.requestDraw();
  }

  _onMouseDown(ev) {
    if (this.mode !== 'editor') return;
    if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-id')) {
      return;
    }
    if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-block')) {
      return;
    }
    if (ev.target === this.svg || ev.target === this.world || ev.target === this.arrowsGroup) {
      if (this.selectedId) {
        this.selectedId = null;
        this._hideProps();
        this.requestDraw();
      }
    }
  }

  _onMouseMove(ev) {
    if (!this.dragState || this.dragState.kind !== 'draw-arrow') {
      if (this.mode === 'editor') {
        this._updateHoverHandle(ev);
      }
      return;
    }
    const img = this._imgPointFromClient(ev.clientX, ev.clientY);
    this.dragState.cursorImg = img;
    this.dragState.snapped = this._findSnapTarget(img);
    this.requestDraw();
  }

  _onMouseUp(ev) {
    if (!this.dragState || this.dragState.kind !== 'draw-arrow') return;
    const d = this.dragState;
    this.dragState = null;
    if (d.snapped) {
      const newArrow = {
        id: this._nextId(),
        from: { block_id: d.fromBlock, side: d.fromSide },
        to:   { block_id: d.snapped.blockId, side: d.snapped.side },
        kind: 'orthogonal',
        label: '',
        style: 'solid',
        colour: 'accent',
      };
      this.arrows.push(newArrow);
      this.selectedId = newArrow.id;
      this.onArrowsChange();
      this.onScheduleSave();
      this._showProps(newArrow);
    }
    this.requestDraw();
  }

  _onContextMenu(ev) {
    if (this.mode !== 'editor') return;
    const id = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-id') : null;
    if (!id) return;
    ev.preventDefault();
    ev.stopPropagation();
    this._showContextMenu(ev.clientX, ev.clientY, id);
  }

  _updateHoverHandle(ev) {
    const img = this._imgPointFromClient(ev.clientX, ev.clientY);
    const target = this._findSnapTarget(img);
    const cur = this.hoverHandle;
    const next = target ? { blockId: target.blockId, side: target.side } : null;
    const changed = (cur && !next) || (!cur && next)
      || (cur && next && (cur.blockId !== next.blockId || cur.side !== next.side));
    if (changed) {
      this.hoverHandle = next;
      this.requestDraw();
    }
  }

  _findSnapTarget(imgPt) {
    const t = this.getTransform();
    const snapImg = SNAP_PX / (t.scale || 1);
    let best = null;
    let bestDist = snapImg;
    for (const b of this.getBlocks()) {
      const sides = ['left', 'right', 'top', 'bottom'];
      for (const s of sides) {
        const p = blockAnchor(b.rect, s);
        const d = Math.hypot(p.x - imgPt.x, p.y - imgPt.y);
        if (d < bestDist) {
          bestDist = d;
          best = { blockId: b.id, side: s };
        }
      }
    }
    return best;
  }

  _imgPointFromClient(cx, cy) {
    const t = this.getTransform();
    const r = this.viewport.getBoundingClientRect();
    return {
      x: (cx - r.left - t.panX) / t.scale,
      y: (cy - r.top  - t.panY) / t.scale,
    };
  }

  _nextId() {
    let n = this.arrows.length + 1;
    while (this.arrows.some((a) => a.id === `arr_${String(n).padStart(3, '0')}`)) n += 1;
    return `arr_${String(n).padStart(3, '0')}`;
  }

  _selectArrow(id) {
    this.selectedId = id;
    const a = this.arrows.find((x) => x.id === id);
    if (a) this._showProps(a);
    this.requestDraw();
  }

  _showContextMenu(x, y, id) {
    this._hideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${x}px`;
    menu.style.top  = `${y}px`;
    const editLabel = document.createElement('button');
    editLabel.textContent = tr('arrow_context_edit_label');
    editLabel.addEventListener('click', () => {
      this._hideContextMenu();
      this._selectArrow(id);
    });
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = tr('arrow_context_delete');
    del.addEventListener('click', () => {
      this._hideContextMenu();
      this._deleteArrow(id);
    });
    menu.appendChild(editLabel);
    menu.appendChild(del);
    document.body.appendChild(menu);
    this._contextMenuEl = menu;
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth - 6) menu.style.left = `${window.innerWidth - r.width - 6}px`;
    if (r.bottom > window.innerHeight - 6) menu.style.top = `${window.innerHeight - r.height - 6}px`;
    setTimeout(() => {
      const onDoc = (ev) => {
        if (!menu.contains(ev.target)) {
          this._hideContextMenu();
          document.removeEventListener('mousedown', onDoc);
        }
      };
      document.addEventListener('mousedown', onDoc);
    }, 0);
  }

  _hideContextMenu() {
    if (this._contextMenuEl && this._contextMenuEl.parentNode) {
      this._contextMenuEl.parentNode.removeChild(this._contextMenuEl);
    }
    this._contextMenuEl = null;
  }

  _showProps(arrow) {
    this._hideProps();
    const popover = document.createElement('div');
    popover.className = 'arrow-props';
    const blocksById = this._blocksById();
    const a = resolveEndpoint(arrow.from, blocksById);
    const b = resolveEndpoint(arrow.to,   blocksById);
    const sideA = arrow.from && arrow.from.side ? arrow.from.side : null;
    const sideB = arrow.to   && arrow.to.side   ? arrow.to.side   : null;
    const mid = midpointOf(arrow.kind, a, b, sideA, sideB);
    const t = this.getTransform();
    const r = this.viewport.getBoundingClientRect();
    const screenX = mid.x * t.scale + t.panX + r.left;
    const screenY = mid.y * t.scale + t.panY + r.top;
    popover.style.left = `${Math.max(8, Math.min(window.innerWidth - 270, screenX - 130))}px`;
    popover.style.top  = `${Math.max(8, Math.min(window.innerHeight - 220, screenY + 18))}px`;

    const mk = (key, choices, current, onChange) => {
      const row = document.createElement('div');
      row.className = 'arrow-props-row';
      const lab = document.createElement('label');
      lab.textContent = tr(key);
      row.appendChild(lab);
      const sel = document.createElement('select');
      for (const c of choices) {
        const opt = document.createElement('option');
        opt.value = c.value;
        opt.textContent = c.label;
        if (c.value === current) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => onChange(sel.value));
      row.appendChild(sel);
      return row;
    };

    popover.appendChild(mk('arrow_props_kind', [
      { value: 'orthogonal', label: tr('arrow_kind_orthogonal') },
      { value: 'manhattan',  label: tr('arrow_kind_manhattan')  },
      { value: 'bezier',     label: tr('arrow_kind_bezier')     },
      { value: 'straight',   label: tr('arrow_kind_straight')   },
    ], arrow.kind, (v) => {
      arrow.kind = isValidKind(v) ? v : 'orthogonal';
      this.onArrowsChange();
      this.onScheduleSave();
      this.requestDraw();
    }));

    popover.appendChild(mk('arrow_props_style', [
      { value: 'solid',  label: tr('arrow_style_solid')  },
      { value: 'dashed', label: tr('arrow_style_dashed') },
      { value: 'dotted', label: tr('arrow_style_dotted') },
    ], arrow.style, (v) => {
      arrow.style = isValidStyle(v) ? v : 'solid';
      this.onArrowsChange();
      this.onScheduleSave();
      this.requestDraw();
    }));

    popover.appendChild(mk('arrow_props_colour', [
      { value: 'accent',   label: tr('arrow_colour_accent')   },
      { value: 'solved',   label: tr('arrow_colour_solved')   },
      { value: 'partial',  label: tr('arrow_colour_partial')  },
      { value: 'unsolved', label: tr('arrow_colour_unsolved') },
      { value: 'muted',    label: tr('arrow_colour_muted')    },
    ], arrow.colour, (v) => {
      arrow.colour = isValidColour(v) ? v : 'accent';
      this.onArrowsChange();
      this.onScheduleSave();
      this.requestDraw();
    }));

    const labelRow = document.createElement('div');
    labelRow.className = 'arrow-props-row';
    const labelLab = document.createElement('label');
    labelLab.textContent = tr('arrow_props_label');
    labelRow.appendChild(labelLab);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = arrow.label || '';
    input.placeholder = tr('arrow_label_placeholder');
    input.addEventListener('input', () => {
      arrow.label = input.value;
      this.requestDraw();
    });
    input.addEventListener('change', () => {
      this.onArrowsChange();
      this.onScheduleSave();
    });
    labelRow.appendChild(input);
    popover.appendChild(labelRow);

    const actions = document.createElement('div');
    actions.className = 'arrow-props-actions';
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = tr('arrow_props_delete');
    del.addEventListener('click', () => this._deleteArrow(arrow.id));
    const close = document.createElement('button');
    close.textContent = tr('side_panel_close');
    close.addEventListener('click', () => {
      this.selectedId = null;
      this._hideProps();
      this.requestDraw();
    });
    actions.appendChild(del);
    actions.appendChild(close);
    popover.appendChild(actions);

    document.body.appendChild(popover);
    this._propsEl = popover;
  }

  _hideProps() {
    if (this._propsEl && this._propsEl.parentNode) {
      this._propsEl.parentNode.removeChild(this._propsEl);
    }
    this._propsEl = null;
  }

  _deleteArrow(id) {
    const idx = this.arrows.findIndex((a) => a.id === id);
    if (idx < 0) return;
    this.arrows.splice(idx, 1);
    if (this.selectedId === id) {
      this.selectedId = null;
      this._hideProps();
    }
    this.onArrowsChange();
    this.onScheduleSave();
    this.requestDraw();
  }

  retranslate() {
    if (this.selectedId) {
      const a = this.arrows.find((x) => x.id === this.selectedId);
      if (a) this._showProps(a);
    }
  }
}

export function normaliseArrow(a) {
  return {
    id: a.id,
    from: { ...(a.from || {}) },
    to: { ...(a.to || {}) },
    kind: isValidKind(a.kind) ? a.kind : 'orthogonal',
    label: typeof a.label === 'string' ? a.label : '',
    style: isValidStyle(a.style) ? a.style : 'solid',
    colour: isValidColour(a.colour) ? a.colour : 'accent',
  };
}

export async function loadArrows() {
  try {
    const res = await fetch('data/arrows.json', { cache: 'no-cache' });
    if (!res.ok) return { version: 1, arrows: [] };
    const data = await res.json();
    return { version: data.version || 1, arrows: Array.isArray(data.arrows) ? data.arrows : [] };
  } catch (e) {
    void e;
    return { version: 1, arrows: [] };
  }
}
