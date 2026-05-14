/* Global keyboard handler. Skips when focus is inside an input, textarea, or
   contenteditable. Owns the shortcut overlay (the `?` help screen). The
   actions themselves live in the host (app.js) and are passed in as
   callbacks. */

import { tr } from './i18n.js';

export class KeyboardShortcuts {
  constructor(opts) {
    this.handlers = opts.handlers || {};
    this.overlayContainer = opts.overlayContainer || document.body;
    this._buildOverlay();
    this._install();
  }

  _install() {
    document.addEventListener('keydown', (ev) => this._onKey(ev));
  }

  _shouldSkip(ev) {
    const t = ev.target;
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (t.isContentEditable) return true;
    return false;
  }

  _onKey(ev) {
    const overlayOpen = this.overlayEl.classList.contains('open');
    if (ev.key === 'Escape') {
      if (overlayOpen) {
        ev.preventDefault();
        this.hideOverlay();
        return;
      }
      this._call('onEscape', ev);
      return;
    }
    if (this._shouldSkip(ev)) return;
    const meta = ev.metaKey || ev.ctrlKey;
    const k = ev.key;
    if (meta && (k === 'k' || k === 'K')) {
      ev.preventDefault();
      this._call('onCommandPalette', ev);
      return;
    }
    if (k === '?') {
      ev.preventDefault();
      this.showOverlay();
      return;
    }
    if (meta && (k === 'z' || k === 'Z') && ev.shiftKey) {
      ev.preventDefault();
      this._call('onRedo', ev);
      return;
    }
    if (meta && (k === 'z' || k === 'Z')) {
      ev.preventDefault();
      this._call('onUndo', ev);
      return;
    }
    if (meta && (k === 'y' || k === 'Y')) {
      ev.preventDefault();
      this._call('onRedo', ev);
      return;
    }
    if (meta && (k === 'g' || k === 'G')) {
      ev.preventDefault();
      if (ev.shiftKey) this._call('onUngroupSelection', ev);
      else this._call('onGroupSelection', ev);
      return;
    }
    if (meta && (k === 'c' || k === 'C')) {
      ev.preventDefault();
      this._call('onCopy', ev);
      return;
    }
    if (meta && (k === 'v' || k === 'V')) {
      ev.preventDefault();
      this._call('onPaste', ev);
      return;
    }
    if (meta && (k === 'd' || k === 'D')) {
      ev.preventDefault();
      this._call('onDuplicate', ev);
      return;
    }
    if (k === 'm' || k === 'M') {
      if (meta) return;
      ev.preventDefault();
      this._call('onMinimapToggle', ev);
      return;
    }
    if (k === 'o' || k === 'O') {
      if (meta) return;
      ev.preventDefault();
      this._call('onOutlineToggle', ev);
      return;
    }
    if (k === 'f' || k === 'F') {
      if (meta) return;
      ev.preventDefault();
      this._call('onFilterCycle', ev);
      return;
    }
    if (k === 'e' || k === 'E') {
      if (meta) return;
      ev.preventDefault();
      this._call('onModeToggle', ev);
      return;
    }
    if (k === 'Tab') {
      if (this._call('onCreateChild', ev)) ev.preventDefault();
      return;
    }
    if (k === 'Enter') {
      if (this._call('onCreateSibling', ev)) ev.preventDefault();
      return;
    }
    if (k === 'Delete' || k === 'Backspace') {
      if (this._call('onDeleteSelected', ev)) ev.preventDefault();
      return;
    }
    if (k === '+' || k === '=') {
      ev.preventDefault();
      this._call('onZoomIn', ev);
      return;
    }
    if (k === '-' || k === '_') {
      ev.preventDefault();
      this._call('onZoomOut', ev);
      return;
    }
    if (k === '0') {
      ev.preventDefault();
      this._call('onZoomReset', ev);
      return;
    }
    const numMap = { '1': 'solved', '2': 'partial', '3': 'unsolved', '4': 'dead-end', '5': 'no-data' };
    if (numMap[k]) {
      if (this._call('onSetStatus', { status: numMap[k] })) ev.preventDefault();
    }
  }

