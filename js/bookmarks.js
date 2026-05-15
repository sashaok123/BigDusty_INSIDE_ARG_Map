/* Top-toolbar bookmarks dropdown. Lists nodes with bookmarked === true,
   sorted by title. Clicking an item re-centres the viewer on the node,
   selects it, and opens the side panel. The toggle itself lives in the
   side-panel metadata section (edit-node-modal). */

import { tr } from './i18n.js';

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
  if (kids) for (const k of kids) if (k) e.appendChild(k);
  return e;
}

export class BookmarksPanel {
  constructor(opts) {
    this.getNodes = opts.getNodes || (() => new Map());
    this.onPick = opts.onPick || (() => {});
    this._build();
    document.addEventListener('i18n:changed', () => this._retranslate());
    document.addEventListener('mousedown', (e) => {
      if (!this.menuEl) return;
      if (!this.menuEl.classList.contains('open')) return;
      if (this.menuEl.contains(e.target)) return;
      if (this.btnEl && this.btnEl.contains(e.target)) return;
      this._close();
    });
  }

  _build() {
    const btn = el('button', {
      id: 'btn-bookmarks-toggle',
      class: 'tb-icon-btn',
      type: 'button',
      title: tr('bookmarks_dropdown_title'),
      'aria-label': tr('bookmarks_button_aria'),
    });
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 4h12v17l-6-4-6 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggle();
    });
    const zoneRight = document.querySelector('#toolbar .tb-zone-right .tb-group-view');
    if (zoneRight) {
      const settingsBtn = zoneRight.querySelector('#btn-settings');
      if (settingsBtn) zoneRight.insertBefore(btn, settingsBtn);
      else zoneRight.appendChild(btn);
    } else {
      const root = document.querySelector('#toolbar .tb-zone-right');
      if (root) root.appendChild(btn);
    }
    this.btnEl = btn;

    const menu = el('div', { id: 'bookmarks-menu', class: 'bookmarks-menu' });
    document.body.appendChild(menu);
    this.menuEl = menu;
  }

  _toggle() {
    if (this.menuEl.classList.contains('open')) { this._close(); return; }
    this.refresh();
    const r = this.btnEl.getBoundingClientRect();
    this.menuEl.style.top = `${r.bottom + 4}px`;
    this.menuEl.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    this.menuEl.classList.add('open');
  }

  _close() { this.menuEl.classList.remove('open'); }

  refresh() {
    if (!this.menuEl) return;
    this.menuEl.innerHTML = '';
    const head = el('div', { class: 'bookmarks-menu-head', text: tr('bookmarks_dropdown_title') });
    this.menuEl.appendChild(head);
    const items = this._collect();
    if (!items.length) {
      const empty = el('div', { class: 'bookmarks-menu-empty', text: tr('bookmarks_empty') });
      this.menuEl.appendChild(empty);
      return;
    }
    const list = el('div', { class: 'bookmarks-menu-list' });
    for (const it of items) {
      const row = el('button', { type: 'button', class: 'bookmarks-menu-item' });
      const dot = el('span', { class: 'bookmarks-menu-dot' });
      if (it.color) dot.style.background = it.color;
      const label = el('span', { class: 'bookmarks-menu-label', text: it.title || it.slug || it.id });
      row.appendChild(dot);
      row.appendChild(label);
      row.addEventListener('click', () => {
        this._close();
        try { this.onPick(it.id); } catch (e) { void e; }
      });
      list.appendChild(row);
    }
    this.menuEl.appendChild(list);
  }

  _collect() {
    const nodes = this.getNodes() || new Map();
    const out = [];
    for (const n of nodes.values()) {
      if (!n || !n.bookmarked) continue;
      const title = (typeof n.label === 'string' && n.label)
        ? n.label
        : (typeof n.slug === 'string' && n.slug) ? n.slug : (n.id || '');
      out.push({ id: n.id, title, slug: n.slug || null, color: n.color ? null : null });
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  _retranslate() {
    if (this.btnEl) {
      this.btnEl.title = tr('bookmarks_dropdown_title');
      this.btnEl.setAttribute('aria-label', tr('bookmarks_button_aria'));
    }
    if (this.menuEl && this.menuEl.classList.contains('open')) this.refresh();
  }
}
