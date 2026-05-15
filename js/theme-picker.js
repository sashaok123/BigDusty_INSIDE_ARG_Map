/* Theme picker dropdown for the toolbar. Replaces the multi-button toggle with
   a single anchor that opens a list of available themes. Each item shows a small
   swatch (canvas + accent) and a label; the currently active theme is marked
   with a checkmark. Uses the `ui:dropdown-opened` CustomEvent to coordinate with
   bookmarks/layout/activity dropdowns. */

import { tr, setI18nText } from './i18n.js';

const THEME_DEFS = [
  { id: 'white',    canvas: '#ffffff', accent: '#2e6fe8', i18n: 'theme_white' },
  { id: 'dark',     canvas: '#16181c', accent: '#e86b2e', i18n: 'theme_dark' },
  { id: 'graphite', canvas: '#2a2c33', accent: '#6aa3ff', i18n: 'theme_graphite' },
  { id: 'sepia',    canvas: '#f5edd6', accent: '#a8704a', i18n: 'theme_sepia' },
  { id: 'noir',     canvas: '#0a0a0d', accent: '#4dd0ff', i18n: 'theme_noir' },
];

export const THEME_PICKER_IDS = THEME_DEFS.map((t) => t.id);

export class ThemePicker {
  constructor(opts) {
    const o = opts || {};
    this.getChoice = o.getChoice || (() => 'white');
    this.onChoose = o.onChoose || (() => {});
    this.themes = Array.isArray(o.themes) && o.themes.length ? o.themes : THEME_DEFS;
    this._build();
    document.addEventListener('mousedown', (e) => this._maybeClose(e));
    document.addEventListener('i18n:changed', () => this._retranslate());
    document.addEventListener('ui:dropdown-opened', (ev) => {
      if (ev && ev.detail && ev.detail.source === 'theme') return;
      this._close();
    });
  }

  _build() {
    const wrap = document.createElement('div');
    wrap.className = 'tb-group tb-group-theme';
    wrap.id = 'theme-switch';
    wrap.setAttribute('aria-label', tr('theme_toggle_aria'));

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-trigger';
    btn.id = 'theme-trigger';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', (e) => this._toggle(e));
    wrap.appendChild(btn);
    this.wrapEl = wrap;
    this.btnEl = btn;

    const target = document.querySelector('#toolbar .tb-zone-right');
    if (target) {
      const langWrap = target.querySelector('#lang-select-wrap');
      if (langWrap) target.insertBefore(wrap, langWrap);
      else target.appendChild(wrap);
    }

    const menu = document.createElement('div');
    menu.className = 'theme-menu';
    menu.id = 'theme-menu';
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    this.menuEl = menu;
    menu.addEventListener('click', (ev) => {
      const item = ev.target && ev.target.closest && ev.target.closest('.theme-menu-item');
      if (!item) return;
      const id = item.dataset.theme;
      this._close();
      if (id) {
        try { this.onChoose(id); } catch (e) { console.warn('[theme-picker] choose failed', e); }
      }
    });

    this.refresh();
  }

  refresh() {
    if (!this.menuEl) return;
    const choice = this._safeChoice();
    this.menuEl.innerHTML = '';
    for (const t of this.themes) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'theme-menu-item';
      item.dataset.theme = t.id;
      item.setAttribute('role', 'menuitem');
      const swatch = document.createElement('span');
      swatch.className = 'theme-menu-swatch';
      swatch.style.background = t.canvas;
      const dot = document.createElement('span');
      dot.className = 'theme-menu-swatch-dot';
      dot.style.background = t.accent;
      swatch.appendChild(dot);
      item.appendChild(swatch);
      const label = document.createElement('span');
      label.className = 'theme-menu-label';
      label.dataset.i18n = t.i18n;
      label.textContent = tr(t.i18n);
      item.appendChild(label);
      const check = document.createElement('span');
      check.className = 'theme-menu-check';
      check.textContent = t.id === choice ? '✓' : '';
      item.appendChild(check);
      if (t.id === choice) item.classList.add('active');
      this.menuEl.appendChild(item);
    }
    this._refreshTrigger();
  }

  setChoice(id) {
    void id;
    this.refresh();
  }

  _refreshTrigger() {
    if (!this.btnEl) return;
    const choice = this._safeChoice();
    const def = this.themes.find((t) => t.id === choice) || this.themes[0];
    const labelText = def ? tr(def.i18n) : '';
    this.btnEl.innerHTML = '';
    const swatch = document.createElement('span');
    swatch.className = 'theme-trigger-swatch';
    swatch.style.background = def ? def.canvas : '#fff';
    const dot = document.createElement('span');
    dot.className = 'theme-trigger-dot';
    dot.style.background = def ? def.accent : '#2e6fe8';
    swatch.appendChild(dot);
    this.btnEl.appendChild(swatch);
    const txt = document.createElement('span');
    txt.className = 'theme-trigger-text';
    txt.textContent = `${tr('theme_picker_label')}: ${labelText}`;
    this.btnEl.appendChild(txt);
    const caret = document.createElement('span');
    caret.className = 'theme-trigger-caret';
    caret.textContent = '▾';
    caret.setAttribute('aria-hidden', 'true');
    this.btnEl.appendChild(caret);
    this.btnEl.title = labelText;
    this.btnEl.setAttribute('aria-label', `${tr('theme_picker_label')}: ${labelText}`);
  }

  _safeChoice() {
    let c = '';
    try { c = this.getChoice() || ''; } catch (e) { void e; c = ''; }
    if (!this.themes.some((t) => t.id === c)) return this.themes[0] ? this.themes[0].id : 'white';
    return c;
  }

  _retranslate() {
    if (!this.menuEl) return;
    this.menuEl.querySelectorAll('[data-i18n]').forEach((el) => {
      setI18nText(el, el.dataset.i18n);
    });
    if (this.wrapEl) this.wrapEl.setAttribute('aria-label', tr('theme_toggle_aria'));
    this._refreshTrigger();
  }

  _toggle(ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    if (this.menuEl.classList.contains('open')) this._close();
    else this._open();
  }

  _open() {
    if (!this.btnEl || !this.menuEl) return;
    this.refresh();
    const r = this.btnEl.getBoundingClientRect();
    const top = Math.round(r.bottom + 4);
    const right = Math.max(8, Math.round(window.innerWidth - r.right));
    this.menuEl.style.top = `${top}px`;
    this.menuEl.style.right = `${right}px`;
    this.menuEl.style.left = '';
    this.menuEl.classList.add('open');
    this.btnEl.setAttribute('aria-expanded', 'true');
    try {
      document.dispatchEvent(new CustomEvent('ui:dropdown-opened', { detail: { source: 'theme' } }));
    } catch (e) { void e; }
  }

  _close() {
    if (this.menuEl) this.menuEl.classList.remove('open');
    if (this.btnEl) this.btnEl.setAttribute('aria-expanded', 'false');
  }

  _maybeClose(ev) {
    if (!this.menuEl || !this.menuEl.classList.contains('open')) return;
    if (this.menuEl.contains(ev.target)) return;
    if (this.btnEl && this.btnEl.contains(ev.target)) return;
    this._close();
  }
}
