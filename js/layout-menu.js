/* Floating dropdown menu for the toolbar "Layout" button. Offers force-directed,
   hierarchical, grid and circle algorithms. The actual layout math lives in
   layout.js; this module only owns the UI/anchor positioning and option prompts. */

import { tr } from './i18n.js';

export class LayoutMenu {
  constructor(opts) {
    this.anchorEl = opts.anchorEl;
    this.onApply = opts.onApply || (() => {});
    this._build();
    if (this.anchorEl) this.anchorEl.addEventListener('click', (e) => this._toggle(e));
    document.addEventListener('mousedown', (e) => this._maybeClose(e));
    document.addEventListener('i18n:changed', () => this._retranslate());
  }

  _build() {
    const menu = document.createElement('div');
    menu.className = 'layout-menu';
    menu.id = 'layout-menu';
    menu.innerHTML = `
      <button type="button" class="layout-menu-item" data-algo="force-directed" data-i18n="layout_force_directed">${tr('layout_force_directed')}</button>
      <button type="button" class="layout-menu-item" data-algo="hierarchical" data-i18n="layout_hierarchical">${tr('layout_hierarchical')}</button>
      <button type="button" class="layout-menu-item" data-algo="grid" data-i18n="layout_grid">${tr('layout_grid')}</button>
      <button type="button" class="layout-menu-item" data-algo="circle" data-i18n="layout_circle">${tr('layout_circle')}</button>
    `;
    document.body.appendChild(menu);
    this.menuEl = menu;
    menu.addEventListener('click', (ev) => {
      const btn = ev.target && ev.target.closest && ev.target.closest('.layout-menu-item');
      if (!btn) return;
      const algo = btn.dataset.algo;
      this._close();
      this._invoke(algo);
    });
  }

  _retranslate() {
    if (!this.menuEl) return;
    this.menuEl.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = tr(el.dataset.i18n);
    });
  }

  _invoke(algo) {
    if (!algo) return;
    if (algo === 'grid') {
      const ans = window.prompt(tr('layout_grid_cols_prompt'), '5');
      if (ans == null) return;
      const cols = parseInt(ans, 10);
      if (!Number.isFinite(cols) || cols <= 0) return;
      try { this.onApply('grid', { cols: Math.max(1, Math.min(20, cols)) }); } catch (e) { console.warn('[layout-menu] grid failed', e); }
      return;
    }
    try { this.onApply(algo, {}); } catch (e) { console.warn('[layout-menu] apply failed', e); }
  }

  _toggle(ev) {
    if (ev) ev.preventDefault();
    if (this.menuEl.classList.contains('open')) this._close();
    else this._open();
  }

  _open() {
    if (!this.anchorEl || !this.menuEl) return;
    const r = this.anchorEl.getBoundingClientRect();
    this.menuEl.style.top = `${Math.round(r.bottom + 4)}px`;
    this.menuEl.style.left = `${Math.round(r.left)}px`;
    this.menuEl.classList.add('open');
  }

  _close() { if (this.menuEl) this.menuEl.classList.remove('open'); }

  _maybeClose(ev) {
    if (!this.menuEl || !this.menuEl.classList.contains('open')) return;
    if (this.menuEl.contains(ev.target)) return;
    if (this.anchorEl && this.anchorEl.contains(ev.target)) return;
    this._close();
  }
}
