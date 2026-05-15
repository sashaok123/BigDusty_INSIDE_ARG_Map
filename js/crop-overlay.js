/* Inline canvas crop overlay. Mounts a transparent layer over the viewport
   with a draggable / resizable crop rectangle positioned over a single image
   node. Source image is loaded for pixel-accurate slicing on apply; the
   overlay maps between image-intrinsic pixels and screen via the viewer's
   getTransform plus the node placement. */

import { tr } from './i18n.js';

const MIN_RECT_PX = 16;
const HANDLE_KEYS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const ASPECT_PRESETS = [
  { id: 'free', ratio: null },
  { id: '1:1', ratio: 1 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '16:9', ratio: 16 / 9 },
];

function el(tag, attrs, kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
  }
  if (kids) for (const k of kids) if (k) e.appendChild(k);
  return e;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e || new Error('image_load_failed'));
    img.src = url;
  });
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normaliseRect(r, w, h, minPx) {
  let x = r.x, y = r.y, rw = r.w, rh = r.h;
  if (rw < 0) { x += rw; rw = -rw; }
  if (rh < 0) { y += rh; rh = -rh; }
  x = clamp(x, 0, w);
  y = clamp(y, 0, h);
  if (x + rw > w) rw = w - x;
  if (y + rh > h) rh = h - y;
  const m = Math.max(1, Math.min(minPx, w, h));
  if (rw < m) rw = Math.min(m, w - x);
  if (rh < m) rh = Math.min(m, h - y);
  return { x, y, w: rw, h: rh };
}

export class CropOverlay {
  constructor(opts) {
    this.viewport = opts.viewport;
    this.viewer = opts.viewer;
    this.getTransform = opts.getTransform || (() => ({ scale: 1, panX: 0, panY: 0 }));
    this.onApply = opts.onApply || (() => {});
    this.onCancel = opts.onCancel || (() => {});
    this.active = false;
    this.aspectId = 'free';
    this._buildDom();
  }

  _buildDom() {
    const root = el('div', { class: 'crop-inline-root' });
    root.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1200;display:none;overflow:hidden;';
    const rect = el('div', { class: 'crop-inline-rect' });
    rect.style.cssText = 'position:absolute;box-sizing:border-box;border:1.5px solid var(--accent);background:transparent;cursor:move;box-shadow:0 0 0 9999px rgba(0,0,0,0.55);pointer-events:auto;';
    for (const k of HANDLE_KEYS) {
      const h = el('div', { class: `crop-inline-handle crop-inline-handle-${k}` });
      h.dataset.handle = k;
      const baseStyle = 'position:absolute;width:12px;height:12px;background:var(--panel-bg);border:1.5px solid var(--accent);border-radius:2px;';
      let pos = '';
      if (k === 'nw') pos = 'left:-7px;top:-7px;cursor:nwse-resize;';
      else if (k === 'n') pos = 'left:50%;top:-7px;transform:translateX(-50%);cursor:ns-resize;';
      else if (k === 'ne') pos = 'right:-7px;top:-7px;cursor:nesw-resize;';
      else if (k === 'e') pos = 'right:-7px;top:50%;transform:translateY(-50%);cursor:ew-resize;';
      else if (k === 'se') pos = 'right:-7px;bottom:-7px;cursor:nwse-resize;';
      else if (k === 's') pos = 'left:50%;bottom:-7px;transform:translateX(-50%);cursor:ns-resize;';
      else if (k === 'sw') pos = 'left:-7px;bottom:-7px;cursor:nesw-resize;';
      else if (k === 'w') pos = 'left:-7px;top:50%;transform:translateY(-50%);cursor:ew-resize;';
      h.style.cssText = baseStyle + pos;
      rect.appendChild(h);
    }
    const toolbar = el('div', { class: 'crop-inline-toolbar' });
    toolbar.style.cssText = 'position:absolute;display:flex;gap:8px;align-items:center;background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:var(--radius);padding:6px 10px;box-shadow:var(--shadow-soft);font-family:var(--font-mono);font-size:11px;letter-spacing:1px;text-transform:uppercase;pointer-events:auto;';
    const ratioLabel = el('span', { class: 'crop-inline-ratio-label', text: tr('crop_ratio_label') });
    ratioLabel.style.cssText = 'color:var(--text-dim);';
    const ratioSel = el('select', { class: 'crop-inline-ratio' });
    ratioSel.style.cssText = 'background:var(--field-bg);color:var(--text);border:1px solid var(--panel-border);border-radius:3px;padding:3px 6px;font-family:var(--font-mono);font-size:11px;';
    for (const a of ASPECT_PRESETS) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.id === 'free' ? tr('crop_ratio_free') : a.id;
      ratioSel.appendChild(opt);
    }
    ratioSel.addEventListener('change', () => {
      this.aspectId = ratioSel.value;
      this._applyAspectToRect();
      this._renderRect();
    });
    const cancelBtn = el('button', { type: 'button', class: 'modal-btn cancel', text: tr('crop_cancel') });
    const applyBtn = el('button', { type: 'button', class: 'modal-btn primary', text: tr('crop_apply') });
    cancelBtn.addEventListener('click', () => this._cancel());
    applyBtn.addEventListener('click', () => this._apply());
    toolbar.appendChild(ratioLabel);
    toolbar.appendChild(ratioSel);
    toolbar.appendChild(cancelBtn);
    toolbar.appendChild(applyBtn);

