/* HTML overlay for video nodes (kind: 'video'). The viewer canvas does not
   render <iframe>s, so we mount them in an absolute layer above the canvas
   and reposition them on transform changes. */

export class VideoOverlay {
  constructor(opts) {
    this.viewport = opts.viewport;
    this.getNodes = opts.getNodes;
    this.getTransform = opts.getTransform;
    this.viewer = opts.viewer || null;
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
    wrap.className = 'video-overlay';
    wrap.style.position = 'absolute';
    wrap.style.inset = '0';
    wrap.style.pointerEvents = 'none';
    wrap.style.zIndex = '720';
    this.viewport.appendChild(wrap);
    this.el = wrap;
    this._mounted = new Map();
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
    const t = this.getTransform();
    const seenIds = new Set();
    const nodes = this.getNodes();
    for (const n of nodes.values()) {
      if (n.kind !== 'video') continue;
      seenIds.add(n.id);
      let host = this._mounted.get(n.id);
      if (!host) {
        host = document.createElement('div');
        host.className = 'video-node';
        host.dataset.id = n.id;
        host.style.position = 'absolute';
        host.style.pointerEvents = 'auto';
        host.style.background = 'rgba(0,0,0,0.5)';
        this.el.appendChild(host);
        this._mounted.set(n.id, host);
      }
      const left = n.x * t.scale + t.panX;
      const top = n.y * t.scale + t.panY;
      const width = n.width * t.scale;
      const height = n.height * t.scale;
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
      host.style.width = `${width}px`;
      host.style.height = `${height}px`;
      this._mountInner(host, n);
    }
    for (const [id, host] of this._mounted.entries()) {
      if (!seenIds.has(id)) {
        if (host.parentNode) host.parentNode.removeChild(host);
        this._mounted.delete(id);
      }
    }
  }

  _mountInner(host, node) {
    const media = node.media || {};
    const cur = host.dataset.media || '';
    const key = `${media.kind || ''}|${media.embedUrl || ''}|${media.url || ''}|${node.file || ''}`;
    if (cur === key && host.firstChild) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    host.dataset.media = key;
    if (media.kind === 'youtube' || media.kind === 'vimeo') {
      const iframe = document.createElement('iframe');
      iframe.src = media.embedUrl || '';
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = '0';
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      host.appendChild(iframe);
    } else if (node.file || media.url) {
      const v = document.createElement('video');
      v.src = node.file || media.url;
      v.controls = true;
      v.style.width = '100%';
      v.style.height = '100%';
      v.style.background = '#000';
      host.appendChild(v);
    }
  }
}
