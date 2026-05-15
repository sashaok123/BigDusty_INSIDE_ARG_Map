/* Freehand annotation layer. Strokes are stored as world-space polylines
   in `state.pen.strokes` and rendered as an SVG overlay above nodes/arrows
   but below comments and UI. Active when the pen tool is selected. Provides
   a floating toolbar with color, width, eraser, and clear-all controls. */

import { tr } from './i18n.js';
import { getActiveTool, onActiveToolChange } from './tools.js';

const SAMPLE_INTERVAL_MS = 20;
const SVG_NS = 'http://www.w3.org/2000/svg';

const COLOR_SWATCHES = [
  '#e83d3d',
  '#e88a3d',
  '#e8c83d',
  '#3de88a',
  '#3dc8e8',
  '#9a6ce8',
  '#16181c',
  '#ffffff',
];

const DEFAULT_COLOR = '#e83d3d';
const DEFAULT_WIDTH = 3;
const MIN_WIDTH = 1;
const MAX_WIDTH = 12;
const ERASE_HIT_PADDING = 6;

function newStrokeId() {
  return `stroke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pointsToPath(points) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.01} ${p.y + 0.01}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

function distancePointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const fx = px - cx;
  const fy = py - cy;
  return Math.sqrt(fx * fx + fy * fy);
}

export class PenLayer {
  constructor(opts) {
    this.viewport = opts.viewport;
    this.viewer = opts.viewer;
    this.getTransform = opts.getTransform || (() => ({ scale: 1, panX: 0, panY: 0 }));
    this.getStrokes = opts.getStrokes || (() => []);
    this.onCommitStroke = opts.onCommitStroke || (() => {});
    this.onDeleteStroke = opts.onDeleteStroke || (() => {});
    this.onClearAll = opts.onClearAll || (() => {});
    this.onConfirm = opts.onConfirm || ((msg) => window.confirm(msg));
    this.isEditMode = opts.isEditMode || (() => true);

    this.currentColor = DEFAULT_COLOR;
    this.currentWidth = DEFAULT_WIDTH;
    this.eraserMode = false;

    this._active = false;
    this._drawing = null;
    this._lastSampleAt = 0;
    this._raf = null;
    this._selectedIds = new Set();

    this._build();
    this._wire();
    this._applyActiveTool(getActiveTool());
    onActiveToolChange((t) => this._applyActiveTool(t));
    document.addEventListener('i18n:changed', () => this._retranslate());
  }

  getSelectedStrokeIds() {
    return new Set(this._selectedIds);
  }

  setSelectedStrokeIds(ids) {
    const next = new Set();
    if (ids && typeof ids[Symbol.iterator] === 'function') {
      for (const id of ids) if (id) next.add(id);
    }
    this._selectedIds = next;
    this.requestDraw();
  }

  clearStrokeSelection() {
    if (this._selectedIds.size === 0) return;
    this._selectedIds = new Set();
    this.requestDraw();
  }

  hitTestStrokeAt(worldPoint, tolerancePx) {
    if (!worldPoint) return null;
    const t = this.getTransform();
    const tol = (Number.isFinite(tolerancePx) ? tolerancePx : 5) / Math.max(0.0001, t.scale);
    const list = this.getStrokes();
    if (!Array.isArray(list) || !list.length) return null;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (!s || !Array.isArray(s.points) || s.points.length === 0) continue;
      const hitDist = (s.width || 1) / Math.max(0.0001, t.scale) / 2 + tol;
      if (s.points.length === 1) {
        const dx = s.points[0].x - worldPoint.x;
        const dy = s.points[0].y - worldPoint.y;
        if (Math.sqrt(dx * dx + dy * dy) <= hitDist) return s.id;
        continue;
      }
      for (let j = 1; j < s.points.length; j++) {
        const a = s.points[j - 1];
        const b = s.points[j];
        if (distancePointToSegment(worldPoint.x, worldPoint.y, a.x, a.y, b.x, b.y) <= hitDist) return s.id;
      }
    }
    return null;
  }

  strokeIdsInsideRect(rect) {
    const out = [];
    if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)
        || !Number.isFinite(rect.w) || !Number.isFinite(rect.h)) return out;
    const minX = rect.x;
    const minY = rect.y;
    const maxX = rect.x + rect.w;
    const maxY = rect.y + rect.h;
    const list = this.getStrokes();
    if (!Array.isArray(list) || !list.length) return out;
    for (const s of list) {
      if (!s || !Array.isArray(s.points) || !s.points.length) continue;
      for (const p of s.points) {
        if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY) { out.push(s.id); break; }
      }
    }
    return out;
  }

  deleteStrokeIds(ids, opts) {
    if (!ids || !ids.length) return 0;
    let removed = 0;
    for (const id of ids) {
      if (!id) continue;
      try { this.onDeleteStroke(id, opts || {}); removed += 1; } catch (e) { void e; }
    }
    this._selectedIds = new Set();
    this.requestDraw();
    return removed;
  }

  _build() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('id', 'pen-layer');
    svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:650;';
    this.svg = svg;
    const transformGroup = document.createElementNS(SVG_NS, 'g');
    transformGroup.setAttribute('class', 'pen-strokes');
    this.transformGroup = transformGroup;
    svg.appendChild(transformGroup);
    if (this.viewport) this.viewport.appendChild(svg);

    const bar = document.createElement('div');
    bar.id = 'pen-toolbar';
    bar.className = 'pen-toolbar';
    bar.style.display = 'none';
    bar.innerHTML = `
      <div class="pen-toolbar-row pen-colors"></div>
      <div class="pen-toolbar-row pen-width-row">
        <span class="pen-label" data-pen-label="width">${tr('pen_width_label')}</span>
        <input type="range" class="pen-width-slider" min="${MIN_WIDTH}" max="${MAX_WIDTH}" value="${this.currentWidth}">
        <span class="pen-width-value">${this.currentWidth}</span>
      </div>
      <div class="pen-toolbar-row pen-actions">
        <button type="button" class="pen-eraser" data-pen-label="eraser">${tr('pen_eraser')}</button>
        <button type="button" class="pen-clear" data-pen-label="clear">${tr('pen_clear_all')}</button>
      </div>
    `;
    document.body.appendChild(bar);
    this.toolbarEl = bar;
    this.colorsRow = bar.querySelector('.pen-colors');
    this.widthSliderEl = bar.querySelector('.pen-width-slider');
    this.widthValueEl = bar.querySelector('.pen-width-value');
    this.eraserBtnEl = bar.querySelector('.pen-eraser');
    this.clearBtnEl = bar.querySelector('.pen-clear');

    for (const color of COLOR_SWATCHES) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'pen-swatch';
      sw.style.backgroundColor = color;
      sw.dataset.color = color;
      sw.title = color;
      sw.setAttribute('aria-label', color);
      this.colorsRow.appendChild(sw);
    }
    this._syncSwatches();
  }

  _wire() {
    if (this.colorsRow) {
      this.colorsRow.addEventListener('click', (ev) => {
        const btn = ev.target && ev.target.closest && ev.target.closest('.pen-swatch');
        if (!btn) return;
        this.currentColor = btn.dataset.color || DEFAULT_COLOR;
        this.eraserMode = false;
        this._syncSwatches();
        this._syncEraserBtn();
      });
    }
    if (this.widthSliderEl) {
      this.widthSliderEl.addEventListener('input', (ev) => {
        const v = parseInt(ev.target.value, 10);
        if (Number.isFinite(v)) {
          this.currentWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, v));
          if (this.widthValueEl) this.widthValueEl.textContent = String(this.currentWidth);
        }
      });
    }
    if (this.eraserBtnEl) {
      this.eraserBtnEl.addEventListener('click', () => {
        this.eraserMode = !this.eraserMode;
        this._syncEraserBtn();
      });
    }
    if (this.clearBtnEl) {
      this.clearBtnEl.addEventListener('click', () => {
        const list = this.getStrokes();
        if (!list || !list.length) return;
        const ok = this.onConfirm(tr('pen_clear_confirm'));
        Promise.resolve(ok).then((flag) => {
          if (flag) this.onClearAll();
        });
      });
    }
    if (this.svg) {
      this.svg.addEventListener('mousedown', (ev) => this._onMouseDown(ev));
    }
    window.addEventListener('mousemove', (ev) => this._onMouseMove(ev));
    window.addEventListener('mouseup', (ev) => this._onMouseUp(ev));
  }

  _syncSwatches() {
    if (!this.colorsRow) return;
    const buttons = this.colorsRow.querySelectorAll('.pen-swatch');
    buttons.forEach((b) => {
      b.classList.toggle('active', b.dataset.color === this.currentColor);
    });
  }

  _syncEraserBtn() {
    if (!this.eraserBtnEl) return;
    this.eraserBtnEl.classList.toggle('active', this.eraserMode);
  }

  _applyActiveTool(tool) {
    const next = tool === 'pen';
    if (next === this._active) return;
    this._active = next;
    if (this.svg) this.svg.style.pointerEvents = next ? 'auto' : 'none';
    if (this.toolbarEl) this.toolbarEl.style.display = next ? '' : 'none';
    this.requestDraw();
  }

  isActive() { return this._active; }

  setEditMode(active) {
    void active;
    this.requestDraw();
  }

  _retranslate() {
    if (!this.toolbarEl) return;
    const widthLabel = this.toolbarEl.querySelector('[data-pen-label="width"]');
    if (widthLabel) widthLabel.textContent = tr('pen_width_label');
    if (this.eraserBtnEl) this.eraserBtnEl.textContent = tr('pen_eraser');
    if (this.clearBtnEl) this.clearBtnEl.textContent = tr('pen_clear_all');
  }

  _viewportPointToWorld(clientX, clientY) {
    if (!this.viewport) return { x: 0, y: 0 };
    const r = this.viewport.getBoundingClientRect();
    const t = this.getTransform();
    const sx = clientX - r.left;
    const sy = clientY - r.top;
    return {
      x: (sx - t.panX) / t.scale,
      y: (sy - t.panY) / t.scale,
    };
  }

  _onMouseDown(ev) {
    if (!this._active) return;
    if (ev.button !== 0) return;
    if (!this.isEditMode()) return;
    ev.preventDefault();
    const pt = this._viewportPointToWorld(ev.clientX, ev.clientY);
    if (this.eraserMode) {
      this._eraseAtPoint(pt);
      return;
    }
    this._drawing = {
      id: newStrokeId(),
      color: this.currentColor,
      width: this.currentWidth,
      points: [pt],
    };
    this._lastSampleAt = performance.now ? performance.now() : Date.now();
    this.requestDraw();
  }

  _onMouseMove(ev) {
    if (!this._drawing) return;
    const now = performance.now ? performance.now() : Date.now();
    if (now - this._lastSampleAt < SAMPLE_INTERVAL_MS) return;
    this._lastSampleAt = now;
    const pt = this._viewportPointToWorld(ev.clientX, ev.clientY);
    this._drawing.points.push(pt);
    this.requestDraw();
  }

  _onMouseUp() {
    if (!this._drawing) return;
    const stroke = this._drawing;
    this._drawing = null;
    if (!stroke.points || stroke.points.length === 0) {
      this.requestDraw();
      return;
    }
    try { this.onCommitStroke(stroke); } catch (e) { console.warn('[pen-layer] commit failed', e); }
    this.requestDraw();
  }

  _eraseAtPoint(pt) {
    const t = this.getTransform();
    const padding = ERASE_HIT_PADDING / Math.max(0.0001, t.scale);
    const list = this.getStrokes();
    if (!list || !list.length) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (!s || !Array.isArray(s.points) || s.points.length === 0) continue;
      const hitDist = (s.width || 1) / Math.max(0.0001, t.scale) / 2 + padding;
      if (s.points.length === 1) {
        const dx = s.points[0].x - pt.x;
        const dy = s.points[0].y - pt.y;
        if (Math.sqrt(dx * dx + dy * dy) <= hitDist) {
          try { this.onDeleteStroke(s.id); } catch (e) { console.warn('[pen-layer] delete failed', e); }
          this.requestDraw();
          return;
        }
        continue;
      }
      for (let j = 1; j < s.points.length; j++) {
        const a = s.points[j - 1];
        const b = s.points[j];
        if (distancePointToSegment(pt.x, pt.y, a.x, a.y, b.x, b.y) <= hitDist) {
          try { this.onDeleteStroke(s.id); } catch (e) { console.warn('[pen-layer] delete failed', e); }
          this.requestDraw();
          return;
        }
      }
    }
  }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._draw();
    });
  }

  _draw() {
    if (!this.svg || !this.transformGroup) return;
    const t = this.getTransform();
    this.transformGroup.setAttribute('transform', `translate(${t.panX} ${t.panY}) scale(${t.scale})`);
    const strokes = Array.isArray(this.getStrokes()) ? this.getStrokes() : [];
    const all = this._drawing ? strokes.concat([this._drawing]) : strokes;
    let html = '';
    for (const s of all) {
      if (!s || !Array.isArray(s.points) || s.points.length === 0) continue;
      const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, s.width || DEFAULT_WIDTH));
      const c = typeof s.color === 'string' ? s.color : DEFAULT_COLOR;
      const safeColor = c.replace(/[<>"']/g, '');
      const d = pointsToPath(s.points);
      const widthPx = w / Math.max(0.0001, t.scale);
      const isSelected = s.id && this._selectedIds.has(s.id);
      if (isSelected) {
        const haloWidth = widthPx * 2.2 + 4 / Math.max(0.0001, t.scale);
        html += `<path d="${d}" stroke="#e86b2e" stroke-opacity="0.45" stroke-width="${haloWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
      }
      html += `<path d="${d}" stroke="${safeColor}" stroke-width="${widthPx}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
    }
    this.transformGroup.innerHTML = html;
  }
}

export { COLOR_SWATCHES as PEN_COLORS, DEFAULT_COLOR as PEN_DEFAULT_COLOR, DEFAULT_WIDTH as PEN_DEFAULT_WIDTH };
