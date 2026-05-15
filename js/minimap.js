/* Floating minimap. Renders a scaled-down view of the world (all nodes as
   filled rects coloured by status) plus a viewport rectangle showing the
   visible region in the main canvas. Click to centre, drag the viewport rect
   to pan, mouse-wheel to zoom the main canvas. Re-renders only when something
   the user can perceive changes: transform, nodes, or filter. */

import { tr } from './i18n.js';

const W = 220;
const H = 160;
const STORAGE_KEY = 'arg_map_minimap_open';

const STATUS_TOKEN = {
  'solved':   '--status-solved',
  'partial':  '--status-partial',
  'unsolved': '--status-unsolved',
  'no-data':  '--status-nodata',
  'dead-end': '--status-deadend',
};

const BRANCH_COLOR_PRESET = {
  '1': '#e83d3d',
  '2': '#e88a3d',
  '3': '#e8c83d',
  '4': '#3de88a',
  '5': '#3dc8e8',
  '6': '#9a6ce8',
};

function branchColor(branch) {
  if (!branch) return null;
  const raw = typeof branch.color === 'string' ? branch.color : '';
  if (!raw) return null;
  if (raw.startsWith('#')) return raw;
  return BRANCH_COLOR_PRESET[raw] || null;
}

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

export class Minimap {
  constructor(opts) {
    this.viewer = opts.viewer;
    this.container = opts.container || document.body;
    this.getBranches = opts.getBranches || (() => []);

    this.imageW = 0;
    this.imageH = 0;
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    this.statusFilter = null;
    this.fadeNonMatching = true;
    this._dragState = null;
    this._dirty = false;
    this._raf = null;
    this.statusFill = {};
    this.bgColour = '#f6f6f8';
    this.borderColour = '#d8d8e0';
    this.accentColour = '#2e6fe8';
    this._refreshPalette();

    this._build();
    this._wireViewer();
    this._wireEvents();

    if (this._loadOpenState()) {
      this.open();
    }
    this._recomputeBounds();
    this.requestDraw();
  }

  refreshPalette() {
    this._refreshPalette();
    this.requestDraw();
  }

