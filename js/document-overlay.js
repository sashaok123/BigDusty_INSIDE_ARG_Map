/* HTML overlay for document nodes (kind: 'document'). Renders an icon + name
   card on canvas; double-click opens the FileViewerModal. Body is fetched
   only on open (lazy). */

import { tr } from './i18n.js';

function iconForMime(mime) {
  const m = (mime || '').toLowerCase();
  if (m === 'text/html') return 'HTML';
  if (m === 'application/json') return 'JSON';
  if (m === 'application/xml' || m === 'text/xml') return 'XML';
  if (m === 'application/pdf') return 'PDF';
  if (m === 'text/csv') return 'CSV';
  if (m === 'text/markdown') return 'MD';
  if (/^text\//.test(m)) return 'TXT';
  return 'FILE';
}

export class DocumentOverlay {
  constructor(opts) {
    this.viewport = opts.viewport;
    this.getNodes = opts.getNodes;
    this.getTransform = opts.getTransform;
    this.viewer = opts.viewer || null;
    this.onOpen = opts.onOpen || (() => {});
    this._raf = null;
    this._build();
    if (this.viewer && typeof this.viewer.subscribe === 'function') {
      this.viewer.subscribe((kind) => {
        if (kind === 'transform' || kind === 'nodes') this.requestDraw();
      });
    }
  }

  _build() {
    if (!this.viewport) return;
    const wrap = document.createElement('div');
    wrap.className = 'document-overlay';
    wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:720';
    this.viewport.appendChild(wrap);
    this.el = wrap;
    this._mounted = new Map();
  }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); });
  }

  _draw() {
    if (!this.el) return;
    const t = this.getTransform();
    const seenIds = new Set();
    for (const n of this.getNodes().values()) {
      if (n.kind !== 'document') continue;
      seenIds.add(n.id);
      let host = this._mounted.get(n.id);
      if (!host) { host = this._buildCard(n); this.el.appendChild(host); this._mounted.set(n.id, host); }
      host.style.left = `${n.x * t.scale + t.panX}px`;
      host.style.top = `${n.y * t.scale + t.panY}px`;
      host.style.width = `${n.width * t.scale}px`;
      host.style.height = `${n.height * t.scale}px`;
      this._syncMeta(host, n);
    }
    for (const [id, host] of this._mounted.entries()) {
      if (!seenIds.has(id)) {
        if (host.parentNode) host.parentNode.removeChild(host);
        this._mounted.delete(id);
      }
    }
  }

  _syncMeta(host, node) {
    const name = host.querySelector('.doc-card-name');
    if (name) name.textContent = node.name || node.slug || node.id;
    const tag = host.querySelector('.doc-card-tag');
    if (tag) tag.textContent = iconForMime(node.mime);
  }

  _buildCard(node) {
    const card = document.createElement('div');
    card.className = 'doc-card';
    card.dataset.id = node.id;
    card.style.cssText = 'position:absolute;pointer-events:auto';
    const tag = document.createElement('div');
    tag.className = 'doc-card-tag';
    tag.textContent = iconForMime(node.mime);
    const name = document.createElement('div');
    name.className = 'doc-card-name';
    name.textContent = node.name || node.slug || node.id;
    const hint = document.createElement('div');
    hint.className = 'doc-card-hint';
    hint.textContent = tr('file_viewer_title');
    card.appendChild(tag); card.appendChild(name); card.appendChild(hint);
    card.addEventListener('dblclick', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.onOpen(node);
    });
    return card;
  }
}
