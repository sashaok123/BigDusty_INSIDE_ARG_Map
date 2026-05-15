/* Side-by-side compare/diff modal. Two-node view with tab switching
   between Compare (raw side-by-side) and Diff (line-level unified diff).
   Image pairs use synchronised zoom + pan. Text/document/transform pairs
   render as monospace columns. Mixed pairs fall back to native renderers
   and disable the diff tab. Built on the same overlay pattern as
   file-viewer.css to stay visually consistent. */

import { tr } from './i18n.js';
import { renderImageInto } from './file-renderers.js';
import { diffLines, diffSummary } from './diff.js';

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|svg|avif)(\?.*)?$/i;

function looksLikeImage(view) {
  if (!view) return false;
  if (typeof view.mime === 'string' && /^image\//i.test(view.mime)) return true;
  if (typeof view.file === 'string' && IMAGE_EXT_RE.test(view.file)) return true;
  return false;
}

function asTextSource(view) {
  if (!view) return '';
  if (view.kind === 'transform') {
    const lines = [];
    if (view.title) lines.push(`# ${view.title}`);
    if (view.input) { lines.push('input:'); lines.push(view.input); }
    if (view.method) lines.push(`method: ${view.method}`);
    if (view.output) { lines.push('output:'); lines.push(view.output); }
    return lines.join('\n');
  }
  if (typeof view.text === 'string' && view.text) return view.text;
  if (view.caption && typeof view.caption.text === 'string') return view.caption.text;
  return '';
}

function el(tag, attrs, kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
  }
  if (kids) for (const c of kids) if (c) e.appendChild(c);
  return e;
}

