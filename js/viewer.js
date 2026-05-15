/* Canvas-based viewer that composites the world from per-block WebPs.
   Pan/zoom + hotspot rendering. Hotspot click only fires when pointer travel
   < 5 px between mousedown and mouseup. */

import { lodFor } from './lod.js';
import { pickTextColor, pickTextStroke, bgFromTheme, relativeLuminance } from './contrast.js';
import { getActiveTool, isSpaceHeld, setActiveTool } from './tools.js';
import { VERIFICATION_STRIPE } from './nodes.js';

const COLOR_PRESET_BG = {
  '':  null,
  '1': '#e83d3d',
  '2': '#e88a3d',
  '3': '#e8c83d',
  '4': '#3de88a',
  '5': '#3dc8e8',
  '6': '#9a6ce8',
};

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

function pickSelectionStroke(fillColor, accentColor) {
  const lum = relativeLuminance(fillColor);
  if (lum > 0.55) return '#0b1a3a';
  if (lum < 0.18) return '#ffffff';
  return accentColor;
}

const HANDLE_SIZE = 10;
const HANDLE_KEYS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_CURSORS = {
  nw: 'nwse-resize',
  n:  'ns-resize',
  ne: 'nesw-resize',
  e:  'ew-resize',
  se: 'nwse-resize',
  s:  'ns-resize',
  sw: 'nesw-resize',
  w:  'ew-resize',
};

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
    this.cardBg = '#ffffff';
    this.cardText = '#16181c';
    this.cardBorder = '#d8d8e0';
    this.transformBg = '#f8f5ed';
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
    this.onSelectStrokeAtPoint = options.onSelectStrokeAtPoint || null;
    this.onClearStrokeSelection = options.onClearStrokeSelection || null;
    this.onStrokeRightClick = options.onStrokeRightClick || null;
    this.onStrokeHover = options.onStrokeHover || null;

    this.dragState = null;
    this.drawPreviewEl = options.drawPreviewEl || null;
    this.cursorPos = null;

    this.provenance = null;
    this.lockedNodes = options.lockedNodes || new Map();
    this.getLockedNodes = options.getLockedNodes || null;

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
    this.blocks = blocks.map((b) => ({
      id: b.id, rect: { ...b.rect }, file: b.file,
      annotations: Array.isArray(b.annotations) ? b.annotations.map((a) => ({ ...a })) : null,
    }));
    this._computeBounds();
    this.imageReady = true;
    this._refreshBg();
    this._refreshPalette();
    this.fitToScreen();
    this._loadVisibleBlocks();
    this.requestDraw();
    return { w: this.imageW, h: this.imageH };
  }

  async addBlock(block) {
    if (!block || !block.id) return;
    const existing = this.blocks.findIndex((b) => b.id === block.id);
    const entry = {
      id: block.id, rect: { ...block.rect }, file: block.file,
      annotations: Array.isArray(block.annotations) ? block.annotations.map((a) => ({ ...a })) : null,
    };
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
    this.blocks[i] = {
      id: block.id, rect: { ...block.rect }, file: block.file,
      annotations: Array.isArray(block.annotations) ? block.annotations.map((a) => ({ ...a })) : null,
    };
    this.blockImages.delete(block.id);
    await this._loadBlockImage(this.blocks[i]);
    this.requestDraw();
  }

  setBlockAnnotations(id, annotations) {
    const i = this.blocks.findIndex((b) => b.id === id);
    if (i < 0) return;
    this.blocks[i].annotations = Array.isArray(annotations) ? annotations.map((a) => ({ ...a })) : null;
    this.requestDraw();
  }

  updateBlockRect(id, rect) {
    const i = this.blocks.findIndex((b) => b.id === id);
    if (i >= 0) {
      this.blocks[i].rect = { ...rect };
      this._computeBounds();
      this.requestDraw();
    }
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

  _isBlockNearViewport(b) {
    if (!this.canvas) return true;
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return true;
    const margin = Math.max(r.width, r.height) * 2;
    const screenX = b.rect.x * this.scale + this.panX;
    const screenY = b.rect.y * this.scale + this.panY;
    const screenW = b.rect.w * this.scale;
    const screenH = b.rect.h * this.scale;
    return (
      screenX + screenW > -margin &&
      screenY + screenH > -margin &&
      screenX < r.width + margin &&
      screenY < r.height + margin
    );
  }

  _loadVisibleBlocks() {
    if (!this.blocks || !this.blocks.length) return;
    const pending = [];
    for (const b of this.blocks) {
      if (this.blockImages.has(b.id) || this._loadingBlocks?.has(b.id)) continue;
      if (!this._isBlockNearViewport(b)) continue;
      pending.push(b);
    }
    if (!pending.length) return;
    if (!this._loadingBlocks) this._loadingBlocks = new Set();
    for (const b of pending) {
      this._loadingBlocks.add(b.id);
      this._loadBlockImage(b).then(() => {
        if (this._loadingBlocks) this._loadingBlocks.delete(b.id);
        this.requestDraw();
      });
    }
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
      const style = getComputedStyle(document.documentElement);
      const canvasBg = style.getPropertyValue('--canvas-bg').trim();
      const fallback = style.getPropertyValue('--bg').trim();
      const v = canvasBg || fallback;
      if (v) this.bgColour = v;
    } catch (e) {
      void e;
    }
  }

  _refreshPalette() {
    this.borderColour = readCssVar('--card-border', readCssVar('--panel-border', this.borderColour));
    this.accentColour = readCssVar('--accent', this.accentColour);
    this.handleStrokeColour = readCssVar('--panel-bg', this.handleStrokeColour);
    this.cardBg = readCssVar('--card-bg', readCssVar('--panel-bg', this.cardBg));
    this.cardText = readCssVar('--card-text', readCssVar('--text', this.cardText));
    this.cardBorder = readCssVar('--card-border', this.borderColour);
    this.transformBg = readCssVar('--transform-bg', this.transformBg);
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

  updateHotspot(view) {
    if (!view || !view.id) return false;
    const i = this.hotspots.findIndex((h) => h.id === view.id);
    if (i < 0) { this.hotspots.push(view); this.requestDraw(); return true; }
    this.hotspots[i] = view;
    this.requestDraw();
    return true;
  }

  removeHotspot(id) {
    const i = this.hotspots.findIndex((h) => h.id === id);
    if (i < 0) return false;
    this.hotspots.splice(i, 1);
    this.requestDraw();
    return true;
  }

  setGroups(groups) {
    this.groups = groups;
    this.requestDraw();
  }

  updateGroup(view) {
    if (!view || !view.id) return false;
    const i = this.groups.findIndex((g) => g.id === view.id);
    if (i < 0) { this.groups.push(view); this.requestDraw(); return true; }
    this.groups[i] = view;
    this.requestDraw();
    return true;
  }

  removeGroup(id) {
    const i = this.groups.findIndex((g) => g.id === id);
    if (i < 0) return false;
    this.groups.splice(i, 1);
    this.requestDraw();
    return true;
  }

  invalidateNode(id) {
    this.requestDraw();
    void id;
  }

  setLockedNodes(map) {
    this.lockedNodes = map instanceof Map ? map : new Map();
    this.requestDraw();
  }

  _getLockInfo(id) {
    const map = (typeof this.getLockedNodes === 'function') ? this.getLockedNodes() : this.lockedNodes;
    if (!map || typeof map.get !== 'function') return null;
    return map.get(id) || null;
  }

  setProvenance(p) {
    if (!p || !p.active) {
      this.provenance = null;
    } else {
      this.provenance = {
        active: true,
        selectedId: p.selectedId || null,
        ancestors: p.ancestors instanceof Set ? p.ancestors : new Set(p.ancestors || []),
        descendants: p.descendants instanceof Set ? p.descendants : new Set(p.descendants || []),
        dimAlpha: typeof p.dimAlpha === 'number' ? p.dimAlpha : 0.2,
      };
    }
    this.requestDraw();
  }

  _provenanceOpacityFor(id) {
    if (!this.provenance || !this.provenance.active) return 1;
    const p = this.provenance;
    if (id === p.selectedId) return 1;
    if (p.ancestors.has(id) || p.descendants.has(id)) return 1;
    return typeof p.dimAlpha === 'number' ? p.dimAlpha : 0.2;
  }

  _provenanceOutlineFor(id) {
    if (!this.provenance || !this.provenance.active) return null;
    const p = this.provenance;
    if (id === p.selectedId) return this.accentColour;
    if (p.ancestors.has(id)) return this.accentColour;
    if (p.descendants.has(id)) return rgba(this.accentColour, 0.55);
    return null;
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
    this._updateCursor();
    this.requestDraw();
  }

  refreshCursor() { this._updateCursor(); }

  _updateCursor() {
    if (!this.canvas) return;
    if (this.mode !== 'editor') {
      this.canvas.style.cursor = this.hoverId ? 'pointer' : 'grab';
      return;
    }
    if (isSpaceHeld()) {
      this.canvas.style.cursor = 'grab';
      return;
    }
    const t = getActiveTool();
    if (t === 'pan') { this.canvas.style.cursor = 'grab'; return; }
    if (t === 'arrow') { this.canvas.style.cursor = 'crosshair'; return; }
    if (t === 'block' || t === 'sticky' || t === 'text' || t === 'group' || t === 'transform') {
      this.canvas.style.cursor = 'crosshair';
      return;
    }
    if (this.hoverId) {
      const locked = this._isLocked(this.hoverId);
      this.canvas.style.cursor = locked ? 'pointer' : 'move';
      return;
    }
    this.canvas.style.cursor = 'default';
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

  fitToRect(rect) {
    if (!rect || !this.imageReady) return;
    const r = this.canvas.getBoundingClientRect();
    const vw = r.width;
    const vh = r.height;
    if (vw <= 0 || vh <= 0) return;
    const pad = 0.85;
    const s = Math.min(vw / Math.max(rect.w, 1), vh / Math.max(rect.h, 1)) * pad;
    this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    this.panX = vw / 2 - cx * this.scale;
    this.panY = vh / 2 - cy * this.scale;
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

  blockAtImagePoint(pt) {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i];
      const { x, y, w, h } = b.rect;
      if (pt.x >= x && pt.x <= x + w && pt.y >= y && pt.y <= y + h) return b;
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
    for (const b of this.blocks) if (inside(b)) out.push(b.id);
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

  _handleAtPoint(pt) {
    if (this.mode !== 'editor') return null;
    const tool = getActiveTool();
    if (tool !== 'select') return null;
    for (const h of this.hotspots) {
      if (h.locked) continue;
      if (!(this.selection.has(h.id) || this.activeId === h.id || this.hoverId === h.id)) continue;
      const k = this.handleAtImagePoint(h, pt);
      if (k) return { key: k, id: h.id, isImage: this._isImageHotspot(h) };
    }
    for (const b of this.blocks) {
      if (this._isLocked(b.id)) continue;
      if (!(this.selection.has(b.id) || this.activeId === b.id)) continue;
      const k = this.handleAtImagePoint(b, pt);
      if (k) return { key: k, id: b.id, isImage: true };
    }
    return null;
  }

  _isImageHotspot(h) {
    if (!h) return false;
    if (h.kind === 'block') return true;
    if (h.type === 'file' && typeof h.file === 'string' && /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?.*)?$/i.test(h.file)) return true;
    return false;
  }

  setResizeHints(imageHint, lockedHint) {
    this._handleHintImage = typeof imageHint === 'string' ? imageHint : '';
    this._handleHintLocked = typeof lockedHint === 'string' ? lockedHint : '';
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
    if (typeof this._loadVisibleBlocks === 'function') this._loadVisibleBlocks();
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
        const provOpacity = this._provenanceOpacityFor(b.id);
        if (provOpacity !== 1) {
          ctx.save();
          ctx.globalAlpha = provOpacity;
        }
        ctx.drawImage(img, b.rect.x, b.rect.y, b.rect.w, b.rect.h);
        if (Array.isArray(b.annotations) && b.annotations.length) {
          this._drawBlockAnnotations(ctx, b);
        }
        if (provOpacity !== 1) ctx.restore();
        const provOutline = this._provenanceOutlineFor(b.id);
        if (provOutline) {
          ctx.save();
          ctx.lineWidth = 3 / this.scale;
          ctx.strokeStyle = provOutline;
          ctx.strokeRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
          ctx.restore();
        }
        if (this.mode === 'editor' && this.selection.has(b.id)) {
          ctx.save();
          ctx.lineWidth = 4.2 / this.scale;
          ctx.strokeStyle = 'rgba(255,255,255,0.92)';
          ctx.strokeRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
          ctx.lineWidth = 2.4 / this.scale;
          ctx.strokeStyle = this.accentColour;
          ctx.strokeRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
          const locked = this._isLocked(b.id);
          if (!locked && lod && lod.handlesVisible) {
            ctx.fillStyle = this.accentColour;
            ctx.strokeStyle = this.handleStrokeColour;
            ctx.lineWidth = 1.5 / this.scale;
            const handles = this._handlePositions(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
            const hs = HANDLE_SIZE / this.scale;
            for (const { hx, hy } of handles) {
              ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
              ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
            }
          }
          if (locked && this.scale > 0.2) {
            this._drawLockBadge(ctx, b.rect.x + b.rect.w, b.rect.y);
          }
          ctx.restore();
        }
      }
    } else {
      ctx.fillStyle = rgba(this.borderColour, 0.55);
      for (const b of this.blocks) {
        ctx.fillRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h);
      }
    }

    for (const h of this.hotspots) {
      if (!this._isVisible(h)) continue;
      if (this.provenance && this.provenance.active) {
        const op = this._provenanceOpacityFor(h.id);
        h.provenanceOpacity = op === 1 ? undefined : op;
        const ol = this._provenanceOutlineFor(h.id);
        h.provenanceOutline = ol || undefined;
      } else if (h.provenanceOpacity !== undefined || h.provenanceOutline !== undefined) {
        h.provenanceOpacity = undefined;
        h.provenanceOutline = undefined;
      }
      if (h.kind === 'sticky') this._drawSticky(ctx, h, lod);
      else if (h.kind === 'text') this._drawText(ctx, h, lod);
      else if (h.kind === 'transform') this._drawTransform(ctx, h, lod);
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
    const provOp = this._provenanceOpacityFor(g.id);
    if (provOp !== 1) ctx.globalAlpha = provOp;
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
    if (typeof h.provenanceOpacity === 'number') ctx.globalAlpha = h.provenanceOpacity;
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
    if (isHover) {
      ctx.lineWidth = 4.2 / this.scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeRect(x, y, w, hh);
    }
    ctx.strokeStyle = isHover ? this.accentColour : stickyEdge;
    ctx.lineWidth = (isHover ? 2.4 : 1.4) / this.scale;
    ctx.strokeRect(x, y, w, hh);
    if (this.scale > 0.4 && lod && lod.edgeLabelsVisible) {
      const fontPx = Math.max(11, Math.min(20, 14 / this.scale));
      ctx.font = `500 ${fontPx}px var(--font-ui)`;
      ctx.fillStyle = pickTextColor(stickyFill, { dark: '#3a2a06' });
      ctx.textBaseline = 'top';
      const padding = 8 / this.scale;
      const text = h.title || '';
      const maxChars = Math.max(8, Math.floor(w / (fontPx * 0.55)));
      const shown = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
      ctx.fillText(shown, x + padding, y + padding);
    }
    if (h.locked && this.scale > 0.2) {
      this._drawLockBadge(ctx, x + w, y);
    }
    ctx.restore();
  }

  _drawText(ctx, h, lod) {
    const { x, y, w, h: hh } = h.rect;
    const isHover = this.hoverId === h.id || this.activeId === h.id || this.selection.has(h.id);
    const isOutlineHL = this.outlineHighlightId === h.id;
    const ts = h.text_style || h.textStyle || {};
    ctx.save();
    if (typeof h.provenanceOpacity === 'number') ctx.globalAlpha = h.provenanceOpacity;
    if (this.scale > 0.25 && lod && lod.edgeLabelsVisible) {
      const sizeMap = { S: 12, M: 16, L: 20, XL: 28 };
      const baseSize = sizeMap[ts.size] || 16;
      const fontPx = Math.max(11, Math.min(40, baseSize / this.scale));
      const family = ts.family === 'mono' ? 'var(--font-mono)'
                   : ts.family === 'serif' ? 'Georgia, serif'
                   : 'var(--font-ui)';
      ctx.font = `400 ${fontPx}px ${family}`;
      let fillCol;
      if (ts.color && ts.color !== 'auto' && ts.color !== '') {
        fillCol = ts.color;
      } else {
        fillCol = pickTextColor(this.bgColour);
      }
      const strokeCol = pickTextStroke(this.bgColour);
      const align = ts.align === 'center' ? 'center' : ts.align === 'right' ? 'right' : 'left';
      ctx.textAlign = align;
      ctx.textBaseline = 'top';
      const text = h.title || '';
      const wrap = ts.wrap !== 'none';
      let drawX = x;
      if (align === 'center') drawX = x + w / 2;
      else if (align === 'right') drawX = x + w;
      if (wrap) {
        const lines = this._wrapTextLines(ctx, text, w, fontPx);
        let lineY = y;
        const strokeW = Math.max(1.4, 2 / this.scale);
        for (const ln of lines) {
          ctx.lineWidth = strokeW;
          ctx.strokeStyle = strokeCol;
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.strokeText(ln, drawX, lineY);
          ctx.fillStyle = fillCol;
          ctx.fillText(ln, drawX, lineY);
          lineY += fontPx * 1.2;
          if (lineY > y + hh - fontPx) break;
        }
      } else {
        const maxChars = Math.max(8, Math.floor(w / (fontPx * 0.55)));
        const shown = text.length > maxChars ? text.slice(0, maxChars - 1) + '…' : text;
        const strokeW = Math.max(1.4, 2 / this.scale);
        ctx.lineWidth = strokeW;
        ctx.strokeStyle = strokeCol;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.strokeText(shown, drawX, y);
        ctx.fillStyle = fillCol;
        ctx.fillText(shown, drawX, y);
      }
      ctx.textAlign = 'left';
    }
    if (this.mode === 'editor' && (isHover || isOutlineHL || this.selection.has(h.id))) {
      ctx.lineWidth = 3 / this.scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.setLineDash([6 / this.scale, 4 / this.scale]);
      ctx.strokeRect(x, y, w, hh);
      ctx.lineWidth = 1.4 / this.scale;
      ctx.strokeStyle = this.accentColour;
      ctx.strokeRect(x, y, w, hh);
      ctx.setLineDash([]);
      if (lod && lod.handlesVisible && !h.locked) {
        ctx.fillStyle = this.accentColour;
        ctx.strokeStyle = this.handleStrokeColour;
        ctx.lineWidth = 1.4 / this.scale;
        const handles = this._handlePositions(x, y, w, hh);
        const hs = HANDLE_SIZE / this.scale;
        for (const { hx, hy } of handles) {
          ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
          ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
        }
      }
    }
    if (h.locked && this.scale > 0.2) {
      this._drawLockBadge(ctx, x + w, y);
    }
    ctx.restore();
  }

  _wrapTextLines(ctx, text, maxWidth, fontPx) {
    const paragraphs = String(text || '').split('\n');
    const lines = [];
    for (const para of paragraphs) {
      if (!para) { lines.push(''); continue; }
      const words = para.split(' ');
      let line = '';
      for (const w of words) {
        const candidate = line ? line + ' ' + w : w;
        const width = ctx.measureText(candidate).width;
        if (width > maxWidth && line) { lines.push(line); line = w; }
        else line = candidate;
      }
      if (line) lines.push(line);
    }
    void fontPx;
    return lines;
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
    if (typeof h.branchOpacity === 'number' && h.branchOpacity < alpha) alpha = h.branchOpacity;
    if (typeof h.provenanceOpacity === 'number' && h.provenanceOpacity < alpha) alpha = h.provenanceOpacity;

    ctx.lineWidth = (isHover || isOutlineHL || isSelected ? 2.5 : 1.6) / this.scale;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.cardBg;
    ctx.fillRect(x, y, w, hh);
    ctx.strokeStyle = h.provenanceOutline ? h.provenanceOutline : c.stroke;
    ctx.fillStyle = isHover ? c.fillHover : c.fill;
    ctx.fillRect(x, y, w, hh);
    if (h.provenanceOutline) {
      ctx.lineWidth = Math.max(ctx.lineWidth, 3 / this.scale);
    }
    ctx.strokeRect(x, y, w, hh);

    if (h.verification) {
      const stripeColor = VERIFICATION_STRIPE[h.verification];
      if (stripeColor) {
        const sw = 3 / this.scale;
        ctx.save();
        ctx.fillStyle = stripeColor;
        ctx.globalAlpha = alpha;
        ctx.fillRect(x, y, sw, hh);
        ctx.restore();
      }
    }

    if (h.bookmarked && this.scale > 0.2) {
      this._drawBookmarkStar(ctx, x + w, y, alpha);
    }

    if (isOutlineHL || isSelected) {
      ctx.save();
      ctx.globalAlpha = alpha;
      const pad = 3 / this.scale;
      ctx.lineWidth = 5 / this.scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeRect(x - pad, y - pad, w + pad * 2, hh + pad * 2);
      ctx.lineWidth = 3 / this.scale;
      ctx.strokeStyle = pickSelectionStroke(c.stroke, this.accentColour);
      ctx.strokeRect(x - pad, y - pad, w + pad * 2, hh + pad * 2);
      ctx.restore();
    }

    if (this.mode === 'editor' && lod && lod.handlesVisible && (isHover || this.activeId === h.id || isSelected) && !h.locked) {
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
    if (h.locked && this.scale > 0.2) {
      this._drawLockBadge(ctx, x + w, y);
    }
    const lockInfo = this._getLockInfo(h.id);
    if (lockInfo && this.scale > 0.25) {
      this._drawEditingBadge(ctx, x, y, lockInfo.username || '');
    }
    ctx.globalAlpha = 1;
  }

  _drawEditingBadge(ctx, x, y, username) {
    ctx.save();
    const s = 1 / this.scale;
    const padX = 6 * s;
    const padY = 3 * s;
    const fontPx = Math.max(10, Math.min(13, 11 / this.scale));
    ctx.font = `600 ${fontPx}px var(--font-mono)`;
    const prefix = '🔒 ';
    const label = `${prefix}@${username || 'anon'}`;
    const tw = ctx.measureText(label).width;
    const boxW = tw + padX * 2;
    const boxH = fontPx + padY * 2;
    ctx.fillStyle = 'rgba(232,107,46,0.92)';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(x, y - boxH - 2 * s, boxW, boxH, 3 * s);
      ctx.fill();
    } else {
      ctx.fillRect(x, y - boxH - 2 * s, boxW, boxH);
    }
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x + padX, y - boxH - 2 * s + padY);
    ctx.restore();
  }

  _drawBlockAnnotations(ctx, b) {
    const img = this.blockImages.get(b.id);
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const sx = b.rect.w / img.naturalWidth;
    const sy = b.rect.h / img.naturalHeight;
    ctx.save();
    for (const a of b.annotations) {
      if (!a || typeof a !== 'object') continue;
      const dx = b.rect.x + (a.x || 0) * sx;
      const dy = b.rect.y + (a.y || 0) * sy;
      const dw = (a.w || 0) * sx;
      const dh = (a.h || 0) * sy;
      const col = (typeof a.color === 'string' && a.color) ? a.color : '#e8c83d';
      const stroke = Number.isFinite(a.strokeWidth) ? a.strokeWidth : 2;
      const w = (stroke * Math.max(sx, sy)) / this.scale;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = Math.max(0.6, w);
      if (a.kind === 'rect') {
        ctx.strokeRect(dx, dy, dw, dh);
        if (a.text && this.scale > 0.4) {
          const fontPx = Math.max(10, 12 / this.scale);
          ctx.font = `600 ${fontPx}px var(--font-mono)`;
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = col;
          ctx.fillText(a.text, dx, dy - 2 / this.scale);
        }
      } else if (a.kind === 'circle') {
        ctx.beginPath();
        const rx = dw / 2; const ry = dh / 2;
        if (rx > 0 && ry > 0) {
          ctx.ellipse(dx + rx, dy + ry, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (a.kind === 'arrow') {
        ctx.beginPath();
        ctx.moveTo(dx, dy);
        ctx.lineTo(dx + dw, dy + dh);
        ctx.stroke();
        const ang = Math.atan2(dh, dw);
        const ah = 10 / this.scale;
        const aw = 5 / this.scale;
        const tipX = dx + dw;
        const tipY = dy + dh;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - ah * Math.cos(ang) + aw * Math.sin(ang), tipY - ah * Math.sin(ang) - aw * Math.cos(ang));
        ctx.lineTo(tipX - ah * Math.cos(ang) - aw * Math.sin(ang), tipY - ah * Math.sin(ang) + aw * Math.cos(ang));
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
      } else if (a.kind === 'label') {
        const text = a.text || '';
        if (!text) continue;
        const fontPx = Math.max(11, 13 / this.scale);
        ctx.font = `600 ${fontPx}px var(--font-mono)`;
        const tw = ctx.measureText(text).width;
        const padX = 6 / this.scale;
        const padY = 3 / this.scale;
        const boxW = tw + padX * 2;
        const boxH = fontPx + padY * 2;
        ctx.fillStyle = col;
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(dx, dy, boxW, boxH, 3 / this.scale);
          ctx.fill();
        } else {
          ctx.fillRect(dx, dy, boxW, boxH);
        }
        ctx.fillStyle = pickTextColor(col, { dark: '#16181c', light: '#ffffff' });
        ctx.textBaseline = 'top';
        ctx.fillText(text, dx + padX, dy + padY);
      }
    }
    ctx.restore();
  }

  _drawTransform(ctx, h, lod) {
    const { x, y, w, h: hh } = h.rect;
    const c = this.statusPalette[h.status] || this.statusPalette.unsolved || { stroke: this.borderColour, fill: 'transparent', fillHover: 'transparent' };
    const isHover = this.hoverId === h.id || this.activeId === h.id;
    const isOutlineHL = this.outlineHighlightId === h.id;
    const isSelected = this.selection.has(h.id);
    const searchDim = this.searchTerm && !this._matchesSearch(h);
    const filterDim = this.fadeNonMatching && !this._matchesFilter(h);
    let alpha = 1;
    if (filterDim) alpha = 0.1;
    else if (searchDim) alpha = 0.3;
    if (typeof h.branchOpacity === 'number' && h.branchOpacity < alpha) alpha = h.branchOpacity;
    if (typeof h.provenanceOpacity === 'number' && h.provenanceOpacity < alpha) alpha = h.provenanceOpacity;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.transformBg;
    ctx.fillRect(x, y, w, hh);
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = (isHover || isOutlineHL || isSelected ? 2.5 : 1.6) / this.scale;
    ctx.strokeRect(x, y, w, hh);

    const titleH = (h.title && h.title.trim()) ? Math.min(20, hh * 0.18) : 0;
    const remaining = hh - titleH;
    const rowH = remaining / 3;
    const midY = y + titleH + rowH;
    const botY = y + titleH + rowH * 2;
    ctx.strokeStyle = rgba(c.stroke, 0.55);
    ctx.lineWidth = 1 / this.scale;
    ctx.beginPath();
    ctx.moveTo(x, midY); ctx.lineTo(x + w, midY);
    ctx.moveTo(x, botY); ctx.lineTo(x + w, botY);
    if (titleH > 0) { ctx.moveTo(x, y + titleH); ctx.lineTo(x + w, y + titleH); }
    ctx.stroke();

    if (h.verification) {
      const stripeColor = VERIFICATION_STRIPE[h.verification];
      if (stripeColor) {
        const sw = 3 / this.scale;
        ctx.fillStyle = stripeColor;
        ctx.fillRect(x, y, sw, hh);
      }
    }

    if (this.scale > 0.25 && lod && lod.edgeLabelsVisible) {
      const fontPx = Math.max(10, Math.min(15, 12 / this.scale));
      const padX = 8 / this.scale;
      const padY = 4 / this.scale;
      ctx.fillStyle = pickTextColor(this.transformBg, { dark: '#1a1a22', light: this.cardText });
      ctx.textBaseline = 'top';

      if (titleH > 0) {
        ctx.font = `600 ${Math.min(fontPx, titleH * 0.7)}px var(--font-ui)`;
        const tt = h.title || '';
        const maxChars = Math.max(8, Math.floor(w / (fontPx * 0.55)));
        const shown = tt.length > maxChars ? tt.slice(0, maxChars - 1) + '…' : tt;
        ctx.fillText(shown, x + padX, y + padY);
      }

      ctx.font = `400 ${fontPx}px var(--font-mono)`;
      const inp = h.input || '';
      const inpMax = Math.max(8, Math.floor((w - padX * 2) / (fontPx * 0.6)));
      const inpShown = inp.length > inpMax ? inp.slice(0, inpMax - 1) + '…' : inp;
      ctx.fillText(inpShown, x + padX, y + titleH + padY);

      const method = h.method || '';
      if (method) {
        const mFont = Math.max(9, Math.min(12, 10 / this.scale));
        ctx.font = `600 ${mFont}px var(--font-mono)`;
        const mw = ctx.measureText(method).width;
        const pillW = mw + padX * 1.4;
        const pillH = mFont + padY * 1.4;
        const pillX = x + w / 2 - pillW / 2 - 8 / this.scale;
        const pillY = midY + (rowH - pillH) / 2;
        ctx.fillStyle = rgba(c.stroke, 0.18);
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(pillX, pillY, pillW, pillH, 3 / this.scale);
          ctx.fill();
        } else {
          ctx.fillRect(pillX, pillY, pillW, pillH);
        }
        ctx.fillStyle = c.stroke;
        ctx.fillText(method, pillX + padX * 0.7, pillY + padY * 0.6);
        ctx.fillStyle = c.stroke;
        const arrowX = pillX + pillW + 4 / this.scale;
        const arrowY = pillY + pillH / 2;
        ctx.beginPath();
        ctx.moveTo(arrowX, arrowY);
        ctx.lineTo(arrowX + 10 / this.scale, arrowY);
        ctx.lineTo(arrowX + 10 / this.scale - 4 / this.scale, arrowY - 3 / this.scale);
        ctx.moveTo(arrowX + 10 / this.scale, arrowY);
        ctx.lineTo(arrowX + 10 / this.scale - 4 / this.scale, arrowY + 3 / this.scale);
        ctx.strokeStyle = c.stroke;
        ctx.lineWidth = 1.4 / this.scale;
        ctx.stroke();
      } else {
        const mFont = Math.max(9, Math.min(12, 10 / this.scale));
        ctx.font = `400 ${mFont}px var(--font-mono)`;
        ctx.fillStyle = rgba(c.stroke, 0.7);
        ctx.fillText('→', x + w / 2 - 4 / this.scale, midY + (rowH - mFont) / 2);
      }

      ctx.font = `400 ${fontPx}px var(--font-mono)`;
      ctx.fillStyle = pickTextColor(this.transformBg, { dark: '#1a1a22', light: this.cardText });
      const outp = h.output || '';
      const outpMax = Math.max(8, Math.floor((w - padX * 2) / (fontPx * 0.6)));
      const outpShown = outp.length > outpMax ? outp.slice(0, outpMax - 1) + '…' : outp;
      ctx.fillText(outpShown, x + padX, botY + padY);
    }

    if (h.bookmarked && this.scale > 0.2) {
      this._drawBookmarkStar(ctx, x + w, y, alpha);
    }

    if (isOutlineHL || isSelected) {
      const pad = 3 / this.scale;
      ctx.lineWidth = 5 / this.scale;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.strokeRect(x - pad, y - pad, w + pad * 2, hh + pad * 2);
      ctx.lineWidth = 3 / this.scale;
      ctx.strokeStyle = pickSelectionStroke(c.stroke, this.accentColour);
      ctx.strokeRect(x - pad, y - pad, w + pad * 2, hh + pad * 2);
    }

    if (this.mode === 'editor' && lod && lod.handlesVisible && (isHover || this.activeId === h.id || isSelected) && !h.locked) {
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

    if (h.locked && this.scale > 0.2) {
      this._drawLockBadge(ctx, x + w, y);
    }
    ctx.restore();
  }

  _drawLockBadge(ctx, cx, cy) {
    ctx.save();
    const s = 1 / this.scale;
    const size = 14 * s;
    const padX = 4 * s;
    const x = cx - size - padX;
    const y = cy + padX;
    ctx.fillStyle = 'rgba(20,20,28,0.85)';
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, size, size, 3 * s);
    } else {
      ctx.rect(x, y, size, size);
    }
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.3 * s;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const bodyW = 7 * s;
    const bodyH = 6 * s;
    const bx = x + (size - bodyW) / 2;
    const by = y + size - bodyH - 2 * s;
    ctx.strokeRect(bx, by, bodyW, bodyH);
    ctx.beginPath();
    const arcR = 2.2 * s;
    const arcCx = bx + bodyW / 2;
    const arcCy = by;
    ctx.arc(arcCx, arcCy, arcR, Math.PI, 0, false);
    ctx.stroke();
    ctx.restore();
  }

  _drawBookmarkStar(ctx, cx, cy, alpha) {
    ctx.save();
    const s = 1 / this.scale;
    const size = 12 * s;
    const padX = 4 * s;
    const offY = 4 * s;
    const ax = cx - size - padX;
    const ay = cy + offY;
    const half = size / 2;
    const inner = half * 0.42;
    const outer = half * 0.95;
    const px = ax + half;
    const py = ay + half;
    ctx.globalAlpha = typeof alpha === 'number' ? alpha : 1;
    ctx.fillStyle = '#e8c83d';
    ctx.strokeStyle = 'rgba(20,20,28,0.85)';
    ctx.lineWidth = 1 * s;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const xx = px + Math.cos(ang) * r;
      const yy = py + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
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
    const viewport = c.parentElement;
    if (viewport) {
      viewport.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
      viewport.addEventListener('contextmenu', this._onContextMenu.bind(this));
      viewport.addEventListener('mousedown', this._onViewportMouseDown.bind(this));
    } else {
      c.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
      c.addEventListener('contextmenu', this._onContextMenu.bind(this));
    }
    c.addEventListener('mousedown', this._onMouseDown.bind(this));
    window.addEventListener('mousemove', this._onMouseMove.bind(this));
    window.addEventListener('mouseup', this._onMouseUp.bind(this));
    c.addEventListener('mouseleave', () => {
      this.hoverId = null;
      this.cursorPos = null;
      this._updateTooltip();
      this.requestDraw();
      if (this._lastStrokeHoverId && typeof this.onStrokeHover === 'function') {
        this.onStrokeHover(null);
        this._lastStrokeHoverId = null;
      }
    });
    c.addEventListener('dblclick', this._onDoubleClick.bind(this));
    this._suppressNextContextMenu = false;
  }

  _onViewportMouseDown(ev) {
    if (this.dragState) return;
    if (ev.target === this.canvas) return;
    if (ev.button === 1 || ev.button === 2) {
      this._onMouseDown(ev);
    }
  }

  _onDoubleClick(ev) {
    if (this.croppingActive) return;
    const img = this.imagePointFromClient(ev.clientX, ev.clientY);
    const target = this.selectableAtImagePoint(img) || this.blockAtImagePoint(img);
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
    if (this.croppingActive) return;
    const screen = { x: ev.clientX, y: ev.clientY };
    const img = this.imagePointFromClient(ev.clientX, ev.clientY);

    if (ev.button === 1) {
      ev.preventDefault();
      this.dragState = {
        kind: 'pan',
        startScreen: screen,
        startPan: { x: this.panX, y: this.panY },
        candidateHotspot: null,
        moved: false,
      };
      this.canvas.parentElement.classList.add('grabbing');
      return;
    }

    if (ev.button === 2) {
      ev.preventDefault();
      this.dragState = {
        kind: 'pan',
        startScreen: screen,
        startPan: { x: this.panX, y: this.panY },
        candidateHotspot: null,
        rightButton: true,
        moved: false,
      };
      this.canvas.parentElement.classList.add('grabbing');
      return;
    }

    if (ev.button !== 0) return;

    if (this.mode === 'editor') {
      const tool = getActiveTool();

      if (isSpaceHeld() || tool === 'pan') {
        this.dragState = {
          kind: 'pan',
          startScreen: screen,
          startPan: { x: this.panX, y: this.panY },
          candidateHotspot: null,
          moved: false,
        };
        this.canvas.parentElement.classList.add('grabbing');
        return;
      }

      const hover = this.hotspotAtImagePoint(img);
      const grp = hover ? null : this.groupAtImagePoint(img);

      if (tool === 'select') {
        if (hover) {
          const locked = this._isLocked(hover.id);
          const handle = !locked ? this.handleAtImagePoint(hover, img) : null;
          const hoverIsImage = this._isImageHotspot(hover);
          const startResize = handle && (hoverIsImage || !ev.shiftKey);
          if (startResize) {
            this.dragState = {
              kind: 'resize',
              handle,
              id: hover.id,
              origRect: { ...hover.rect },
              startImg: img,
              startScreen: screen,
              shiftKey: !!ev.shiftKey,
              moved: false,
              target: hoverIsImage ? 'image-hotspot' : 'hotspot',
            };
            return;
          }
          let anchorSide = null;
          if (!locked) {
            const sc = (this.getTransform && this.getTransform().scale) || 1;
            const ar = 12 / sc;
            const rr = hover.rect;
            const pts = [
              { side: 'left',   x: rr.x,                y: rr.y + rr.h / 2 },
              { side: 'right',  x: rr.x + rr.w,         y: rr.y + rr.h / 2 },
              { side: 'top',    x: rr.x + rr.w / 2,     y: rr.y            },
              { side: 'bottom', x: rr.x + rr.w / 2,     y: rr.y + rr.h     },
            ];
            for (const pt of pts) {
              const dx = img.x - pt.x, dy = img.y - pt.y;
              if (dx*dx + dy*dy <= ar * ar) { anchorSide = pt.side; break; }
            }
          }
          this.dragState = {
            kind: 'edit-click',
            id: hover.id,
            kindOfTarget: 'hotspot',
            locked,
            shiftKey: !!ev.shiftKey,
            startScreen: screen,
            startImg: img,
            moved: false,
            anchorSide,
          };
          return;
        }
        if (grp) {
          const locked = this._isLocked(grp.id);
          this.dragState = {
            kind: 'edit-click',
            id: grp.id,
            kindOfTarget: 'group',
            locked,
            shiftKey: !!ev.shiftKey,
            startScreen: screen,
            startImg: img,
            moved: false,
          };
          return;
        }
        const blk = this.blockAtImagePoint(img);
        if (blk) {
          const locked = this._isLocked(blk.id);
          const isSelectedBlk = this.selection.has(blk.id) || this.activeId === blk.id;
          if (!locked && isSelectedBlk) {
            const handle = this.handleAtImagePoint(blk, img);
            if (handle) {
              this.dragState = {
                kind: 'resize',
                handle,
                id: blk.id,
                origRect: { ...blk.rect },
                startImg: img,
                startScreen: screen,
                shiftKey: !!ev.shiftKey,
                moved: false,
                target: 'block',
              };
              return;
            }
          }
          let anchorSide = null;
          if (!locked) {
            const sc = (this.getTransform && this.getTransform().scale) || 1;
            const ar = 12 / sc;
            const rr = blk.rect;
            const pts = [
              { side: 'left',   x: rr.x,                y: rr.y + rr.h / 2 },
              { side: 'right',  x: rr.x + rr.w,         y: rr.y + rr.h / 2 },
              { side: 'top',    x: rr.x + rr.w / 2,     y: rr.y            },
              { side: 'bottom', x: rr.x + rr.w / 2,     y: rr.y + rr.h     },
            ];
            for (const pt of pts) {
              const dx = img.x - pt.x, dy = img.y - pt.y;
              if (dx*dx + dy*dy <= ar * ar) { anchorSide = pt.side; break; }
            }
          }
          this.dragState = {
            kind: 'edit-click',
            id: blk.id,
            kindOfTarget: 'block',
            locked,
            shiftKey: !!ev.shiftKey,
            startScreen: screen,
            startImg: img,
            moved: false,
            anchorSide,
          };
          return;
        }
        if (typeof this.onSelectStrokeAtPoint === 'function') {
          const strokeId = this.onSelectStrokeAtPoint(img, !!ev.shiftKey);
          if (strokeId) {
            if (!ev.shiftKey) {
              this.setSelection(new Set());
              this.onSelectionChange({ ids: [] });
            }
            this.dragState = { kind: 'stroke-click', strokeId, startScreen: screen, moved: false };
            return;
          }
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
        if (typeof this.onClearStrokeSelection === 'function') {
          this.onClearStrokeSelection();
        }
        this.dragState = {
          kind: 'pan',
          startScreen: screen,
          startPan: { x: this.panX, y: this.panY },
          candidateHotspot: null,
          moved: false,
        };
        this.canvas.parentElement.classList.add('grabbing');
        return;
      }

      if (tool === 'block' || tool === 'sticky' || tool === 'text' || tool === 'transform') {
        this.dragState = {
          kind: 'tool-click',
          tool,
          start: img,
          current: img,
          startScreen: screen,
          moved: false,
        };
        return;
      }

      if (tool === 'group') {
        this.dragState = {
          kind: 'draw',
          createMode: 'group',
          start: img,
          current: img,
          startScreen: screen,
          moved: false,
        };
        return;
      }

      if (tool === 'arrow') {
        this.dragState = {
          kind: 'arrow-draw',
          start: img,
          current: img,
          startScreen: screen,
          fromHover: hover ? hover.id : (grp ? grp.id : null),
          moved: false,
        };
        if (this.editorOptions.onArrowDrawBegin) {
          this.editorOptions.onArrowDrawBegin(img, hover || grp || null);
        }
        return;
      }

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

  _isLocked(id) {
    if (typeof this.editorOptions.isNodeLocked === 'function') {
      try { return !!this.editorOptions.isNodeLocked(id); } catch (e) { void e; }
    }
    return false;
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
        this._updateCursor();
        this.requestDraw();
      } else {
        this._updateTooltip();
      }
      if (this.mode === 'editor') {
        const tHandle = this._handleAtPoint(img);
        if (tHandle) {
          this.canvas.style.cursor = HANDLE_CURSORS[tHandle.key] || 'move';
          this._cursorOnHandle = true;
          const hint = tHandle.isImage ? this._handleHintImage : this._handleHintLocked;
          if (hint && this.canvas.title !== hint) this.canvas.title = hint;
        } else {
          if (this._cursorOnHandle) {
            this._cursorOnHandle = false;
            this._updateCursor();
          }
          if (this.canvas.title) this.canvas.title = '';
        }
      } else if (this._cursorOnHandle) {
        this._cursorOnHandle = false;
        this._updateCursor();
      }
      const tool = getActiveTool();
      if (!newHover && this.mode === 'editor' && tool === 'select'
          && typeof this.onStrokeHover === 'function') {
        const sid = this.onStrokeHover(img);
        this._lastStrokeHoverId = sid || null;
        if (sid) {
          this.canvas.style.cursor = 'pointer';
        }
      } else if (this._lastStrokeHoverId && typeof this.onStrokeHover === 'function') {
        this.onStrokeHover(null);
        this._lastStrokeHoverId = null;
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
    if (d.kind === 'draw' || d.kind === 'marquee' || d.kind === 'tool-click' || d.kind === 'arrow-draw') {
      d.current = this.imagePointFromClient(ev.clientX, ev.clientY);
      if (d.kind === 'arrow-draw' && this.editorOptions.onArrowDrawMove) {
        const targetHover = this.hotspotAtImagePoint(d.current);
        const targetGroup = targetHover ? null : this.groupAtImagePoint(d.current);
        this.editorOptions.onArrowDrawMove({ fromPt: d.start, toPt: d.current, target: targetHover || targetGroup });
      }
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
      const MIN_SIDE = 40;
      if (rect.w < MIN_SIDE) {
        if (d.handle.includes('w')) rect.x = d.origRect.x + d.origRect.w - MIN_SIDE;
        rect.w = MIN_SIDE;
      }
      if (rect.h < MIN_SIDE) {
        if (d.handle.includes('n')) rect.y = d.origRect.y + d.origRect.h - MIN_SIDE;
        rect.h = MIN_SIDE;
      }
      const isImageTarget = d.target === 'block' || d.target === 'image-hotspot';
      const lockAspect = isImageTarget ? !ev.shiftKey : !!ev.shiftKey;
      if (lockAspect && d.origRect.w > 0 && d.origRect.h > 0) {
        const aspect = d.origRect.w / d.origRect.h;
        const horizHandle = d.handle === 'e' || d.handle === 'w';
        const vertHandle = d.handle === 'n' || d.handle === 's';
        if (horizHandle) {
          const newH = rect.w / aspect;
          if (d.handle === 'w') rect.y = d.origRect.y + (d.origRect.h - newH) / 2;
          rect.h = newH;
        } else if (vertHandle) {
          const newW = rect.h * aspect;
          if (d.handle === 'n') rect.x = d.origRect.x + (d.origRect.w - newW) / 2;
          rect.w = newW;
        } else {
          const adjustH = rect.w / aspect;
          if (d.handle.includes('n')) rect.y = d.origRect.y + d.origRect.h - adjustH;
          rect.h = adjustH;
        }
      }
      if (d.target === 'block') {
        const bidx = this.blocks.findIndex((b) => b.id === d.id);
        if (bidx >= 0) {
          this.blocks[bidx] = { ...this.blocks[bidx], rect };
          this.requestDraw();
          if (this.editorOptions.onHotspotResize) {
            this.editorOptions.onHotspotResize(d.id, rect);
          }
        }
      } else {
        const idx = this.hotspots.findIndex((h) => h.id === d.id);
        if (idx >= 0) {
          this.hotspots[idx] = { ...this.hotspots[idx], rect };
          this.requestDraw();
          if (this.editorOptions.onHotspotResize) {
            this.editorOptions.onHotspotResize(d.id, rect);
          }
        }
      }
      return;
    }
    if (d.kind === 'edit-click') {
      if (d.locked) return;
      if (d.moved && d.anchorSide && typeof this.onAnchorMouseDown === 'function') {
        const startEv = { button: 0, clientX: d.startScreen.x, clientY: d.startScreen.y, preventDefault: () => {}, stopPropagation: () => {} };
        this.dragState = null;
        this.onAnchorMouseDown(startEv, d.id, d.anchorSide);
        return;
      }
      if (d.moved && !d.shiftKey) {
        const ids = this.selection.has(d.id)
          ? Array.from(this.selection)
          : [d.id];
        if (!this.selection.has(d.id)) {
          this.setSelection(new Set([d.id]));
          this.onSelectionChange({ ids });
        }
        const filtered = ids.filter((id) => !this._isLocked(id));
        if (!filtered.length) return;
        d.kind = 'drag-selection';
        d.ids = filtered;
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
      if (d.rightButton) {
        this._suppressNextContextMenu = !!d.moved;
        if (d.moved) {
          try { document.body.dataset.suppressContextMenu = '1'; } catch (e) { void e; }
          setTimeout(() => { try { delete document.body.dataset.suppressContextMenu; } catch (e) { void e; } }, 100);
        }
        return;
      }
      if (!d.moved && d.candidateHotspot) {
        this.onHotspotClick(d.candidateHotspot, ev);
      } else if (!d.moved && this.mode === 'editor') {
        const mouseupOnCanvas = ev.target === this.canvas;
        if (mouseupOnCanvas) {
          if (this.selection && this.selection.size > 0) {
            this.setSelection(new Set());
          }
          this.onSelectionChange({ ids: [] });
        }
      }
      return;
    }
    if (d.kind === 'tool-click') {
      const tool = d.tool;
      const pt = d.current || this.imagePointFromClient(ev.clientX, ev.clientY);
      this.onCanvasDrawRect({
        x: pt.x, y: pt.y, w: 0, h: 0,
        mode: tool,
        clickOnly: true,
      });
      setActiveTool('select');
      this.requestDraw();
      return;
    }
    if (d.kind === 'arrow-draw') {
      const cur = d.current || this.imagePointFromClient(ev.clientX, ev.clientY);
      const targetHover = this.hotspotAtImagePoint(cur);
      const targetGroup = targetHover ? null : this.groupAtImagePoint(cur);
      const targetBlock = (targetHover || targetGroup) ? null : this.blockAtImagePoint(cur);
      const target = targetHover || targetGroup || targetBlock;
      if (this.editorOptions.onArrowDrawEnd) {
        this.editorOptions.onArrowDrawEnd({
          fromId: d.fromHover,
          fromPt: d.start,
          toId: target ? target.id : null,
          toPt: cur,
          moved: d.moved,
        });
      }
      setActiveTool('select');
      this.requestDraw();
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
      this.onCanvasDrawRect({ x, y, w, h, mode: d.createMode || this.createMode });
      if (d.createMode === 'group') setActiveTool('select');
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
      if (typeof this.editorOptions.onMarqueeStrokes === 'function') {
        try { this.editorOptions.onMarqueeStrokes(rect, !!d.shiftKey); } catch (e) { void e; }
      }
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
        if (typeof this.onClearStrokeSelection === 'function') {
          this.onClearStrokeSelection();
        }
        this.setSelection(new Set([d.id]));
        this.onSelectionChange({ ids: [d.id] });
        if (d.kindOfTarget !== 'group') {
          this.onHotspotClick(d.id, ev);
        }
      }
      return;
    }
    if (d.kind === 'stroke-click') {
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
    if (this.mode !== 'editor') return;
    ev.preventDefault();
    if (this._suppressNextContextMenu) {
      this._suppressNextContextMenu = false;
      return;
    }
    if (this.dragState && this.dragState.kind === 'pan' && this.dragState.rightButton && this.dragState.moved) {
      return;
    }
    this._fireContextMenuAt(ev);
  }

  _fireContextMenuAt(ev) {
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
    const blk = this.blockAtImagePoint(img);
    if (blk) {
      this.onHotspotRightClick(blk.id, ev);
      return;
    }
    if (typeof this.onStrokeRightClick === 'function') {
      const sid = this.onStrokeRightClick(img, ev);
      if (sid) return;
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
