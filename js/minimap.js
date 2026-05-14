/* Floating minimap. Renders a scaled-down view of the world (all nodes as
   filled rects coloured by status) plus a viewport rectangle showing the
   visible region in the main canvas. Click to centre, drag the viewport rect
   to pan, mouse-wheel to zoom the main canvas. Re-renders only when something
   the user can perceive changes: transform, nodes, or filter. */

import { tr } from './i18n.js';

const W = 220;
const H = 160;
const STORAGE_KEY = 'arg_map_minimap_open';

const STATUS_FILL = {
  'solved':   '#3de88a',
  'partial':  '#e8c83d',
  'unsolved': '#e83d3d',
  'no-data':  '#8888aa',
  'dead-end': '#5a5a72',
};

export class Minimap {
  constructor(opts) {
    this.viewer = opts.viewer;
    this.container = opts.container || document.body;

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

    this._build();
    this._wireViewer();
    this._wireEvents();

    if (this._loadOpenState()) {
      this.open();
    }
    this._recomputeBounds();
    this.requestDraw();
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
      </div>
    `;
    this.container.appendChild(root);
    this.rootEl = root;
    this.canvas = root.querySelector('.minimap-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.closeBtn = root.querySelector('.minimap-close');
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
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._draw();
    });
  }

  _draw() {
    if (!this.ctx) return;
    this._recomputeBounds();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, W, H);

    if (this.imageW <= 0 || this.imageH <= 0) return;

    ctx.fillStyle = 'rgba(40, 40, 52, 0.55)';
    const blocks = this.viewer.getBlocks();
    for (const b of blocks) {
      const x = this.offsetX + b.rect.x * this.scale;
      const y = this.offsetY + b.rect.y * this.scale;
      const w = Math.max(1, b.rect.w * this.scale);
      const h = Math.max(1, b.rect.h * this.scale);
      ctx.fillRect(x, y, w, h);
    }

    const hotspots = this.viewer.getHotspots();
    for (const h of hotspots) {
      const fill = STATUS_FILL[h.status] || STATUS_FILL.unsolved;
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

    const rect = this._viewportRectWorld();
    const vx = this.offsetX + rect.x * this.scale;
    const vy = this.offsetY + rect.y * this.scale;
    const vw = rect.w * this.scale;
    const vh = rect.h * this.scale;
    ctx.strokeStyle = '#e86b2e';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(vx, vy, vw, vh);
    ctx.fillStyle = 'rgba(232, 107, 46, 0.08)';
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
