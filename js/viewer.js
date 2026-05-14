/* Canvas-based viewer that composites the world from per-block WebPs.
   Pan/zoom + hotspot rendering. Hotspot click only fires when pointer travel
   < 5 px between mousedown and mouseup. */

const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const CLICK_SLOP = 5;
const STATUS_COLOR = {
  solved:   { stroke: '#3de88a', fill: 'rgba(61,232,138,0.18)', fillHover: 'rgba(61,232,138,0.32)' },
  partial:  { stroke: '#e8c83d', fill: 'rgba(232,200,61,0.18)', fillHover: 'rgba(232,200,61,0.34)' },
  unsolved: { stroke: '#e83d3d', fill: 'rgba(232,61,61,0.18)',  fillHover: 'rgba(232,61,61,0.34)' },
  nodata:   { stroke: '#8888aa', fill: 'rgba(136,136,170,0.14)', fillHover: 'rgba(136,136,170,0.28)' },
};

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
    this.bgColour = '#0a0a0c';

    this.scale = 1;
    this.panX = 0;
    this.panY = 0;

    this.hotspots = [];
    this.statusFilter = new Set(['solved', 'partial', 'unsolved', 'nodata']);
    this.searchTerm = '';
    this.searchMatches = null;
    this.hoverId = null;
    this.activeId = null;
    this.tooltip = null;

    this.mode = 'viewer';
    this.editorOptions = options || {};
    this.onHotspotClick = options.onHotspotClick || (() => {});
    this.onHotspotRightClick = options.onHotspotRightClick || (() => {});
    this.onCanvasDrawRect = options.onCanvasDrawRect || (() => {});
    this.onTransformChange = options.onTransformChange || (() => {});

    this.dragState = null;
    this.drawPreviewEl = options.drawPreviewEl || null;
    this.cursorPos = null;

    this._raf = null;

    this._installEvents();
    this._installResize();
  }

  async setBlocks(blocks) {
    this.blocks = blocks.map((b) => ({ id: b.id, rect: { ...b.rect }, file: b.file }));
    this._computeBounds();
    await Promise.all(this.blocks.map((b) => this._loadBlockImage(b)));
    this.imageReady = true;
    this._refreshBg();
    this.fitToScreen();
    this.requestDraw();
    return { w: this.imageW, h: this.imageH };
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

  setHotspots(hotspots) {
    this.hotspots = hotspots;
    this.requestDraw();
  }

  setStatusFilter(filterSet) {
    this.statusFilter = filterSet instanceof Set ? filterSet : new Set(filterSet);
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
    if (!this.statusFilter.has(h.status)) return false;
    return true;
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

    for (const b of this.blocks) {
      const img = this.blockImages.get(b.id);
      if (!img) continue;
      ctx.drawImage(img, b.rect.x, b.rect.y, b.rect.w, b.rect.h);
    }

    for (const h of this.hotspots) {
      if (!this._isVisible(h)) continue;
      this._drawHotspot(ctx, h);
    }

    if (this.dragState && this.dragState.kind === 'draw' && this.dragState.current) {
      const s = this.dragState.start;
      const cur = this.dragState.current;
      const x = Math.min(s.x, cur.x);
      const y = Math.min(s.y, cur.y);
      const w = Math.abs(cur.x - s.x);
      const h = Math.abs(cur.y - s.y);
      ctx.lineWidth = 2 / this.scale;
      ctx.strokeStyle = '#e86b2e';
      ctx.fillStyle = 'rgba(232,107,46,0.12)';
      ctx.setLineDash([8 / this.scale, 6 / this.scale]);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }

    ctx.restore();

    this._updateTooltip();
  }

  _drawHotspot(ctx, h) {
    const c = STATUS_COLOR[h.status] || STATUS_COLOR.unsolved;
    const dim = this.searchTerm && !this._matchesSearch(h);
    const isHover = this.hoverId === h.id || this.activeId === h.id;
    const { x, y, w, h: hh } = h.rect;

    ctx.lineWidth = (isHover ? 2.5 : 1.6) / this.scale;
    ctx.globalAlpha = dim ? 0.3 : 1;
    ctx.strokeStyle = c.stroke;
    ctx.fillStyle = isHover ? c.fillHover : c.fill;
    ctx.fillRect(x, y, w, hh);
    ctx.strokeRect(x, y, w, hh);

    if (this.mode === 'editor' && (isHover || this.activeId === h.id)) {
      ctx.fillStyle = '#e86b2e';
      ctx.strokeStyle = '#0a0a0c';
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
        if (handle) {
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
          startScreen: screen,
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
    if (d.kind === 'draw') {
      d.current = this.imagePointFromClient(ev.clientX, ev.clientY);
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
      this.onCanvasDrawRect({ x, y, w, h });
      this.requestDraw();
      return;
    }
    if (d.kind === 'edit-click') {
      if (!d.moved) {
        this.onHotspotClick(d.id, ev);
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
    if (this.mode !== 'editor') return;
    const img = this.imagePointFromClient(ev.clientX, ev.clientY);
    const hover = this.hotspotAtImagePoint(img);
    if (hover) {
      ev.preventDefault();
      this.onHotspotRightClick(hover.id, ev);
    }
  }

  getScale() { return this.scale; }
  getImageSize() { return { w: this.imageW, h: this.imageH }; }
  getTransform() { return { scale: this.scale, panX: this.panX, panY: this.panY }; }
  getBlocks() { return this.blocks; }
}
