/* URL drop handler for the canvas viewport. When a user drops a URL string
   (no files attached), this module reads it from the data transfer, fetches
   metadata via the admin endpoint, and asks the host to place a document
   node at the drop point. Files are ignored — the uploader owns that path. */

import { tr } from './i18n.js';

const URL_RE = /^https?:\/\/\S+$/i;

function extractUrl(dt) {
  if (!dt) return null;
  try {
    const uriList = dt.getData('text/uri-list');
    if (uriList) {
      const first = uriList.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))[0];
      if (first && URL_RE.test(first)) return first;
    }
  } catch (e) { void e; }
  try {
    const plain = dt.getData('text/plain');
    if (plain) {
      const t = plain.trim();
      if (URL_RE.test(t)) return t;
    }
  } catch (e) { void e; }
  return null;
}

export class UrlDrop {
  constructor(opts) {
    this.viewport = opts.viewport;
    this.isEnabled = opts.isEnabled || (() => true);
    this.toClientToImage = opts.toClientToImage || (() => null);
    this.onFetchMeta = opts.onFetchMeta || (async () => null);
    this.onPlaceUrlNode = opts.onPlaceUrlNode || (async () => null);
    this.onToast = opts.onToast || (() => {});
    if (this.viewport) this._bind();
  }

  _bind() {
    this.viewport.addEventListener('dragover', (ev) => {
      if (!this.isEnabled()) return;
      if (this._hasFiles(ev)) return;
      if (!this._hasUrl(ev)) return;
      ev.preventDefault();
      try { ev.dataTransfer.dropEffect = 'link'; } catch (err) { void err; }
    });
    this.viewport.addEventListener('drop', (ev) => {
      if (!this.isEnabled()) return;
      if (this._hasFiles(ev)) return;
      const url = extractUrl(ev.dataTransfer);
      if (!url) return;
      ev.preventDefault();
      ev.stopPropagation();
      const worldPt = this.toClientToImage(ev.clientX, ev.clientY) || { x: 0, y: 0 };
      this._handle(url, worldPt);
    });
  }

  _hasFiles(ev) {
    if (!ev.dataTransfer) return false;
    const items = ev.dataTransfer.items;
    if (items && items.length) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') return true;
      }
    }
    if (ev.dataTransfer.files && ev.dataTransfer.files.length) return true;
    return false;
  }

  _hasUrl(ev) {
    const types = ev.dataTransfer && ev.dataTransfer.types;
    if (!types) return false;
    const list = Array.prototype.slice.call(types);
    if (list.indexOf('text/uri-list') !== -1) return true;
    if (list.indexOf('text/plain') !== -1) return true;
    return false;
  }

  async _handle(url, worldPt) {
    this.onToast(tr('url_drop_fetching_meta'));
    let meta = null;
    try {
      meta = await this.onFetchMeta(url);
    } catch (e) {
      if (e && e.kind === 'auth_expired') {
        return;
      }
      this.onToast(tr('url_drop_meta_failed'), 'error');
    }
    try {
      await this.onPlaceUrlNode({
        url,
        rect: { x: Math.round(worldPt.x - 130), y: Math.round(worldPt.y - 60), w: 260, h: 120 },
        title: (meta && meta.title) || null,
        description: (meta && meta.description) || null,
        imageUrl: (meta && meta.image_url) || null,
      });
      this.onToast(tr('url_drop_created'));
    } catch (e) {
      console.warn('[url-drop] place failed', e);
    }
  }
}