  _refreshPalette() {
    this.bgColour = readCssVar('--canvas-bg', readCssVar('--bg', this.bgColour));
    this.borderColour = readCssVar('--panel-border', this.borderColour);
    this.accentColour = readCssVar('--accent', this.accentColour);
    const next = {};
    for (const [status, token] of Object.entries(STATUS_TOKEN)) {
      next[status] = readCssVar(token, '#888888');
    }
    this.statusFill = next;
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'minimap';
    root.className = 'minimap closed';
    root.setAttribute('aria-label', tr('minimap_toggle'));
    root.innerHTML = `
      <div class="minimap-header">
        <span class="minimap-title">${tr('minimap_toggle')}</span>
        <button class="minimap-close" type="button" aria-label="${tr('shortcut_close')}">&times;</button>
      </div>
      <div class="minimap-body">
        <canvas class="minimap-canvas" width="${W}" height="${H}"></canvas>
        <div class="minimap-legend"></div>
      </div>
    `;
    this.container.appendChild(root);
    this.rootEl = root;
    this.canvas = root.querySelector('.minimap-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.closeBtn = root.querySelector('.minimap-close');
    this.legendEl = root.querySelector('.minimap-legend');
  }

  _renderLegend() {
    if (!this.legendEl) return;
    const branches = (typeof this.getBranches === 'function') ? this.getBranches() : [];
    if (!Array.isArray(branches) || !branches.length) {
      this.legendEl.style.display = 'none';
      this.legendEl.innerHTML = '';
      return;
    }
    const shown = branches.slice(0, 5);
    const truncated = branches.length > 5;
    this.legendEl.style.display = '';
    const items = shown.map((b) => {
      const color = branchColor(b) || '#888';
      const label = (b.label || b.id || '').replace(/[<>"&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', '&': '&amp;' })[c]);
      return `<span class="minimap-legend-item" title="${label}"><span class="minimap-legend-dot" style="background:${color}"></span><span class="minimap-legend-label">${label}</span></span>`;
    }).join('');
    const more = truncated ? `<span class="minimap-legend-more">+${branches.length - 5}</span>` : '';
    this.legendEl.innerHTML = items + more;
  }

  _wireViewer() {
    if (!this.viewer || typeof this.viewer.subscribe !== 'function') return;
    this._unsub = this.viewer.subscribe((kind) => {
      if (kind === 'transform' || kind === 'nodes' || kind === 'filter') {
        this.requestDraw();
      }
    });
  }

  _wireEvents() {
    this.closeBtn.addEventListener('click', () => this.close());

    this.canvas.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      const pt = this._evtToWorld(ev);
      const rect = this._viewportRectWorld();
      const inside = pt.x >= rect.x && pt.x <= rect.x + rect.w
                   && pt.y >= rect.y && pt.y <= rect.y + rect.h;
      if (inside) {
        this._dragState = {
          start: { x: ev.clientX, y: ev.clientY },
          startRect: { ...rect },
        };
      } else {
        this.viewer.centerOnPoint(pt.x, pt.y);
      }
    });
    window.addEventListener('mousemove', (ev) => {
      if (!this._dragState) return;
      const r = this.canvas.getBoundingClientRect();
      const dxScreen = ev.clientX - this._dragState.start.x;
      const dyScreen = ev.clientY - this._dragState.start.y;
      const dxWorld = dxScreen / this.scale;
      const dyWorld = dyScreen / this.scale;
      const cx = this._dragState.startRect.x + this._dragState.startRect.w / 2 + dxWorld;
      const cy = this._dragState.startRect.y + this._dragState.startRect.h / 2 + dyWorld;
      this.viewer.centerOnPoint(cx, cy);
      void r;
    });
    window.addEventListener('mouseup', () => {
      this._dragState = null;
    });
    this.canvas.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? 1.18 : 1 / 1.18;
      const r = this.viewer.getCanvas().getBoundingClientRect();
      this.viewer.zoomAt(r.width / 2, r.height / 2, factor);
    }, { passive: false });
  }

  setStatusFilter(set, opts) {
    this.statusFilter = set instanceof Set ? set : null;
    const o = opts || {};
    this.fadeNonMatching = o.fade !== false;
    this.requestDraw();
  }

  _recomputeBounds() {
    const sz = this.viewer.getImageSize();
    this.imageW = sz.w || 0;
    this.imageH = sz.h || 0;
    if (this.imageW <= 0 || this.imageH <= 0) {
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }
    const sx = (W - 8) / this.imageW;
    const sy = (H - 8) / this.imageH;
    this.scale = Math.min(sx, sy);
    this.offsetX = (W - this.imageW * this.scale) / 2;
    this.offsetY = (H - this.imageH * this.scale) / 2;
  }

  requestDraw() {
    if (!this.isOpen()) return;
    if (this._raf) return;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (this._lastDraw && (now - this._lastDraw) < 32) {
      if (this._throttleTimer) return;
      this._throttleTimer = setTimeout(() => {
        this._throttleTimer = null;
        this._lastDraw = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        this._draw();
      }, 32 - (now - this._lastDraw));
      return;
    }
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._lastDraw = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      this._draw();
    });
  }

  _draw() {
    if (!this.ctx) return;
    this._recomputeBounds();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = this.bgColour;
    ctx.fillRect(0, 0, W, H);

    if (this.imageW <= 0 || this.imageH <= 0) return;

    ctx.fillStyle = rgba(this.borderColour, 0.55);
    const blocks = this.viewer.getBlocks();
    for (const b of blocks) {
      const x = this.offsetX + b.rect.x * this.scale;
      const y = this.offsetY + b.rect.y * this.scale;
      const w = Math.max(1, b.rect.w * this.scale);
      const h = Math.max(1, b.rect.h * this.scale);
      ctx.fillRect(x, y, w, h);
    }

    const hotspots = this.viewer.getHotspots();
    const branches = (typeof this.getBranches === 'function') ? this.getBranches() : [];
    const branchById = new Map();
    if (Array.isArray(branches)) for (const b of branches) if (b && b.id) branchById.set(b.id, b);
    for (const h of hotspots) {
      let fill = null;
      if (Array.isArray(h.branches) && h.branches.length) {
        const first = branchById.get(h.branches[0]);
        if (first) fill = branchColor(first);
      }
      if (!fill) fill = this.statusFill[h.status] || this.statusFill.unsolved || this.borderColour;
      const matches = !this.fadeNonMatching || !this.statusFilter || this.statusFilter.has(h.status);
      ctx.globalAlpha = matches ? 0.95 : 0.3;
      ctx.fillStyle = fill;
      const x = this.offsetX + h.rect.x * this.scale;
      const y = this.offsetY + h.rect.y * this.scale;
      const w = Math.max(1.5, h.rect.w * this.scale);
      const hh = Math.max(1.5, h.rect.h * this.scale);
      ctx.fillRect(x, y, w, hh);
    }
    ctx.globalAlpha = 1;
    this._renderLegend();

    const rect = this._viewportRectWorld();
    const vx = this.offsetX + rect.x * this.scale;
    const vy = this.offsetY + rect.y * this.scale;
    const vw = rect.w * this.scale;
    const vh = rect.h * this.scale;
    ctx.strokeStyle = this.accentColour;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(vx, vy, vw, vh);
    ctx.fillStyle = rgba(this.accentColour, 0.10);
    ctx.fillRect(vx, vy, vw, vh);
  }

  _viewportRectWorld() {
    const t = this.viewer.getTransform();
    const r = this.viewer.getCanvas().getBoundingClientRect();
    const wx = -t.panX / t.scale;
    const wy = -t.panY / t.scale;
    const ww = r.width  / t.scale;
    const wh = r.height / t.scale;
    return { x: wx, y: wy, w: ww, h: wh };
  }

  _evtToWorld(ev) {
    const r = this.canvas.getBoundingClientRect();
    const mx = ev.clientX - r.left;
    const my = ev.clientY - r.top;
    return {
      x: (mx - this.offsetX) / this.scale,
      y: (my - this.offsetY) / this.scale,
    };
  }

  open() {
    this.rootEl.classList.remove('closed');
    this.rootEl.classList.add('open');
    this._saveOpenState(true);
    this.requestDraw();
  }

  close() {
    this.rootEl.classList.remove('open');
    this.rootEl.classList.add('closed');
    this._saveOpenState(false);
  }

  toggle() {
    if (this.isOpen()) this.close();
    else this.open();
  }

  isOpen() {
    return this.rootEl.classList.contains('open');
  }

  retranslate() {
    const title = this.rootEl.querySelector('.minimap-title');
    if (title) title.textContent = tr('minimap_toggle');
    const close = this.rootEl.querySelector('.minimap-close');
    if (close) close.setAttribute('aria-label', tr('shortcut_close'));
  }

  _loadOpenState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw === '1';
    } catch (e) {
      return false;
    }
  }

  _saveOpenState(open) {
    try {
      localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    } catch (e) {
      void e;
    }
  }
}
