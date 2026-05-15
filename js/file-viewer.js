/* Modal viewer for HTML / plain text / markdown / JSON / XML / CSV / PDF
   and binary files. Delegates rendering to file-renderers.js. Lazy: fetches
   the file body on open. HTML has Render/Source tabs; binary mimes fall
   back to a hex viewer. */

import { tr } from './i18n.js';
import {
  renderHtmlInto, renderTextInto, renderJsonInto, renderPdfInto,
  renderImageInto, renderHexInto, fetchAsText, fetchAsBytes, pickRenderer,
} from './file-renderers.js';

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
    this._currentName = '';
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

  async open(node, opts) {
    if (!node) return;
    this._currentNode = node;
    this._currentName = node.name || node.slug || node.id;
    this._currentMime = (node.mime || '').toLowerCase();
    this._currentUrl = node.file || (node.media && node.media.url) || '';
    this._forcedMode = (opts && typeof opts.mode === 'string') ? opts.mode : null;
    if (this.titleEl) this.titleEl.textContent = this._currentName;
    this.bodyEl.textContent = tr('file_preview_loading');
    this.overlay.classList.add('open');
    let kind = pickRenderer(this._currentMime, this._currentName);
    if (this._forcedMode === 'hex') kind = 'hex';
    else if (this._forcedMode === 'source') kind = 'text';
    else if (this._forcedMode === 'render' && this._currentMime === 'text/html') kind = 'html';
    else if (this._forcedMode === 'image') kind = 'image';
    if (kind === 'pdf') { renderPdfInto(this.bodyEl, this._currentUrl); this._setTabsVisible(false); return; }
    if (kind === 'image') { renderImageInto(this.bodyEl, this._currentUrl, this._currentName); this._setTabsVisible(false); return; }
    if (kind === 'hex') {
      try {
        const bytes = await fetchAsBytes(this._currentUrl);
        this._currentBytes = bytes;
        this._setTabsVisible(false);
        renderHexInto(this.bodyEl, bytes, { onDownload: () => this._doDownload() });
      } catch (e) {
        this.bodyEl.textContent = (e && e.message) || tr('file_preview_fetch_failed');
      }
      return;
    }
    try {
      if (kind === 'html') {
        this._currentText = await fetchAsText(this._currentUrl);
        this._setTabsVisible(true);
        this._setTab(this._forcedMode === 'source' ? 'source' : 'render');
        return;
      }
      if (kind === 'json') {
        this._currentText = await fetchAsText(this._currentUrl);
        this._setTabsVisible(false); renderJsonInto(this.bodyEl, this._currentText); return;
      }
      if (kind === 'text') {
        this._currentText = await fetchAsText(this._currentUrl);
        this._setTabsVisible(false);
        renderTextInto(this.bodyEl, this._currentText, this._currentMime, this._currentName);
        return;
      }
      const bytes = await fetchAsBytes(this._currentUrl);
      this._currentBytes = bytes;
      this._setTabsVisible(false);
      renderHexInto(this.bodyEl, bytes, { onDownload: () => this._doDownload() });
    } catch (e) {
      this.bodyEl.textContent = (e && e.message) || tr('file_preview_fetch_failed');
    }
  }

  close() {
    if (this.overlay) this.overlay.classList.remove('open');
    this.bodyEl.innerHTML = '';
    this._currentText = '';
    this._currentBytes = null;
  }

  _setTabsVisible(visible) {
    if (this.tabsEl) this.tabsEl.style.display = visible ? '' : 'none';
  }

  _setTab(name) {
    if (!this._currentMime) return;
    this.tabRenderBtn.classList.toggle('active', name === 'render');
    this.tabSourceBtn.classList.toggle('active', name === 'source');
    if (this._currentMime === 'text/html') {
      if (name === 'render') renderHtmlInto(this.bodyEl, this._currentText);
      else renderTextInto(this.bodyEl, this._currentText, this._currentMime, this._currentName);
    }
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
