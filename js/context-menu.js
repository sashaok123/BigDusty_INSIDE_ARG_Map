/* Global right-click context menu. Replaces the browser's native menu when
   the click lands on our surfaces (canvas, viewport, side panel, nodes). The
   item list is supplied by the caller per click, so context (single node /
   multi-selection / empty canvas / group / file-image) decides what's shown.
   Surfaces that should never expose the native context menu are tagged via
   the OWNED_SURFACES selector and the global capture-phase listener.       */

import { tr } from './i18n.js';

export const OWNED_SURFACES = [
  '#viewport',
  '#left-rail',
  '#toolbar',
  '#tb-overflow-menu',
  '#panel',
  '#minimap',
  '#edit-node-modal',
  '#editor-modal',
  '#confirm-modal',
  '#auth-login-modal',
  '#auth-changepw-modal',
  '#auth-users-modal',
  '#auth-setup-modal',
  '#auth-settings-modal',
  '#auth-user-menu',
  '#zoom-controls',
  '#hotspot-tooltip',
  '#selection-status',
  '#offline-banner',
  '#migration-banner',
  '#search-results',
  '.crop-overlay',
  '.ctx-menu',
  '.video-dialog',
  '.align-floater',
  '.comments-panel',
  '.comment-pin',
].join(',');

export function isInOwnedSurface(el) {
  if (!el || !el.closest) return false;
  return !!el.closest(OWNED_SURFACES);
}

export class ContextMenu {
  constructor(opts) {
    const o = opts || {};
    this.container = o.container || document.body;
    this.el = null;
    this.submenuEl = null;
    this.openSince = 0;
    this._onDocMouseDown = this._onDocMouseDown.bind(this);
    this._onDocKey = this._onDocKey.bind(this);
    this._onBlur = this._onBlur.bind(this);
    document.addEventListener('mousedown', this._onDocMouseDown, true);
    document.addEventListener('keydown', this._onDocKey, true);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('i18n:changed', () => { if (this.isOpen()) this.close(); });
  }

  isOpen() { return !!this.el; }

  open(x, y, items) {
    this.close();
    if (!Array.isArray(items) || !items.length) return;
    const el = document.createElement('ul');
    el.className = 'ctx-menu';
    el.setAttribute('role', 'menu');
    for (const it of items) this._renderItem(el, it);
    this.container.appendChild(el);
    this.el = el;
    const margin = 6;
    let px = x;
    let py = y;
    const r = el.getBoundingClientRect();
    if (px + r.width > window.innerWidth - margin) px = Math.max(margin, window.innerWidth - r.width - margin);
    if (py + r.height > window.innerHeight - margin) py = Math.max(margin, window.innerHeight - r.height - margin);
    el.style.left = `${px}px`;
    el.style.top = `${py}px`;
    this.openSince = Date.now();
  }

  close() {
    if (this.submenuEl && this.submenuEl.parentNode) this.submenuEl.parentNode.removeChild(this.submenuEl);
    this.submenuEl = null;
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
  }

  _renderItem(parent, it) {
    if (it === null || it === undefined) return;
    if (it === '---' || it === '-' || it.kind === 'separator') {
      const sep = document.createElement('li');
      sep.className = 'ctx-sep';
      parent.appendChild(sep);
      return;
    }
    const li = document.createElement('li');
    li.className = 'ctx-item';
    if (it.danger) li.classList.add('danger');
    if (it.disabled) li.classList.add('disabled');
    if (it.icon) {
      const ic = document.createElement('span');
      ic.className = 'ctx-icon';
      ic.innerHTML = it.icon;
      li.appendChild(ic);
    }
    const label = document.createElement('span');
    label.className = 'ctx-label';
    label.textContent = it.label || '';
    li.appendChild(label);
    if (Array.isArray(it.submenu) && it.submenu.length) {
      li.classList.add('has-submenu');
      const arrow = document.createElement('span');
      arrow.className = 'ctx-submenu-arrow';
      arrow.textContent = '▸';
      li.appendChild(arrow);
      li.addEventListener('mouseenter', () => this._openSubmenu(li, it.submenu));
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openSubmenu(li, it.submenu);
      });
    } else if (!it.disabled) {
      li.tabIndex = 0;
      li.addEventListener('mouseenter', () => this._closeSubmenu());
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close();
        if (typeof it.fn === 'function') {
          try { it.fn(); } catch (err) { console.warn('[context-menu] action failed', err); }
        }
      });
    } else {
      li.addEventListener('mouseenter', () => this._closeSubmenu());
    }
    parent.appendChild(li);
  }

  _closeSubmenu() {
    if (this.submenuEl && this.submenuEl.parentNode) this.submenuEl.parentNode.removeChild(this.submenuEl);
    this.submenuEl = null;
  }

  _openSubmenu(li, items) {
    this._closeSubmenu();
    if (!Array.isArray(items) || !items.length) return;
    const sub = document.createElement('ul');
    sub.className = 'ctx-menu ctx-submenu';
    for (const it of items) this._renderItem(sub, it);
    this.container.appendChild(sub);
    this.submenuEl = sub;
    const r = li.getBoundingClientRect();
    const sr = sub.getBoundingClientRect();
    let x = r.right - 4;
    let y = r.top;
    if (x + sr.width > window.innerWidth - 6) x = Math.max(6, r.left - sr.width + 4);
    if (y + sr.height > window.innerHeight - 6) y = Math.max(6, window.innerHeight - sr.height - 6);
    sub.style.left = `${x}px`;
    sub.style.top = `${y}px`;
  }

  _onDocMouseDown(e) {
    if (!this.el) return;
    if (Date.now() - this.openSince < 80) return;
    if (this.el.contains(e.target)) return;
    if (this.submenuEl && this.submenuEl.contains(e.target)) return;
    this.close();
  }

  _onDocKey(e) {
    if (this.el && e.key === 'Escape') { e.preventDefault(); this.close(); }
  }

  _onBlur() { this.close(); }
}

export function statusSubmenu(currentStatus, onPick) {
  const items = [];
  const list = [
    ['solved',   'status_solved'],
    ['partial',  'status_partial'],
    ['unsolved', 'status_unsolved'],
    ['no-data',  'status_nodata'],
    ['dead-end', 'status_dead_end'],
  ];
  for (const [id, k] of list) {
    items.push({
      label: tr(k) + (id === currentStatus ? '  ✓' : ''),
      fn: () => onPick(id),
    });
  }
  return items;
}
