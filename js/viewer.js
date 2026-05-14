/* Canvas-based viewer that composites the world from per-block WebPs.
   Pan/zoom + hotspot rendering. Hotspot click only fires when pointer travel
   < 5 px between mousedown and mouseup. */

import { lodFor } from './lod.js';

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const CLICK_SLOP = 5;
const STATUS_TOKEN = {
  'solved':   '--status-solved',
  'partial':  '--status-partial',
  'unsolved': '--status-unsolved',
  'no-data':  '--status-nodata',
  'dead-end': '--status-deadend',
};
const STATUS_FILL_ALPHA = {
  'solved':   { base: 0.18, hover: 0.32 },
  'partial':  { base: 0.18, hover: 0.34 },
  'unsolved': { base: 0.18, hover: 0.34 },
  'no-data':  { base: 0.14, hover: 0.28 },
  'dead-end': { base: 0.14, hover: 0.28 },
};

function readCssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch (e) {
    void e;
    return fallback;
  }
}

function hexToRgb(hex) {
  const m = String(hex).trim().match(/^#?([0-9a-fA-F]{3,8})$/);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 4) h = h.split('').map((c) => c + c).join('').slice(0, 8);
  if (h.length !== 6 && h.length !== 8) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return { r, g, b };
}

function rgba(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

const HANDLE_SIZE = 8;
const HANDLE_KEYS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export class Viewer {
  constructor(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.blocks = [];
    this.blockImages = new Map();
    this.imageReady = false;
    this.imageW = 0;
    this.imageH = 0;
    this.bgColour = '#f6f6f8';
    this.statusPalette = {};
    this.borderColour = '#d8d8e0';
    this.accentColour = '#2e6fe8';
    this.handleStrokeColour = '#ffffff';
    this._refreshPalette();

    this.scale = 1;
    this.panX = 0;
    this.panY = 0;

    this.hotspots = [];
    this.groups = [];
    this.statusFilter = new Set(['solved', 'partial', 'unsolved', 'no-data', 'dead-end']);
    this.activeFilter = 'all';
    this.fadeNonMatching = true;
    this.searchTerm = '';
    this.searchMatches = null;
    this.hoverId = null;
    this.activeId = null;
    this.outlineHighlightId = null;
    this.tooltip = null;
    this.selection = new Set();

    this.mode = 'viewer';
    this.createMode = 'block';
    this.editorOptions = options || {};
    this.onHotspotClick = options.onHotspotClick || (() => {});
    this.onHotspotDoubleClick = options.onHotspotDoubleClick || (() => {});
    this.onHotspotRightClick = options.onHotspotRightClick || (() => {});
    this.onCanvasDrawRect = options.onCanvasDrawRect || (() => {});
    this.onCanvasRightClick = options.onCanvasRightClick || (() => {});
    this.onTransformChange = options.onTransformChange || (() => {});
    this.onSelectionChange = options.onSelectionChange || (() => {});
    this.onMarqueeSelect = options.onMarqueeSelect || (() => {});
    this.onDragSelection = options.onDragSelection || (() => {});
    this.onDragSelectionEnd = options.onDragSelectionEnd || (() => {});

    this.dragState = null;
    this.drawPreviewEl = options.drawPreviewEl || null;
    this.cursorPos = null;

    this._raf = null;
    this._subscribers = new Set();

    this._installEvents();
    this._installResize();
  }

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  _notifySubscribers(kind, payload) {
    for (const fn of this._subscribers) {
      try { fn(kind, payload); } catch (e) { console.warn('[viewer] subscriber failed', e); }
    }
  }

  getLod() { return lodFor(this.scale); }

  async setBlocks(blocks) {
    this.blocks = blocks.map((b) => ({ id: b.id, rect: { ...b.rect }, file: b.file }));
    this._computeBounds();
    await Promise.all(this.blocks.map((b) => this._loadBlockImage(b)));
    this.imageReady = true;
    this._refreshBg();
    this._refreshPalette();
    this.fitToScreen();
    this.requestDraw();
    return { w: this.imageW, h: this.imageH };
  }

  async addBlock(block) {
    if (!block || !block.id) return;
    const existing = this.blocks.findIndex((b) => b.id === block.id);
    const entry = { id: block.id, rect: { ...block.rect }, file: block.file };
    if (existing >= 0) this.blocks[existing] = entry;
    else this.blocks.push(entry);
    this._computeBounds();
    await this._loadBlockImage(entry);
    this.requestDraw();
  }

  removeBlock(id) {
    const i = this.blocks.findIndex((b) => b.id === id);
    if (i >= 0) {
      this.blocks.splice(i, 1);
      this.blockImages.delete(id);
      this._computeBounds();
      this.requestDraw();
    }
  }

  async refreshBlock(block) {
    if (!block || !block.id) return;
    const i = this.blocks.findIndex((b) => b.id === block.id);
    if (i < 0) { return this.addBlock(block); }
    this.blocks[i] = { id: block.id, rect: { ...block.rect }, file: block.file };
    this.blockImages.delete(block.id);
    await this._loadBlockImage(this.blocks[i]);
    this.requestDraw();
  }

  _loadBlockImage(b) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.blockImages.set(b.id, img);
        resolve();
      };
      img.onerror = () => {
        console.warn('[viewer] failed to load', b.file);
        resolve();
      };
      img.src = b.file;
    });
  }

  _computeBounds() {
    let maxX = 0;
    let maxY = 0;
    for (const b of this.blocks) {
      const right  = b.rect.x + b.rect.w;
      const bottom = b.rect.y + b.rect.h;
      if (right  > maxX) maxX = right;
      if (bottom > maxY) maxY = bottom;
    }
    this.imageW = maxX;
    this.imageH = maxY;
  }

  setBackgroundFromCSS() {
    this._refreshBg();
    this._refreshPalette();
    this.requestDraw();
  }

  _refreshBg() {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      if (v) this.bgColour = v;
    } catch (e) {
      void e;
    }
  }

  _refreshPalette() {
    this.borderColour = readCssVar('--panel-border', this.borderColour);
    this.accentColour = readCssVar('--accent', this.accentColour);
    this.handleStrokeColour = readCssVar('--panel-bg', this.handleStrokeColour);
    const next = {};
    for (const [status, token] of Object.entries(STATUS_TOKEN)) {
      const stroke = readCssVar(token, '#888888');
      const alphas = STATUS_FILL_ALPHA[status];
      next[status] = {
        stroke,
        fill:      rgba(stroke, alphas.base),
        fillHover: rgba(stroke, alphas.hover),
      };
    }
    this.statusPalette = next;
  }

  setHotspots(hotspots) {
    this.hotspots = hotspots;
    this.requestDraw();
  }

  setGroups(groups) {
    this.groups = groups;
    this.requestDraw();
  }

  setSelection(ids) {
    if (ids instanceof Set) this.selection = new Set(ids);
    else if (Array.isArray(ids)) this.selection = new Set(ids);
    else this.selection = new Set();
    this.requestDraw();
  }

  setCreateMode(mode) {
    this.createMode = mode || 'block';
  }

  setStatusFilter(filterSet, opts) {
    this.statusFilter = filterSet instanceof Set ? filterSet : new Set(filterSet);
    const o = opts || {};
    this.fadeNonMatching = o.fade !== false;
    this.activeFilter = o.activeFilter || this.activeFilter;
    this._notifySubscribers('filter', { filter: this.statusFilter, activeFilter: this.activeFilter });
    this.requestDraw();
  }

  setOutlineHighlight(id) {
    if (this.outlineHighlightId === id) return;
    this.outlineHighlightId = id;
    this.requestDraw();
  }

  setSearchTerm(term, matchIds) {
    this.searchTerm = term || '';
    this.searchMatches = matchIds && matchIds.size ? matchIds : null;
    this.requestDraw();
  }

  setActiveId(id) {
    this.activeId = id;
    this.requestDraw();
  }

  setMode(mode) {
    this.mode = mode;
    this.canvas.parentElement.classList.toggle('editor', mode === 'editor');
    this.requestDraw();
  }

  fitToScreen() {
    if (!this.imageReady) return;
    const r = this.canvas.getBoundingClientRect();
    const vw = r.width;
    const vh = r.height;
    if (vw <= 0 || vh <= 0) return;
    const s = Math.min(vw / this.imageW, vh / this.imageH) * 0.96;
    this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    this.panX = (vw - this.imageW * this.scale) / 2;
    this.panY = (vh - this.imageH * this.scale) / 2;
    this._notifyTransform();
    this.requestDraw();
  }

  zoomAt(cx, cy, factor) {
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale * factor));
    if (newScale === this.scale) return;
    const ratio = newScale / this.scale;
    this.panX = cx - ratio * (cx - this.panX);
    this.panY = cy - ratio * (cy - this.panY);
    this.scale = newScale;
    this._notifyTransform();
    this.requestDraw();
  }

  centerOnHotspot(h) {
    if (!h || !this.imageReady) return;
    const r = this.canvas.getBoundingClientRect();
    const targetScale = Math.max(this.scale, 1.4);
    this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, targetScale));
    const cx = h.rect.x + h.rect.w / 2;
    const cy = h.rect.y + h.rect.h / 2;
    this.panX = r.width / 2 - cx * this.scale;
    this.panY = r.height / 2 - cy * this.scale;
    this._notifyTransform();
    this.requestDraw();
  }

  imagePointFromClient(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.panX) / this.scale,
      y: (clientY - r.top - this.panY) / this.scale,
    };
  }

  hotspotAtImagePoint(pt) {
    for (let i = this.hotspots.length - 1; i >= 0; i--) {
      const h = this.hotspots[i];
      if (!this._isVisible(h)) continue;
      const { x, y, w, h: hh } = h.rect;
      if (pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + hh) return h;
    }
    return null;
  }

  groupAtImagePoint(pt) {
    let best = null;
    let bestArea = Infinity;
    for (const g of this.groups) {
      const { x, y, w, h } = g.rect;
      if (pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h) {
        const area = w * h;
        if (area < bestArea) {
          bestArea = area;
          best = g;
        }
      }
    }
    return best;
  }

  selectableAtImagePoint(pt) {
    const h = this.hotspotAtImagePoint(pt);
    if (h) return h;
    return this.groupAtImagePoint(pt);
  }

  nodesInsideRect(rect) {
    const out = [];
    const r = { x: Math.min(rect.x, rect.x + rect.w), y: Math.min(rect.y, rect.y + rect.h),
                w: Math.abs(rect.w), h: Math.abs(rect.h) };
    const inside = (n) => n.rect.x >= r.x && n.rect.y >= r.y
      && n.rect.x + n.rect.w <= r.x + r.w && n.rect.y + n.rect.h <= r.y + r.h;
    for (const h of this.hotspots) if (inside(h)) out.push(h.id);
    for (const g of this.groups) if (inside(g)) out.push(g.id);
    return out;
  }

  handleAtImagePoint(h, pt) {
    if (!h) return null;
    const { x, y, w, h: hh } = h.rect;
    const tol = HANDLE_SIZE / this.scale;
    const handles = this._handlePositions(x, y, w, hh);
    for (const { key, hx, hy } of handles) {
      if (Math.abs(pt.x - hx) <= tol && Math.abs(pt.y - hy) <= tol) return key;
    }
    return null;
  }

  _handlePositions(x, y, w, h) {
    return [
      { key: 'nw', hx: x,       hy: y       },
      { key: 'n',  hx: x + w/2, hy: y       },
      { key: 'ne', hx: x + w,   hy: y       },
      { key: 'e',  hx: x + w,   hy: y + h/2 },
      { key: 'se', hx: x + w,   hy: y + h   },
      { key: 's',  hx: x + w/2, hy: y + h   },
      { key: 'sw', hx: x,       hy: y + h   },
      { key: 'w',  hx: x,       hy: y + h/2 },
    ];
  }

  _isVisible(h) {
    if (this.fadeNonMatching) return true;
    if (!this.statusFilter.has(h.status)) return false;
    return true;
  }

  _matchesFilter(h) {
    return this.statusFilter.has(h.status);
  }

  _matchesSearch(h) {
    if (!this.searchMatches) return true;
    return this.searchMatches.has(h.id);
  }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._draw();
    });
  }

  _notifyTransform() {
    this.onTransformChange({ scale: this.scale, panX: this.panX, panY: this.panY });
    this._notifySubscribers('transform', { scale: this.scale, panX: this.panX, panY: this.panY });
  }

  notifyNodesChanged() {
    this._notifySubscribers('nodes', null);
    this.requestDraw();
  }

  _draw() {
    const c = this.canvas;
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    if (c.width !== Math.floor(r.width * dpr) || c.height !== Math.floor(r.height * dpr)) {
      c.width = Math.floor(r.width * dpr);
      c.height = Math.floor(r.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.bgColour;
    ctx.fillRect(0, 0, r.width, r.height);

    if (!this.imageReady) return;

    ctx.save();
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);
    ctx.imageSmoothingEnabled = this.scale < 1.5;
    ctx.imageSmoothingQuality = 'high';

    const lod = this.getLod();

    for (const g of this.groups) {
      this._drawGroup(ctx, g);
    }

    if (lod.thumbnailsVisible) {
      for (const b of this.blocks) {
        const img = this.blockImages.get(b.id);
        if (!img) continue;
        ctx.drawImage(img, b.rect.x, b.rect.y, b.rect.w, b.rect.h);
      }
    } else {
      ctx.fillStyle = rgba(this.borderColour, 0.55);
      for (const b of this.blocks) {
        ctx.fillRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
      }
    }

    for (const h of this.hotspots) {
      if (!this._isVisible(h)) continue;
      if (h.kind === 'sticky') this._drawSticky(ctx, h, lod);
      else this._drawHotspot(ctx, h, lod);
    }

    if (this.dragState && this.dragState.kind === 'draw' && this.dragState.current) {
      const s = this.dragState.start;
      const cur = this.dragState.current;
      const x = Math.min(s.x, cur.x);
      const y = Math.min(s.y, cur.y);
      const w = Math.abs(cur.x - s.x);
      const h = Math.abs(cur.y - s.y);
      ctx.lineWidth = 2 / this.scale;
      ctx.strokeStyle = this.accentColour;
      ctx.fillStyle = rgba(this.accentColour, 0.12);
      ctx.setLineDash([8 / this.scale, 6 / this.scale]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }

    if (this.dragState && this.dragState.kind === 'marquee' && this.dragState.current) {
      const s = this.dragState.start;
      const cur = this.dragState.current;
      const x = Math.min(s.x, cur.x);
      const y = Math.min(s.y, cur.y);
      const w = Math.abs(cur.x - s.x);
      const h = Math.abs(cur.y - s.y);
      ctx.lineWidth = 1.6 / this.scale;
      ctx.strokeStyle = this.accentColour;
      ctx.fillStyle = rgba(this.accentColour, 0.08);
      ctx.setLineDash([6 / this.scale, 4 / this.scale]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }

    ctx.restore();

    this._updateTooltip();
  }

  _drawGroup(ctx, g) {
    const { x, y, w, h } = g.rect;
    ctx.save();
    ctx.fillStyle = rgba(this.accentColour, 0.06);
    ctx.fillRect(x, y, w, h);
    ctx.lineWidth = 1.6 / this.scale;
    ctx.strokeStyle = rgba(this.accentColour, 0.55);
    ctx.setLineDash([8 / this.scale, 5 / this.scale]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    if (this.selection.has(g.id) || this.activeId === g.id) {
      ctx.lineWidth = 2.4 / this.scale;
      ctx.strokeStyle = this.accentColour;
      ctx.setLineDash([]);
      ctx.strokeRect(x, y, w, h);
    }
    if (g.label && this.scale > 0.25) {
      const fontPx = Math.max(11, Math.min(18, 13 / this.scale));
      ctx.font = `600 ${fontPx}px var(--font-mono)`;
      ctx.fillStyle = this.accentColour;
      ctx.textBaseline = 'top';
      ctx.fillText(g.label, x + 8 / this.scale, y + 6 / this.scale);
    }
    ctx.restore();
  }

  _drawSticky(ctx, h, lod) {
    const { x, y, w, h: hh } = h.rect;
    const hash = this._stickyAngleHash(h.id);
    const angleDeg = ((hash % 41) - 20) * 0.18;
    const angleRad = angleDeg * Math.PI / 180;
    const cx = x + w / 2;
    const cy = y + hh / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleRad);
    ctx.translate(-cx, -cy);
    const isHover = this.hoverId === h.id || this.activeId === h.id || this.selection.has(h.id);
    const stickyFill = '#fff3b0';
    const stickyEdge = '#d6b65a';
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 6 / this.scale;
    ctx.shadowOffsetY = 2 / this.scale;
    ctx.fillStyle = stickyFill;
    ctx.fillRect(x, y, w, hh);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = isHover ? this.accentColour : stickyEdge;
    ctx.lineWidth = (isHover ? 2.4 : 1.4) / this.scale;
    ctx.strokeRect(x, y, w, hh);
    if (this.scale > 0.4 && lod && lod.edgeLabelsVisible) {
      const fontPx = Math.max(11, Math.min(20, 14 / this.scale));
      ctx.font = `500 ${fontPx}px var(--font-ui)`;
      ctx.fillStyle = '#3a2a06';
      ctx.textBaseline = 'top';
      const padding = 8 / this.scale;
      const text = h.title || '';
      const maxChars = Math.max(8, Math.floor(w / (fontPx * 0.55)));
      const shown = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
      ctx.fillText(shown, x + padding, y + padding);
    }
    ctx.restore();
  }

  _stickyAngleHash(id) {
    let h = 0;
    const s = String(id || '');
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  _drawHotspot(ctx, h, lod) {
    const c = this.statusPalette[h.status] || this.statusPalette.unsolved || { stroke: this.borderColour, fill: 'transparent', fillHover: 'transparent' };
    const searchDim = this.searchTerm && !this._matchesSearch(h);
    const filterDim = this.fadeNonMatching && !this._matchesFilter(h);
    const isHover = this.hoverId === h.id || this.activeId === h.id;
    const isOutlineHL = this.outlineHighlightId === h.id;
    const isSelected = this.selection.has(h.id);
    const { x, y, w, h: hh } = h.rect;

    let alpha = 1;
    if (filterDim) alpha = 0.1;
    else if (searchDim) alpha = 0.3;

    ctx.lineWidth = (isHover || isOutlineHL || isSelected ? 2.5 : 1.6) / this.scale;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = c.stroke;
    ctx.fillStyle = isHover ? c.fillHover : c.fill;
    ctx.fillRect(x, y, w, hh);
    ctx.strokeRect(x, y, w, hh);

    if (isOutlineHL || isSelected) {
      ctx.save();
      ctx.lineWidth = 3 / this.scale;
      ctx.strokeStyle = this.accentColour;
      ctx.globalAlpha = alpha;
      const pad = 3 / this.scale;
      ctx.strokeRect(x - pad, y - pad, w + pad * 2, hh + pad * 2);
      ctx.restore();
    }

    if (this.mode === 'editor' && lod && lod.handlesVisible && (isHover || this.activeId === h.id)) {
      ctx.fillStyle = this.accentColour;
      ctx.strokeStyle = this.handleStrokeColour;
      ctx.lineWidth = 1.5 / this.scale;
      const handles = this._handlePositions(x, y, w, hh);
      const hs = HANDLE_SIZE / this.scale;
      for (const { hx, hy } of handles) {
        ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
        ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
      }
    }
    ctx.globalAlpha = 1;
  }

  _updateTooltip() {
    if (!this.tooltip) return;
    if (!this.hoverId || !this.cursorPos) {
      this.tooltip.style.display = 'none';
      return;
    }
    const h = this.hotspots.find((x) => x.id === this.hoverId);
    if (!h) {
      this.tooltip.style.display = 'none';
      return;
    }
    this.tooltip.textContent = h.title;
    this.tooltip.style.display = 'block';
    this.tooltip.style.left = `${this.cursorPos.x + 14}px`;
    this.tooltip.style.top = `${this.cursorPos.y + 14}px`;
  }

  attachTooltip(el) { this.tooltip = el; }

  _installEvents() {
    const c = this.canvas;
    c.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    c.addEventListener('mousedown', this._onMouseDown.bind(this));
    window.addEventListener('mousemove', this._onMouseMove.bind(this));
    window.addEventListener('mouseup', this._onMouseUp.bind(this));
    c.addEventListener('mouseleave', () => {
      this.hoverId = null;
      this.cursorPos = null;
      this._updateTooltip();
      this.requestDraw();
    });
    c.addEventListener('contextmenu', this._onContextMenu.bind(this));
    c.addEventListener('dblclick', this._onDoubleClick.bind(this));
  }

  _onDoubleClick(ev) {
    const img = this.imagePointFromClient(ev.clientX, ev.clientY);
    const target = this.selectableAtImagePoint(img);
    if (!target) return;
    ev.preventDefault();
    this.onHotspotDoubleClick(target.id, ev);
  }

  _installResize() {
    const ro = new ResizeObserver(() => this.requestDraw());
    ro.observe(this.canvas);
    window.addEventListener('resize', () => this.requestDraw());
  }

  _onWheel(ev) {
    ev.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.zoomAt(ev.clientX - r.left, ev.clientY - r.top, factor);
  }

  _onMouseDown(ev) {
    if (ev.button !== 0) return;
    const screen = { x: ev.clientX, y: ev.clientY };
    const img = this.imagePointFromClient(ev.clientX, ev.clientY);

    if (this.mode === 'editor') {
      const hover = this.hotspotAtImagePoint(img);
      if (hover) {
        const handle = this.handleAtImagePoint(hover, img);
        if (handle && !ev.shiftKey) {
          this.dragState = {
            kind: 'resize',
            handle,
            id: hover.id,
            origRect: { ...hover.rect },
            startImg: img,
            moved: false,
          };
          return;
        }
        this.dragState = {
          kind: 'edit-click',
          id: hover.id,
          kindOfTarget: 'hotspot',
          shiftKey: !!ev.shiftKey,
          startScreen: screen,
          startImg: img,
          moved: false,
        };
        return;
      }
      const grp = this.groupAtImagePoint(img);
      if (grp) {
        this.dragState = {
          kind: 'edit-click',
          id: grp.id,
          kindOfTarget: 'group',
          shiftKey: !!ev.shiftKey,
          startScreen: screen,
          startImg: img,
          moved: false,
        };
        return;
      }
      if (ev.shiftKey) {
        this.dragState = {
          kind: 'marquee',
          start: img,
          current: img,
          startScreen: screen,
          shiftKey: true,
          moved: false,
        };
        return;
      }
      this.dragState = {
        kind: 'draw',
        start: img,
        current: img,
        startScreen: screen,
        moved: false,
      };
      return;
    }

    const hover = this.hotspotAtImagePoint(img);
    this.dragState = {
      kind: 'pan',
      startScreen: screen,
      startPan: { x: this.panX, y: this.panY },
      candidateHotspot: hover ? hover.id : null,
      moved: false,
    };
    this.canvas.parentElement.classList.add('grabbing');
  }

  _onMouseMove(ev) {
    const r = this.canvas.getBoundingClientRect();
    this.cursorPos = { x: ev.clientX - r.left, y: ev.clientY - r.top };

    if (!this.dragState) {
      const img = this.imagePointFromClient(ev.clientX, ev.clientY);
      const hover = this.hotspotAtImagePoint(img);
      const newHover = hover ? hover.id : null;
      if (newHover !== this.hoverId) {
        this.hoverId = newHover;
        this.canvas.style.cursor = newHover ? 'pointer' : (this.mode === 'editor' ? 'crosshair' : 'grab');
        this.requestDraw();
      } else {
        this._updateTooltip();
      }
      return;
    }

    const d = this.dragState;
    const dx = ev.clientX - d.startScreen.x;
    const dy = ev.clientY - (d.startScreen ? d.startScreen.y : 0);
    if (Math.abs(dx) > CLICK_SLOP || Math.abs(dy) > CLICK_SLOP) {
      d.moved = true;
    }

    if (d.kind === 'pan') {
      this.panX = d.startPan.x + dx;
      this.panY = d.startPan.y + dy;
      this._notifyTransform();
      this.requestDraw();
      return;
    }
    if (d.kind === 'draw' || d.kind === 'marquee') {
      d.current = this.imagePointFromClient(ev.clientX, ev.clientY);
      this.requestDraw();
      return;
    }
    if (d.kind === 'drag-selection') {
      const img = this.imagePointFromClient(ev.clientX, ev.clientY);
      const dxImg = img.x - d.startImg.x;
      const dyImg = img.y - d.startImg.y;
      this.onDragSelection({ ids: d.ids, dx: dxImg, dy: dyImg });
      this.requestDraw();
      return;
    }
    if (d.kind === 'resize') {
      const img = this.imagePointFromClient(ev.clientX, ev.clientY);
      const dxImg = img.x - d.startImg.x;
      const dyImg = img.y - d.startImg.y;
      const rect = { ...d.origRect };
      if (d.handle.includes('n')) { rect.y = d.origRect.y + dyImg; rect.h = d.origRect.h - dyImg; }
      if (d.handle.includes('s')) { rect.h = d.origRect.h + dyImg; }
      if (d.handle.includes('w')) { rect.x = d.origRect.x + dxImg; rect.w = d.origRect.w - dxImg; }
      if (d.handle.includes('e')) { rect.w = d.origRect.w + dxImg; }
      if (rect.w < 8) { rect.w = 8; rect.x = d.origRect.x + d.origRect.w - 8; }
      if (rect.h < 8) { rect.h = 8; rect.y = d.origRect.y + d.origRect.h - 8; }
      const idx = this.hotspots.findIndex((h) => h.id === d.id);
      if (idx >= 0) {
        this.hotspots[idx] = { ...this.hotspots[idx], rect };
        this.requestDraw();
        if (this.editorOptions.onHotspotResize) {
          this.editorOptions.onHotspotResize(d.id, rect);
        }
      }
      return;
    }
    if (d.kind === 'edit-click') {
      if (d.moved && !d.shiftKey) {
        const ids = this.selection.has(d.id)
          ? Array.from(this.selection)
          : [d.id];
        if (!this.selection.has(d.id)) {
          this.setSelection(new Set([d.id]));
          this.onSelectionChange({ ids });
        }
        d.kind = 'drag-selection';
        d.ids = ids;
        d.startImg = this.imagePointFromClient(d.startScreen.x, d.startScreen.y);
        d.lastImg = this.imagePointFromClient(ev.clientX, ev.clientY);
      }
      return;
    }
  }

  _onMouseUp(ev) {
    if (!this.dragState) return;
    const d = this.dragState;
    this.dragState = null;
    this.canvas.parentElement.classList.remove('grabbing');

    if (d.kind === 'pan') {
      if (!d.moved && d.candidateHotspot) {
        this.onHotspotClick(d.candidateHotspot, ev);
      }
      return;
    }
    if (d.kind === 'draw') {
      const start = d.start;
      const cur = d.current || this.imagePointFromClient(ev.clientX, ev.clientY);
      if (!d.moved) {
        return;
      }
      const x = Math.min(start.x, cur.x);
      const y = Math.min(start.y, cur.y);
      const w = Math.abs(cur.x - start.x);
      const h = Math.abs(cur.y - start.y);
      if (w < 10 || h < 10) return;
      this.onCanvasDrawRect({ x, y, w, h, mode: this.createMode });
      this.requestDraw();
      return;
    }
    if (d.kind === 'marquee') {
      if (!d.moved) {
        if (!d.shiftKey) {
          this.setSelection(new Set());
          this.onSelectionChange({ ids: [] });
        }
        return;
      }
      const cur = d.current || this.imagePointFromClient(ev.clientX, ev.clientY);
      const rect = {
        x: Math.min(d.start.x, cur.x),
        y: Math.min(d.start.y, cur.y),
        w: Math.abs(cur.x - d.start.x),
        h: Math.abs(cur.y - d.start.y),
      };
      if (rect.w < 5 || rect.h < 5) return;
      const ids = this.nodesInsideRect(rect);
      const next = d.shiftKey ? new Set(this.selection) : new Set();
      for (const id of ids) next.add(id);
      this.setSelection(next);
      this.onMarqueeSelect({ rect, ids: Array.from(next), shiftKey: !!d.shiftKey });
      this.onSelectionChange({ ids: Array.from(next) });
      return;
    }
    if (d.kind === 'drag-selection') {
      const img = this.imagePointFromClient(ev.clientX, ev.clientY);
      const dxImg = img.x - d.startImg.x;
      const dyImg = img.y - d.startImg.y;
      this.onDragSelectionEnd({ ids: d.ids, dx: dxImg, dy: dyImg });
      return;
    }
    if (d.kind === 'edit-click') {
      if (!d.moved) {
        if (d.shiftKey) {
          const next = new Set(this.selection);
          if (next.has(d.id)) next.delete(d.id);
          else next.add(d.id);
          this.setSelection(next);
          this.onSelectionChange({ ids: Array.from(next) });
          return;
        }
        this.setSelection(new Set([d.id]));
        this.onSelectionChange({ ids: [d.id] });
        if (d.kindOfTarget !== 'group') {
          this.onHotspotClick(d.id, ev);
        }
      }
      return;
    }
    if (d.kind === 'resize') {
      if (this.editorOptions.onHotspotResizeEnd) {
        this.editorOptions.onHotspotResizeEnd(d.id);
      }
      return;
    }
  }

  _onContextMenu(ev) {
    ev.preventDefault();
    if (this.mode !== 'editor') return;
    const img = this.imagePointFromClient(ev.clientX, ev.clientY);
    const hover = this.hotspotAtImagePoint(img);
    if (hover) {
      this.onHotspotRightClick(hover.id, ev);
      return;
    }
    const grp = this.groupAtImagePoint(img);
    if (grp) {
      this.onHotspotRightClick(grp.id, ev);
      return;
    }
    this.onCanvasRightClick(ev, { img });
  }

  getScale() { return this.scale; }
  getImageSize() { return { w: this.imageW, h: this.imageH }; }
  getTransform() { return { scale: this.scale, panX: this.panX, panY: this.panY }; }
  getBlocks() { return this.blocks; }
  getHotspots() { return this.hotspots; }
  getCanvas() { return this.canvas; }

  setTransform(t) {
    if (!t) return;
    if (Number.isFinite(t.scale)) this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, t.scale));
    if (Number.isFinite(t.panX))  this.panX  = t.panX;
    if (Number.isFinite(t.panY))  this.panY  = t.panY;
    this._notifyTransform();
    this.requestDraw();
  }

  centerOnPoint(wx, wy) {
    const r = this.canvas.getBoundingClientRect();
    this.panX = r.width / 2  - wx * this.scale;
    this.panY = r.height / 2 - wy * this.scale;
    this._notifyTransform();
    this.requestDraw();
  }
}
