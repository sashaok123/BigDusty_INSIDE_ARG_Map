/* Live cursors overlay. Renders small SVG cursors for other connected clients
   at their reported image-space coordinates, re-rendering on every viewport
   transform change. Stale entries (no update in STALE_MS) are removed. */

import { getClientId } from './api-client.js';

const STALE_MS = 5000;
const SWEEP_MS = 1500;

function colorFromName(name) {
  if (!name) return 'hsl(200 60% 50%)';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 64% 48%)`;
}

export class CursorsOverlay {
  constructor(opts) {
    this.viewport = opts.viewport;
    this.getTransform = opts.getTransform || (() => ({ scale: 1, panX: 0, panY: 0 }));
    this.cursors = new Map();
    this._raf = null;
    this._sweepTimer = null;
    this._build();
    this._startSweeper();
  }

  _build() {
    if (!this.viewport) return;
    const wrap = document.createElement('div');
    wrap.className = 'cursors-overlay';
    wrap.style.position = 'absolute';
    wrap.style.inset = '0';
    wrap.style.pointerEvents = 'none';
    wrap.style.overflow = 'hidden';
    wrap.style.zIndex = '760';
    this.viewport.appendChild(wrap);
    this.el = wrap;
  }

  update(clientId, data) {
    if (!clientId) return;
    const selfId = getClientId();
    if (selfId && clientId === selfId) return;
    if (!data || typeof data.x_image !== 'number' || typeof data.y_image !== 'number') return;
    this.cursors.set(clientId, {
      x_image: data.x_image,
      y_image: data.y_image,
      username: data.username || 'anonymous',
      last_seen: Date.now(),
    });
    this.requestDraw();
  }

  remove(clientId) {
    if (this.cursors.delete(clientId)) this.requestDraw();
  }

  clear() {
    this.cursors.clear();
    this.requestDraw();
  }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._draw();
    });
  }

  _draw() {
    if (!this.el) return;
    while (this.el.firstChild) this.el.removeChild(this.el.firstChild);
    const t = this.getTransform();
    for (const [clientId, cur] of this.cursors) {
      const sx = cur.x_image * t.scale + t.panX;
      const sy = cur.y_image * t.scale + t.panY;
      const node = this._renderCursor(clientId, cur, sx, sy);
      if (node) this.el.appendChild(node);
    }
  }

  _renderCursor(clientId, cur, sx, sy) {
    const color = colorFromName(cur.username);
    const wrap = document.createElement('div');
    wrap.className = 'live-cursor';
    wrap.style.position = 'absolute';
    wrap.style.left = `${sx}px`;
    wrap.style.top = `${sy}px`;
    wrap.style.pointerEvents = 'none';
    wrap.style.transform = 'translate(-2px, -2px)';
    wrap.setAttribute('data-client-id', clientId);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M2 2 L2 14 L6 10 L9 14 L11 13 L8 9 L13 9 Z');
    path.setAttribute('fill', color);
    path.setAttribute('stroke', '#ffffff');
    path.setAttribute('stroke-width', '1');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);

    const label = document.createElement('span');
    label.className = 'live-cursor-label';
    label.textContent = cur.username || 'anonymous';
    label.style.background = color;

    wrap.appendChild(svg);
    wrap.appendChild(label);
    return wrap;
  }

  _startSweeper() {
    if (this._sweepTimer) return;
    this._sweepTimer = setInterval(() => this._sweep(), SWEEP_MS);
  }

  _sweep() {
    const now = Date.now();
    let removed = false;
    for (const [clientId, cur] of this.cursors) {
      if (now - cur.last_seen > STALE_MS) {
        this.cursors.delete(clientId);
        removed = true;
      }
    }
    if (removed) this.requestDraw();
  }

  destroy() {
    if (this._sweepTimer) { clearInterval(this._sweepTimer); this._sweepTimer = null; }
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.cursors.clear();
  }
}
