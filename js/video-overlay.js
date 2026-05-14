/* HTML overlay for video nodes (kind: 'video'). Renders a placeholder
   (thumbnail + play triangle) until the user clicks; only then is the
   <iframe> or <video> element materialised. */

import { tr } from './i18n.js';

function youtubeThumb(videoId) {
  if (!videoId) return null;
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

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
    document.addEventListener('i18n:changed', () => this._retranslate());
  }

  _build() {
    if (!this.viewport) return;
    const wrap = document.createElement('div');
    wrap.className = 'video-overlay';
    wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:720';
    this.viewport.appendChild(wrap);
    this.el = wrap;
    this._mounted = new Map();
  }

  requestDraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); });
  }

  _retranslate() {
    for (const [, host] of this._mounted) {
      const label = host.querySelector('.video-placeholder-label');
      if (label) label.textContent = tr('video_play_placeholder');
    }
  }

  _draw() {
    if (!this.el) return;
    const t = this.getTransform();
    const seenIds = new Set();
    for (const n of this.getNodes().values()) {
      if (n.kind !== 'video') continue;
      seenIds.add(n.id);
      let host = this._mounted.get(n.id);
      if (!host) {
        host = document.createElement('div');
        host.className = 'video-node';
        host.dataset.id = n.id;
        host.style.cssText = 'position:absolute;pointer-events:auto;background:rgba(0,0,0,0.5)';
        this.el.appendChild(host);
        this._mounted.set(n.id, host);
      }
      host.style.left = `${n.x * t.scale + t.panX}px`;
      host.style.top = `${n.y * t.scale + t.panY}px`;
      host.style.width = `${n.width * t.scale}px`;
      host.style.height = `${n.height * t.scale}px`;
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
    host._materialised = false;
    const placeholder = document.createElement('div');
    placeholder.className = 'video-placeholder';
    placeholder.style.cssText = 'width:100%;height:100%';
    if (media.kind === 'youtube' && media.videoId) {
      const thumb = youtubeThumb(media.videoId);
      if (thumb) placeholder.style.backgroundImage = `url("${thumb}")`;
    } else {
      placeholder.classList.add('video-placeholder-generic');
    }
    placeholder.innerHTML += '<div class="video-placeholder-play"><svg viewBox="0 0 24 24" width="56" height="56" aria-hidden="true"><circle cx="12" cy="12" r="11.5" fill="rgba(0,0,0,0.55)"/><path d="M9 7l9 5-9 5z" fill="#fff"/></svg></div>';
    const label = document.createElement('div');
    label.className = 'video-placeholder-label';
    label.textContent = tr('video_play_placeholder');
    placeholder.appendChild(label);
    placeholder.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      this._materialise(host, node);
    });
    host.appendChild(placeholder);
  }

  _materialise(host, node) {
    if (host._materialised) return;
    host._materialised = true;
    const media = node.media || {};
    while (host.firstChild) host.removeChild(host.firstChild);
    if (media.kind === 'youtube' || media.kind === 'vimeo') {
      const base = media.embedUrl || '';
      const sep = base.includes('?') ? '&' : '?';
      const src = base ? `${base}${sep}autoplay=1` : '';
      const iframe = document.createElement('iframe');
      iframe.src = src;
      iframe.style.cssText = 'width:100%;height:100%;border:0';
      iframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      host.appendChild(iframe);
    } else if (node.file || media.url) {
      const v = document.createElement('video');
      v.controls = true;
      v.style.cssText = 'width:100%;height:100%;background:#000';
      v.volume = 0.5;
      const srcEl = document.createElement('source');
      srcEl.src = node.file || media.url;
      v.appendChild(srcEl);
      host.appendChild(v);
      v.play().catch(() => {});
    }
  }
}
