/* Outline panel. Tree-style index of nodes loaded from data/outline.json,
   persisted to localStorage on edit. Click flies to node; hover highlights;
   drag reorders; Tab/Shift+Tab on a focused row changes depth. New items can
   be added per node via context menu or the panel's plus button. */

import { tr } from './i18n.js';
import { findNode, toViewShape, isPuzzleNode, nodeTitle } from './nodes.js';

const STORAGE_KEY = 'arg_map_outline';
const OPEN_KEY    = 'arg_map_outline_open';
const URL = 'data/outline.json';
const MAX_DEPTH = 6;

export class OutlinePanel {
  constructor(opts) {
    this.container = opts.container || document.body;
    this.getNodes = opts.getNodes;
    this.onFlyTo = opts.onFlyTo || (() => {});
    this.onHighlight = opts.onHighlight || (() => {});
    this.onScheduleSave = opts.onScheduleSave || (() => {});

    this.items = [];
    this.dirty = false;
    this._dragState = null;

    this._build();
    this._wireEvents();

    if (this._loadOpenState()) this.open();
  }

  async loadInitial() {
    const local = this._loadFromStorage();
    if (local) {
      this.items = local;
    } else {
      try {
        const res = await fetch(URL, { cache: 'no-cache' });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.items)) {
            this.items = data.items.map(this._normaliseItem);
          }
        }
      } catch (e) {
        void e;
      }
    }
    if (!Array.isArray(this.items)) this.items = [];
    this.render();
  }

  _normaliseItem(it) {
    return {
      title: typeof it.title === 'string' ? it.title : '',
      nodeId: typeof it.nodeId === 'string' ? it.nodeId : '',
      depth: typeof it.depth === 'number' ? Math.max(0, Math.min(MAX_DEPTH, it.depth | 0)) : 0,
      note: typeof it.note === 'string' ? it.note : '',
    };
  }

  _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return data.map(this._normaliseItem);
      return null;
    } catch (e) {
      return null;
    }
  }

  _saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch (e) {
      void e;
    }
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'outline-panel';
    root.className = 'outline-panel closed';
    root.innerHTML = `
      <div class="outline-header">
        <span class="outline-title">${tr('outline_toggle')}</span>
        <div class="outline-actions">
          <button class="outline-add" type="button" title="${tr('outline_add_row')}">+</button>
          <button class="outline-close" type="button" aria-label="${tr('shortcut_close')}">&times;</button>
        </div>
      </div>
      <div class="outline-body"></div>
    `;
    this.container.appendChild(root);
    this.rootEl = root;
    this.bodyEl = root.querySelector('.outline-body');
    this.addBtn = root.querySelector('.outline-add');
    this.closeBtn = root.querySelector('.outline-close');
  }

  _wireEvents() {
    this.closeBtn.addEventListener('click', () => this.close());
    this.addBtn.addEventListener('click', () => this._addRowPlaceholder());
  }

  render() {
    this.bodyEl.innerHTML = '';
    if (!this.items.length) {
      const empty = document.createElement('div');
      empty.className = 'outline-empty';
      empty.textContent = tr('outline_empty');
      this.bodyEl.appendChild(empty);
      return;
    }
    for (let i = 0; i < this.items.length; i++) {
      const row = this._renderRow(this.items[i], i);
      this.bodyEl.appendChild(row);
    }
  }

  _renderRow(item, index) {
    const row = document.createElement('div');
    row.className = 'outline-row';
    row.dataset.index = String(index);
    row.tabIndex = 0;
    row.style.paddingLeft = `${8 + item.depth * 12}px`;
    if (!item.nodeId || !this._nodeExists(item.nodeId)) row.classList.add('dangling');

    const label = document.createElement('span');
    label.className = 'outline-label';
    const node = this._nodeFor(item.nodeId);
    label.textContent = item.title || (node ? this._titleFromNode(node) : item.nodeId || '(empty)');
    row.appendChild(label);

    const note = document.createElement('span');
    note.className = 'outline-note';
    note.textContent = item.note || '';
    row.appendChild(note);

    const minus = document.createElement('button');
    minus.className = 'outline-row-remove';
    minus.textContent = '–';
    minus.title = tr('outline_remove_row');
    minus.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this._removeRow(index);
    });
    row.appendChild(minus);

    row.addEventListener('click', () => {
      const n = this._nodeFor(item.nodeId);
      if (n) this.onFlyTo(item.nodeId, toViewShape(n));
    });
    row.addEventListener('mouseenter', () => {
      this.onHighlight(item.nodeId || null);
    });
    row.addEventListener('mouseleave', () => {
      this.onHighlight(null);
    });
    row.addEventListener('keydown', (ev) => {
      if (ev.key === 'Tab') {
        ev.preventDefault();
        this._setDepth(index, item.depth + (ev.shiftKey ? -1 : 1));
        const r = this.bodyEl.querySelector(`.outline-row[data-index="${index}"]`);
        if (r) r.focus();
        return;
      }
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        this._removeRow(index);
      }
    });
    row.draggable = true;
    row.addEventListener('dragstart', (ev) => {
      this._dragState = { index };
      ev.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      this._dragState = null;
    });
    row.addEventListener('dragover', (ev) => {
      if (!this._dragState) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-target');
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-target');
    });
    row.addEventListener('drop', (ev) => {
      ev.preventDefault();
      row.classList.remove('drag-target');
      if (!this._dragState) return;
      const from = this._dragState.index;
      const to = index;
      if (from === to) return;
      this._moveRow(from, to);
    });
    return row;
  }

  _nodeFor(id) {
    if (!id) return null;
    const nodes = this.getNodes();
    return findNode(nodes, id);
  }

  _nodeExists(id) {
    return !!this._nodeFor(id);
  }

  _titleFromNode(node) {
    return nodeTitle(node);
  }

  _setDepth(index, depth) {
    if (!this.items[index]) return;
    const d = Math.max(0, Math.min(MAX_DEPTH, depth));
    if (this.items[index].depth === d) return;
    this.items[index].depth = d;
    this._persist();
    this.render();
  }

  _moveRow(from, to) {
    if (from < 0 || from >= this.items.length) return;
    if (to < 0 || to >= this.items.length) return;
    const [item] = this.items.splice(from, 1);
    this.items.splice(to, 0, item);
    this._persist();
    this.render();
  }

  _removeRow(index) {
    if (!this.items[index]) return;
    this.items.splice(index, 1);
    this._persist();
    this.render();
  }

  _addRowPlaceholder() {
    this.items.push({ title: '', nodeId: '', depth: 0, note: '' });
    this._persist();
    this.render();
  }

  addNodeAtEnd(nodeId, depth) {
    const node = this._nodeFor(nodeId);
    if (!node) return;
    const title = isPuzzleNode(node) ? this._titleFromNode(node) : node.id;
    this.items.push({
      title,
      nodeId,
      depth: Math.max(0, depth || 0),
      note: '',
    });
    this._persist();
    this.render();
    this.open();
  }

  removeByNodeId(nodeId) {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.nodeId !== nodeId);
    if (this.items.length !== before) {
      this._persist();
      this.render();
    }
  }

  hasNode(nodeId) {
    return this.items.some((i) => i.nodeId === nodeId);
  }

  _persist() {
    this.dirty = true;
    this._saveToStorage();
    this.onScheduleSave();
  }

  open() {
    this.rootEl.classList.remove('closed');
    this.rootEl.classList.add('open');
    document.body.classList.add('outline-open');
    this._saveOpenState(true);
  }

  close() {
    this.rootEl.classList.remove('open');
    this.rootEl.classList.add('closed');
    document.body.classList.remove('outline-open');
    this._saveOpenState(false);
  }

  toggle() {
    if (this.isOpen()) this.close();
    else this.open();
  }

  isOpen() { return this.rootEl.classList.contains('open'); }
  getItems() { return this.items.map((i) => ({ ...i })); }
  serialize() { return { items: this.getItems() }; }

  retranslate() {
    const t = this.rootEl.querySelector('.outline-title');
    if (t) t.textContent = tr('outline_toggle');
    const add = this.rootEl.querySelector('.outline-add');
    if (add) add.title = tr('outline_add_row');
    const close = this.rootEl.querySelector('.outline-close');
    if (close) close.setAttribute('aria-label', tr('shortcut_close'));
    this.render();
  }

  _loadOpenState() {
    try { return localStorage.getItem(OPEN_KEY) === '1'; }
    catch (e) { return false; }
  }

  _saveOpenState(open) {
    try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); }
    catch (e) { void e; }
  }
}
