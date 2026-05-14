/* Modal viewer for HTML / plain text / markdown / JSON / XML / CSV / PDF.
   Lazy: fetches the file body only on open. Renders an iframe sandbox for
   HTML (with Render/Source tabs), pretty-printed JSON, syntax-highlighted
   text, or an <embed> for PDFs. */

import { tr } from './i18n.js';

const TEXT_LIKE = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/xml', 'text/xml']);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function colourTokens(text, mime) {
  if (mime === 'application/json') {
    let html = '';
    const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}\[\],:])|(\s+)|([^"\s{}\[\],:]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1]) {
        const cls = m[2] ? 'fv-tok-key' : 'fv-tok-string';
        html += `<span class="${cls}">${escapeHtml(m[1])}</span>${m[2] ? escapeHtml(m[2]) : ''}`;
      } else if (m[3]) html += `<span class="fv-tok-bool">${escapeHtml(m[3])}</span>`;
      else if (m[4]) html += `<span class="fv-tok-num">${escapeHtml(m[4])}</span>`;
      else if (m[5]) html += `<span class="fv-tok-punct">${escapeHtml(m[5])}</span>`;
      else if (m[6]) html += escapeHtml(m[6]);
      else if (m[7]) html += escapeHtml(m[7]);
    }
    return html;
  }
  if (mime === 'application/xml' || mime === 'text/xml' || mime === 'text/html') {
    let html = escapeHtml(text);
    html = html.replace(/(&lt;\/?)([a-zA-Z][\w:-]*)/g, '$1<span class="fv-tok-tag">$2</span>');
    html = html.replace(/(\s)([a-zA-Z][\w:-]*)(=)(&quot;[^&]*?&quot;)/g, '$1<span class="fv-tok-attr">$2</span>$3<span class="fv-tok-string">$4</span>');
    return html;
  }
  let html = escapeHtml(text);
  html = html.replace(/(^|[\s\(\[,])(-?\d+(?:\.\d+)?)/g, '$1<span class="fv-tok-num">$2</span>');
  html = html.replace(/("(?:\\.|[^"\\])*")/g, '<span class="fv-tok-string">$1</span>');
  html = html.replace(/('(?:\\.|[^'\\])*')/g, '<span class="fv-tok-string">$1</span>');
  return html;
}

function renderJsonTree(obj, indent) {
  const pad = '  '.repeat(indent);
  if (obj === null) return `<span class="fv-tok-bool">null</span>`;
  if (typeof obj === 'boolean') return `<span class="fv-tok-bool">${obj}</span>`;
  if (typeof obj === 'number') return `<span class="fv-tok-num">${obj}</span>`;
  if (typeof obj === 'string') return `<span class="fv-tok-string">${escapeHtml(JSON.stringify(obj))}</span>`;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '<span class="fv-tok-punct">[]</span>';
    const sub = obj.map((v) => `${pad}  ${renderJsonTree(v, indent + 1)}`).join(',\n');
    return `<span class="fv-tree-toggle" data-open="1">▾</span><span class="fv-tok-punct">[</span>\n${sub}\n${pad}<span class="fv-tok-punct">]</span>`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '<span class="fv-tok-punct">{}</span>';
    const sub = keys.map((k) => {
      const v = renderJsonTree(obj[k], indent + 1);
      return `${pad}  <span class="fv-tok-key">"${escapeHtml(k)}"</span><span class="fv-tok-punct">:</span> ${v}`;
    }).join(',\n');
    return `<span class="fv-tree-toggle" data-open="1">▾</span><span class="fv-tok-punct">{</span>\n${sub}\n${pad}<span class="fv-tok-punct">}</span>`;
  }
  return escapeHtml(String(obj));
}

export class FileViewerModal {
  constructor() { this._build(); }