    root.appendChild(rect);
    root.appendChild(toolbar);

    this.viewport.appendChild(root);

    this.rootEl = root;
    this.rectEl = rect;
    this.toolbarEl = toolbar;
    this.ratioSelEl = ratioSel;
    this.applyBtnEl = applyBtn;
    this.cancelBtnEl = cancelBtn;
    this.ratioLabelEl = ratioLabel;

    this._onKey = (ev) => {
      if (!this.active) return;
      if (ev.key === 'Escape') { ev.preventDefault(); this._cancel(); }
      else if (ev.key === 'Enter') { ev.preventDefault(); this._apply(); }
    };
    this._onResize = () => { if (this.active) this._renderRect(); };
    this._onTransform = () => { if (this.active) this._renderRect(); };

    rect.addEventListener('mousedown', (ev) => this._onRectMouseDown(ev));
    window.addEventListener('mousemove', (ev) => this._onMouseMove(ev));
    window.addEventListener('mouseup', () => this._onMouseUp());
  }

  isActive() { return !!this.active; }

  retranslate() {
    if (this.ratioLabelEl) this.ratioLabelEl.textContent = tr('crop_ratio_label');
    if (this.applyBtnEl) this.applyBtnEl.textContent = tr('crop_apply');
    if (this.cancelBtnEl) this.cancelBtnEl.textContent = tr('crop_cancel');
    if (this.ratioSelEl) {
      const opts = Array.from(this.ratioSelEl.querySelectorAll('option'));
      for (const o of opts) {
        if (o.value === 'free') o.textContent = tr('crop_ratio_free');
      }
    }
  }

  async open(node, imageUrl) {
    if (this.active) return;
    if (!node || !imageUrl) return;
    let imageEl;
    try { imageEl = await loadImage(imageUrl); }
    catch (e) { console.warn('[crop-overlay] image load failed', e); this.onCancel(); return; }
    this.active = true;
    this.node = node;
    this.imageUrl = imageUrl;
    this.imageEl = imageEl;
    this.imgW = imageEl.naturalWidth || imageEl.width || 0;
    this.imgH = imageEl.naturalHeight || imageEl.height || 0;
    if (this.imgW <= 0 || this.imgH <= 0) { this._cancel(); return; }
    this.rect = { x: 0, y: 0, w: this.imgW, h: this.imgH };
    this.drag = null;
    this.aspectId = 'free';
    if (this.ratioSelEl) this.ratioSelEl.value = 'free';
    if (this.viewer) this.viewer.croppingActive = true;
    this.rootEl.style.display = 'block';
    window.addEventListener('keydown', this._onKey, true);
    window.addEventListener('resize', this._onResize);
    if (this.viewer && typeof this.viewer.subscribe === 'function') {
      this._unsubTransform = this.viewer.subscribe((kind) => {
        if (kind === 'transform' || kind === 'draw') this._onTransform();
      });
    }
    this._renderRect();
  }

  _close() {
    if (!this.active) return;
    this.active = false;
    if (this.viewer) this.viewer.croppingActive = false;
    this.rootEl.style.display = 'none';
    window.removeEventListener('keydown', this._onKey, true);
    window.removeEventListener('resize', this._onResize);
    if (this._unsubTransform) { try { this._unsubTransform(); } catch (e) { void e; } this._unsubTransform = null; }
    this.node = null;
    this.imageEl = null;
    this.imageUrl = '';
    this.drag = null;
  }

  _cancel() {
    if (!this.active) return;
    this._close();
    this.onCancel();
  }

  _apply() {
    if (!this.active) return;
    const r = normaliseRect(this.rect, this.imgW, this.imgH, MIN_RECT_PX);
    if (r.w < 2 || r.h < 2) { this._cancel(); return; }
    const out = document.createElement('canvas');
    out.width = Math.round(r.w);
    out.height = Math.round(r.h);
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.imageEl, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h),
      0, 0, Math.round(r.w), Math.round(r.h));
    const applyCb = this.onApply;
    this._close();
    out.toBlob((blob) => applyCb(blob || null), 'image/webp', 0.9);
  }

  _imageToScreen(ix, iy) {
    const t = this.getTransform();
    const n = this.node;
    const wx = n.x + (ix / this.imgW) * n.width;
    const wy = n.y + (iy / this.imgH) * n.height;
    const r = this.viewport.getBoundingClientRect();
    const cx = wx * t.scale + t.panX;
    const cy = wy * t.scale + t.panY;
    return { x: cx, y: cy, viewportRect: r };
  }

  _screenToImage(sx, sy) {
    const t = this.getTransform();
    const n = this.node;
    const wx = (sx - t.panX) / t.scale;
    const wy = (sy - t.panY) / t.scale;
    const fx = (wx - n.x) / n.width;
    const fy = (wy - n.y) / n.height;
    return { x: fx * this.imgW, y: fy * this.imgH };
  }

  _renderRect() {
    if (!this.active || !this.node) return;
    const a = this._imageToScreen(this.rect.x, this.rect.y);
    const b = this._imageToScreen(this.rect.x + this.rect.w, this.rect.y + this.rect.h);
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    this.rectEl.style.left = `${left}px`;
    this.rectEl.style.top = `${top}px`;
    this.rectEl.style.width = `${w}px`;
    this.rectEl.style.height = `${h}px`;
    const tbX = Math.max(8, Math.min(a.viewportRect.width - 280, left + (w / 2) - 120));
    let tbY = top + h + 12;
    if (tbY > a.viewportRect.height - 56) tbY = Math.max(8, top - 48);
    this.toolbarEl.style.left = `${tbX}px`;
    this.toolbarEl.style.top = `${tbY}px`;
  }

  _onRectMouseDown(ev) {
    if (ev.button !== 0) return;
    const target = ev.target;
    const pt = this._screenToImage(ev.clientX, ev.clientY);
    if (target && target.classList && target.classList.contains('crop-inline-handle')) {
      this.drag = { kind: 'resize', handle: target.dataset.handle, origRect: { ...this.rect }, start: pt };
    } else {
      this.drag = { kind: 'move', origRect: { ...this.rect }, start: pt };
    }
    ev.preventDefault();
    ev.stopPropagation();
  }

  _onMouseMove(ev) {
    if (!this.active || !this.drag) return;
    ev.preventDefault();
    const pt = this._screenToImage(ev.clientX, ev.clientY);
    const orig = this.drag.origRect;
    if (this.drag.kind === 'move') {
      const dx = pt.x - this.drag.start.x;
      const dy = pt.y - this.drag.start.y;
      const nx = clamp(orig.x + dx, 0, this.imgW - orig.w);
      const ny = clamp(orig.y + dy, 0, this.imgH - orig.h);
      this.rect = { x: nx, y: ny, w: orig.w, h: orig.h };
    } else if (this.drag.kind === 'resize') {
      let nx = orig.x;
      let ny = orig.y;
      let nw = orig.w;
      let nh = orig.h;
      const h = this.drag.handle;
      if (h.includes('w')) { nx = pt.x; nw = orig.x + orig.w - pt.x; }
      if (h.includes('e')) { nw = pt.x - orig.x; }
      if (h.includes('n')) { ny = pt.y; nh = orig.y + orig.h - pt.y; }
      if (h.includes('s')) { nh = pt.y - orig.y; }
      const ratio = this._currentRatio();
      if (ratio) {
        const horiz = h === 'e' || h === 'w';
        const vert = h === 'n' || h === 's';
        if (horiz) {
          const newH = nw / ratio;
          if (h.includes('n')) ny = orig.y + orig.h - newH;
          else ny = orig.y + (orig.h - newH) / 2;
          nh = newH;
        } else if (vert) {
          const newW = nh * ratio;
          if (h.includes('w')) nx = orig.x + orig.w - newW;
          else nx = orig.x + (orig.w - newW) / 2;
          nw = newW;
        } else {
          const newH = nw / ratio;
          if (h.includes('n')) ny = orig.y + orig.h - newH;
          nh = newH;
        }
      }
      this.rect = normaliseRect({ x: nx, y: ny, w: nw, h: nh }, this.imgW, this.imgH, MIN_RECT_PX);
    }
    this._renderRect();
  }

  _onMouseUp() {
    if (!this.drag) return;
    this.drag = null;
  }

  _currentRatio() {
    const preset = ASPECT_PRESETS.find((p) => p.id === this.aspectId);
    return preset && preset.ratio ? preset.ratio : null;
  }

  _applyAspectToRect() {
    const ratio = this._currentRatio();
    if (!ratio) return;
    const r = this.rect;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const wByH = r.h * ratio;
    const hByW = r.w / ratio;
    let nw;
    let nh;
    if (wByH <= r.w) { nw = wByH; nh = r.h; }
    else { nw = r.w; nh = hByW; }
    const next = { x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh };
    this.rect = normaliseRect(next, this.imgW, this.imgH, MIN_RECT_PX);
  }
}