  _call(name, payload) {
    const fn = this.handlers[name];
    if (typeof fn !== 'function') return false;
    try {
      const r = fn(payload);
      return r !== false;
    } catch (e) {
      console.warn('[keyboard]', name, e);
      return false;
    }
  }

  _buildOverlay() {
    const el = document.createElement('div');
    el.id = 'shortcut-overlay';
    el.innerHTML = `<div id="shortcut-overlay-box"></div>`;
    this.overlayContainer.appendChild(el);
    this.overlayEl = el;
    this.boxEl = el.querySelector('#shortcut-overlay-box');
    el.addEventListener('click', (ev) => {
      if (ev.target === el) this.hideOverlay();
    });
  }

  showOverlay() {
    this._renderOverlay();
    this.overlayEl.classList.add('open');
  }

  hideOverlay() {
    this.overlayEl.classList.remove('open');
  }

  toggleOverlay() {
    if (this.overlayEl.classList.contains('open')) this.hideOverlay();
    else this.showOverlay();
  }

  retranslate() {
    if (this.overlayEl.classList.contains('open')) this._renderOverlay();
  }

  _renderOverlay() {
    const sections = [
      { titleKey: 'shortcut_section_general', rows: [
        { keys: ['Ctrl', 'K'],   descKey: 'shortcut_desc_search' },
        { keys: ['?'],           descKey: 'shortcut_desc_shortcuts' },
        { keys: ['Esc'],         descKey: 'shortcut_desc_escape' },
      ]},
      { titleKey: 'shortcut_section_navigation', rows: [
        { keys: ['M'],           descKey: 'shortcut_desc_minimap' },
        { keys: ['O'],           descKey: 'shortcut_desc_outline' },
        { keys: ['+', '-', '0'], descKey: 'shortcut_desc_zoom' },
        { keys: ['E'],           descKey: 'shortcut_desc_mode' },
      ]},
      { titleKey: 'shortcut_section_editing', rows: [
        { keys: ['Tab'],         descKey: 'shortcut_desc_child' },
        { keys: ['Enter'],       descKey: 'shortcut_desc_sibling' },
        { keys: ['Del'],         descKey: 'shortcut_desc_delete' },
        { keys: ['Ctrl', 'C'],   descKey: 'shortcut_desc_copy' },
        { keys: ['Ctrl', 'V'],   descKey: 'shortcut_desc_paste' },
        { keys: ['Ctrl', 'D'],   descKey: 'shortcut_desc_duplicate' },
        { keys: ['Ctrl', 'Z'],   descKey: 'shortcut_desc_undo' },
        { keys: ['Ctrl', 'Shift', 'Z'], descKey: 'shortcut_desc_redo' },
      ]},
      { titleKey: 'shortcut_section_filters', rows: [
        { keys: ['F'],           descKey: 'shortcut_desc_filter_cycle' },
        { keys: ['1..5'],        descKey: 'shortcut_desc_status_set' },
      ]},
    ];

    let html = `<h2>${tr('shortcut_overlay_title')}</h2>`;
    for (const sec of sections) {
      html += `<div class="shortcut-section"><h3>${tr(sec.titleKey)}</h3>`;
      for (const row of sec.rows) {
        const keys = row.keys.map((k) => `<kbd>${k}</kbd>`).join(' ');
        html += `<div class="shortcut-line"><span>${tr(row.descKey)}</span><span class="shortcut-keys">${keys}</span></div>`;
      }
      html += `</div>`;
    }
    html += `<button class="shortcut-close" type="button">${tr('shortcut_close')}</button>`;
    this.boxEl.innerHTML = html;
    const closeBtn = this.boxEl.querySelector('.shortcut-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hideOverlay());
  }
}