  _build() {
    const overlay = document.createElement('div');
    overlay.id = 'file-viewer-overlay';
    overlay.className = 'file-viewer-overlay';
    overlay.innerHTML = `
      <div class="file-viewer-box">
        <div class="file-viewer-head">
          <div class="file-viewer-title-wrap">
            <span class="file-viewer-title" data-i18n="file_viewer_title">${tr('file_viewer_title')}</span>
            <span class="file-viewer-filename"></span>
          </div>
          <div class="file-viewer-tabs">
            <button type="button" class="fv-tab fv-tab-render" data-i18n="file_viewer_render">${tr('file_viewer_render')}</button>
            <button type="button" class="fv-tab fv-tab-source" data-i18n="file_viewer_source">${tr('file_viewer_source')}</button>
          </div>
          <div class="file-viewer-actions">
            <button type="button" class="fv-action fv-copy" title="${tr('file_viewer_copy')}" aria-label="${tr('file_viewer_copy')}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="9" y="3" width="12" height="14" rx="2"/><rect x="3" y="7" width="12" height="14" rx="2"/></svg></button>
            <button type="button" class="fv-action fv-download" title="${tr('file_viewer_download')}" aria-label="${tr('file_viewer_download')}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4v12"/><path d="M7 11l5 5l5-5"/><path d="M4 20h16"/></svg></button>
            <button type="button" class="fv-action fv-close" title="${tr('file_viewer_close')}" aria-label="${tr('file_viewer_close')}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg></button>
          </div>
        </div>
        <div class="file-viewer-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.titleEl = overlay.querySelector('.file-viewer-filename');
    this.bodyEl = overlay.querySelector('.file-viewer-body');
    this.tabRenderBtn = overlay.querySelector('.fv-tab-render');
    this.tabSourceBtn = overlay.querySelector('.fv-tab-source');
    this.tabsEl = overlay.querySelector('.file-viewer-tabs');
    overlay.querySelector('.fv-close').addEventListener('click', () => this.close());
    overlay.querySelector('.fv-copy').addEventListener('click', () => this._doCopy());
    overlay.querySelector('.fv-download').addEventListener('click', () => this._doDownload());
    this.tabRenderBtn.addEventListener('click', () => this._setTab('render'));
    this.tabSourceBtn.addEventListener('click', () => this._setTab('source'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) this.close();
    });
    document.addEventListener('i18n:changed', () => this._retranslate());
    this._currentText = '';
    this._currentMime = '';
  }

  _retranslate() {
    if (!this.overlay) return;
    this.overlay.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = tr(el.dataset.i18n); });
    const copy = this.overlay.querySelector('.fv-copy');
    if (copy) { copy.title = tr('file_viewer_copy'); copy.setAttribute('aria-label', tr('file_viewer_copy')); }
    const dl = this.overlay.querySelector('.fv-download');
    if (dl) { dl.title = tr('file_viewer_download'); dl.setAttribute('aria-label', tr('file_viewer_download')); }
    const cl = this.overlay.querySelector('.fv-close');
    if (cl) { cl.title = tr('file_viewer_close'); cl.setAttribute('aria-label', tr('file_viewer_close')); }
  }

  async open(node) {
    if (!node) return;
    this._currentNode = node;
    this._currentName = node.name || node.slug || node.id;
    this._currentMime = (node.mime || '').toLowerCase();
    this._currentUrl = node.file || (node.media && node.media.url) || '';
    if (this.titleEl) this.titleEl.textContent = this._currentName;
    this.bodyEl.textContent = tr('audio_loading');
    this.overlay.classList.add('open');
    if (this._currentMime === 'application/pdf') {
      this._renderPdf(); this._setTabsVisible(false); return;
    }
    try {
      if (this._currentMime === 'text/html') {
        this._currentText = await this._fetchText();
        this._setTabsVisible(true); this._setTab('render'); return;
      }
      if (this._currentMime === 'application/json') {
        this._currentText = await this._fetchText();
        this._setTabsVisible(false); this._renderJson(this._currentText); return;
      }
      if (TEXT_LIKE.has(this._currentMime) || /^text\//.test(this._currentMime)) {
        this._currentText = await this._fetchText();
        this._setTabsVisible(false); this._renderText(this._currentText); return;
      }
      this.bodyEl.textContent = 'unsupported_mime';
    } catch (e) {
      this.bodyEl.textContent = e && e.message ? e.message : 'fetch_failed';
    }
  }

  close() {
    if (this.overlay) this.overlay.classList.remove('open');
    this.bodyEl.innerHTML = '';
    this._currentText = '';
  }

  _setTabsVisible(visible) {
    if (this.tabsEl) this.tabsEl.style.display = visible ? '' : 'none';
  }

  async _fetchText() {
    if (!this._currentUrl) throw new Error('no url');
    const res = await fetch(this._currentUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    return await res.text();
  }

  _setTab(name) {
    if (!this._currentMime) return;
    this.tabRenderBtn.classList.toggle('active', name === 'render');
    this.tabSourceBtn.classList.toggle('active', name === 'source');
    if (this._currentMime === 'text/html') {
      if (name === 'render') this._renderHtml(this._currentText);
      else this._renderText(this._currentText);
    }
  }

  _renderHtml(text) {
    this.bodyEl.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.sandbox = 'allow-same-origin';
    iframe.style.cssText = 'width:100%;height:100%;border:0;background:#fff';
    this.bodyEl.appendChild(iframe);
    try {
      const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
      if (doc) { doc.open(); doc.write(text); doc.close(); }
    } catch (e) { void e; }
  }

  _renderText(text) {
    this.bodyEl.innerHTML = '';
    const pre = document.createElement('pre');
    pre.className = 'fv-pre';
    pre.innerHTML = colourTokens(text || '', this._currentMime);
    this.bodyEl.appendChild(pre);
  }

  _renderJson(text) {
    this.bodyEl.innerHTML = '';
    let obj = null; let err = null;
    try { obj = JSON.parse(text); } catch (e) { err = e; }
    const pre = document.createElement('pre');
    pre.className = 'fv-pre fv-json';
    if (err) pre.innerHTML = `<span class="fv-tok-error">${escapeHtml(err.message)}</span>\n\n` + colourTokens(text || '', 'application/json');
    else pre.innerHTML = renderJsonTree(obj, 0);
    this.bodyEl.appendChild(pre);
    pre.addEventListener('click', (e) => {
      if (!e.target.classList.contains('fv-tree-toggle')) return;
      const tog = e.target;
      const open = tog.dataset.open === '1';
      tog.dataset.open = open ? '0' : '1';
      tog.textContent = open ? '▸' : '▾';
      let next = tog.nextElementSibling;
      while (next && !next.classList.contains('fv-tree-toggle-end')) {
        next.style.display = open ? 'none' : '';
        next = next.nextElementSibling;
      }
    });
  }

  _renderPdf() {
    this.bodyEl.innerHTML = '';
    const embed = document.createElement('embed');
    embed.type = 'application/pdf';
    embed.src = this._currentUrl;
    embed.style.cssText = 'width:100%;height:100%';
    this.bodyEl.appendChild(embed);
  }

  _doDownload() {
    if (!this._currentUrl) return;
    const a = document.createElement('a');
    a.href = this._currentUrl;
    a.download = this._currentName || 'file';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  async _doCopy() {
    try {
      if (this._currentMime === 'application/pdf') return;
      await navigator.clipboard.writeText(this._currentText || '');
    } catch (e) { void e; }
  }
}