export class CompareModal {
  constructor() {
    this.overlayEl = null;
    this.boxEl = null;
    this.leftView = null;
    this.rightView = null;
    this.activeTab = 'compare';
    this.syncScroll = true;
    this._zoomLevel = 1;
    this._panX = 0;
    this._panY = 0;
    this._dragState = null;
    this._build();
    document.addEventListener('keydown', (e) => {
      if (this.isOpen() && e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    document.addEventListener('i18n:changed', () => { if (this.isOpen()) this._retranslate(); });
  }

  _build() {
    const overlay = el('div', { class: 'compare-overlay', role: 'dialog' });
    const box = el('div', { class: 'compare-box' });
    const head = el('div', { class: 'compare-head' });
    const title = el('div', { class: 'compare-title' });
    const tabs = el('div', { class: 'compare-tabs' });
    const tabCompare = el('button', { type: 'button', class: 'compare-tab active', text: tr('compare_tab_side_by_side'),
      onclick: () => this._setTab('compare') });
    const tabDiff = el('button', { type: 'button', class: 'compare-tab', text: tr('compare_tab_diff'),
      onclick: () => this._setTab('diff') });
    tabs.appendChild(tabCompare); tabs.appendChild(tabDiff);
    const swapBtn = el('button', { type: 'button', class: 'compare-action', text: tr('compare_swap'),
      onclick: () => this._swap() });
    const closeBtn = el('button', { type: 'button', class: 'compare-close', html: '&times;', onclick: () => this.close() });
    head.appendChild(title);
    head.appendChild(tabs);
    head.appendChild(swapBtn);
    head.appendChild(closeBtn);
    const body = el('div', { class: 'compare-body' });
    const summary = el('div', { class: 'compare-summary' });
    box.appendChild(head); box.appendChild(summary); box.appendChild(body);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });
    this.overlayEl = overlay;
    this.boxEl = box;
    this.titleEl = title;
    this.tabsEl = tabs;
    this.tabCompareEl = tabCompare;
    this.tabDiffEl = tabDiff;
    this.swapBtnEl = swapBtn;
    this.bodyEl = body;
    this.summaryEl = summary;
  }

  isOpen() { return !!(this.overlayEl && this.overlayEl.classList.contains('open')); }

  open(leftView, rightView, opts) {
    if (!leftView || !rightView) return;
    this.leftView = leftView;
    this.rightView = rightView;
    this.activeTab = (opts && opts.tab === 'diff') ? 'diff' : 'compare';
    this._zoomLevel = 1;
    this._panX = 0; this._panY = 0;
    this._render();
    this.overlayEl.classList.add('open');
  }

  close() {
    if (this.overlayEl) this.overlayEl.classList.remove('open');
    this.leftView = null;
    this.rightView = null;
    if (this.bodyEl) this.bodyEl.innerHTML = '';
    if (this.summaryEl) this.summaryEl.innerHTML = '';
  }

  _setTab(name) {
    this.activeTab = name === 'diff' ? 'diff' : 'compare';
    this._render();
  }

  _swap() {
    const a = this.leftView;
    this.leftView = this.rightView;
    this.rightView = a;
    this._render();
  }

  _retranslate() {
    if (this.tabCompareEl) this.tabCompareEl.textContent = tr('compare_tab_side_by_side');
    if (this.tabDiffEl) this.tabDiffEl.textContent = tr('compare_tab_diff');
    if (this.swapBtnEl) this.swapBtnEl.textContent = tr('compare_swap');
    this._render();
  }

  _render() {
    if (!this.leftView || !this.rightView) return;
    const titleLeft = this.leftView.title || this.leftView.slug || this.leftView.id;
    const titleRight = this.rightView.title || this.rightView.slug || this.rightView.id;
    this.titleEl.textContent = tr('compare_title', { left: titleLeft, right: titleRight });
    this.tabCompareEl.classList.toggle('active', this.activeTab === 'compare');
    this.tabDiffEl.classList.toggle('active', this.activeTab === 'diff');
    const leftIsImage = looksLikeImage(this.leftView);
    const rightIsImage = looksLikeImage(this.rightView);
    const bothImage = leftIsImage && rightIsImage;
    const bothText = !leftIsImage && !rightIsImage;
    this.tabDiffEl.disabled = !bothText;
    this.tabDiffEl.classList.toggle('compare-tab-disabled', !bothText);
    if (this.activeTab === 'diff' && !bothText) this.activeTab = 'compare';
    this.bodyEl.innerHTML = '';
    this.summaryEl.innerHTML = '';
    if (this.activeTab === 'diff') {
      this._renderDiff();
      return;
    }
    if (bothImage) {
      this._renderImagePair();
    } else if (bothText) {
      this._renderTextPair();
    } else {
      this._renderMixedPair();
    }
  }

  _renderImagePair() {
    const wrap = el('div', { class: 'compare-image-pair' });
    const controls = el('div', { class: 'compare-image-controls' });
    const zoomOut = el('button', { type: 'button', text: '−', onclick: () => this._zoom(1 / 1.2) });
    const zoomLabel = el('span', { class: 'compare-zoom-label' });
    const zoomIn = el('button', { type: 'button', text: '+', onclick: () => this._zoom(1.2) });
    const resetBtn = el('button', { type: 'button', text: tr('compare_reset_zoom'),
      onclick: () => { this._zoomLevel = 1; this._panX = 0; this._panY = 0; this._applyTransform(); } });
    const syncToggle = el('label', { class: 'compare-sync-toggle' });
    const syncCb = el('input', { type: 'checkbox' });
    syncCb.checked = this.syncScroll;
    syncCb.addEventListener('change', () => { this.syncScroll = !!syncCb.checked; });
    syncToggle.appendChild(syncCb);
    syncToggle.appendChild(document.createTextNode(' ' + tr('compare_sync')));
    controls.appendChild(zoomOut); controls.appendChild(zoomLabel); controls.appendChild(zoomIn);
    controls.appendChild(resetBtn); controls.appendChild(syncToggle);
    wrap.appendChild(controls);
    const split = el('div', { class: 'compare-split' });
    const leftPane = this._makeImagePane(this.leftView, 'left');
    const rightPane = this._makeImagePane(this.rightView, 'right');
    split.appendChild(leftPane); split.appendChild(rightPane);
    wrap.appendChild(split);
    this.bodyEl.appendChild(wrap);
    this._zoomLabelEl = zoomLabel;
    this._leftImageHostEl = leftPane.querySelector('.compare-image-canvas');
    this._rightImageHostEl = rightPane.querySelector('.compare-image-canvas');
    this._applyTransform();
  }

  _makeImagePane(view, side) {
    const pane = el('div', { class: `compare-pane compare-pane-${side}` });
    const head = el('div', { class: 'compare-pane-head' });
    head.textContent = view.title || view.slug || view.id;
    const canvas = el('div', { class: 'compare-image-canvas' });
    const img = document.createElement('img');
    img.alt = view.title || '';
    img.src = view.file || '';
    img.className = 'compare-image';
    canvas.appendChild(img);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      this._zoom(factor);
    }, { passive: false });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this._dragState = { startX: e.clientX, startY: e.clientY, panX: this._panX, panY: this._panY };
    });
    document.addEventListener('mousemove', (e) => {
      if (!this._dragState) return;
      this._panX = this._dragState.panX + (e.clientX - this._dragState.startX);
      this._panY = this._dragState.panY + (e.clientY - this._dragState.startY);
      this._applyTransform();
    });
    document.addEventListener('mouseup', () => { this._dragState = null; });
    pane.appendChild(head); pane.appendChild(canvas);
    return pane;
  }

  _zoom(factor) {
    this._zoomLevel = Math.max(0.1, Math.min(8, this._zoomLevel * factor));
    this._applyTransform();
  }

  _applyTransform() {
    if (this._zoomLabelEl) this._zoomLabelEl.textContent = `${Math.round(this._zoomLevel * 100)}%`;
    const apply = (host) => {
      if (!host) return;
      const img = host.querySelector('img');
      if (img) img.style.transform = `translate(${this._panX}px, ${this._panY}px) scale(${this._zoomLevel})`;
    };
    if (this.syncScroll) {
      apply(this._leftImageHostEl);
      apply(this._rightImageHostEl);
    } else {
      apply(this._leftImageHostEl);
    }
  }

  _renderTextPair() {
    const split = el('div', { class: 'compare-split' });
    const leftPane = el('div', { class: 'compare-pane compare-pane-left' });
    const leftHead = el('div', { class: 'compare-pane-head', text: this.leftView.title || this.leftView.slug || this.leftView.id });
    const leftBody = el('pre', { class: 'compare-text', text: asTextSource(this.leftView) });
    leftPane.appendChild(leftHead); leftPane.appendChild(leftBody);
    const rightPane = el('div', { class: 'compare-pane compare-pane-right' });
    const rightHead = el('div', { class: 'compare-pane-head', text: this.rightView.title || this.rightView.slug || this.rightView.id });
    const rightBody = el('pre', { class: 'compare-text', text: asTextSource(this.rightView) });
    rightPane.appendChild(rightHead); rightPane.appendChild(rightBody);
    split.appendChild(leftPane); split.appendChild(rightPane);
    this.bodyEl.appendChild(split);
    let lock = false;
    const link = (src, dst) => {
      src.addEventListener('scroll', () => {
        if (!this.syncScroll || lock) return;
        lock = true;
        dst.scrollTop = src.scrollTop;
        lock = false;
      });
    };
    link(leftBody, rightBody);
    link(rightBody, leftBody);
  }

  _renderMixedPair() {
    const split = el('div', { class: 'compare-split' });
    split.appendChild(this._renderMixedPane(this.leftView, 'left'));
    split.appendChild(this._renderMixedPane(this.rightView, 'right'));
    this.bodyEl.appendChild(split);
  }

  _renderMixedPane(view, side) {
    const pane = el('div', { class: `compare-pane compare-pane-${side}` });
    const head = el('div', { class: 'compare-pane-head', text: view.title || view.slug || view.id });
    pane.appendChild(head);
    if (looksLikeImage(view)) {
      const host = el('div', { class: 'compare-image-canvas' });
      renderImageInto(host, view.file || '', view.title || '');
      pane.appendChild(host);
    } else {
      const body = el('pre', { class: 'compare-text', text: asTextSource(view) });
      pane.appendChild(body);
    }
    return pane;
  }

  _renderDiff() {
    const leftText = asTextSource(this.leftView);
    const rightText = asTextSource(this.rightView);
    const rows = diffLines(leftText, rightText);
    const sm = diffSummary(rows);
    this.summaryEl.textContent = tr('compare_diff_summary', {
      same: sm.same, add: sm.add, del: sm.del, changed: sm.changed,
    });
    const wrap = el('div', { class: 'compare-diff' });
    const head = el('div', { class: 'compare-diff-head' });
    const leftHead = el('div', { class: 'compare-pane-head', text: this.leftView.title || this.leftView.id });
    const rightHead = el('div', { class: 'compare-pane-head', text: this.rightView.title || this.rightView.id });
    head.appendChild(leftHead); head.appendChild(rightHead);
    wrap.appendChild(head);
    const list = el('div', { class: 'compare-diff-list' });
    for (const r of rows) {
      const row = el('div', { class: `compare-diff-row compare-diff-${r.kind}` });
      const lc = el('div', { class: 'compare-diff-cell compare-diff-left' });
      const rc = el('div', { class: 'compare-diff-cell compare-diff-right' });
      const llNum = el('span', { class: 'compare-diff-lineno', text: r.leftLine ? String(r.leftLine) : '' });
      const llBody = el('span', { class: 'compare-diff-body' });
      const prefix = r.kind === 'del' || r.kind === 'changed' ? '-' : (r.kind === 'add' ? ' ' : ' ');
      llBody.textContent = (r.leftText !== '' || r.kind === 'del' || r.kind === 'changed') ? (prefix + ' ' + r.leftText) : '';
      lc.appendChild(llNum); lc.appendChild(llBody);
      const rlNum = el('span', { class: 'compare-diff-lineno', text: r.rightLine ? String(r.rightLine) : '' });
      const rlBody = el('span', { class: 'compare-diff-body' });
      const rprefix = r.kind === 'add' || r.kind === 'changed' ? '+' : (r.kind === 'del' ? ' ' : ' ');
      rlBody.textContent = (r.rightText !== '' || r.kind === 'add' || r.kind === 'changed') ? (rprefix + ' ' + r.rightText) : '';
      rc.appendChild(rlNum); rc.appendChild(rlBody);
      row.appendChild(lc); row.appendChild(rc);
      list.appendChild(row);
    }
    wrap.appendChild(list);
    this.bodyEl.appendChild(wrap);
  }
}
