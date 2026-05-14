/* Second toolbar row, only visible when authed AND in editor mode. Three
   button groups: create mode (block/sticky/group), arrow routing default,
   selection actions (group/ungroup/delete), and undo/redo. Active button
   states persist in `arg.editorTools` localStorage entry. */

import { tr } from './i18n.js';

const STORAGE_KEY = 'arg.editorTools';

const CREATE_MODES = ['block', 'sticky', 'group'];
const ROUTINGS = ['straight', 'orthogonal', 'manhattan', 'smooth'];

const SVG_PATHS = {
  block:      '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/>',
  sticky:     '<path d="M4.5 4.5h12l3.5 3.5v11.5a0.5 0.5 0 0 1 -0.5 0.5H4.5a0.5 0.5 0 0 1 -0.5 -0.5v-15a0.5 0.5 0 0 1 0.5 -0.5z"/><path d="M16.5 4.5v3.5h3.5"/>',
  group:      '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" stroke-dasharray="3 2"/>',
  straight:   '<path d="M4 19 L20 5"/>',
  orthogonal: '<path d="M4 19 L4 12 L20 12 L20 5"/>',
  manhattan:  '<path d="M4 19 L4 15 L12 15 L12 9 L20 9 L20 5"/>',
  smooth:     '<path d="M4 19 C 10 19, 14 5, 20 5"/>',
  group_sel:  '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" stroke-dasharray="3 2"/><rect x="7" y="9" width="4" height="3"/><rect x="13" y="12" width="4" height="3"/>',
  ungroup:    '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" stroke-dasharray="3 2"/><path d="M7 9 L17 15"/><path d="M17 9 L7 15"/>',
  trash:      '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1 -13"/>',
  undo:       '<path d="M9 6L4 11l5 5"/><path d="M4 11h11a4 4 0 0 1 0 8H10"/>',
  redo:       '<path d="M15 6l5 5l-5 5"/><path d="M20 11H9a4 4 0 0 0 0 8h5"/>',
};

function svgIcon(name) {
  const svgNs = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(svgNs, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '16');
  s.setAttribute('height', '16');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = SVG_PATHS[name] || '';
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  } catch (e) { void e; }
  return null;
}

function persistState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { void e; }
}

export class EditorToolbar {
  constructor(opts) {
    this.handlers = opts.handlers || {};
    const stored = loadState();
    this.state = {
      create: (stored && CREATE_MODES.includes(stored.create)) ? stored.create : 'block',
      routing: (stored && ROUTINGS.includes(stored.routing)) ? stored.routing : 'orthogonal',
    };
    this._build();
    this._applyButtonStates();
    document.addEventListener('i18n:changed', () => this._retranslate());
  }

  _build() {
    const bar = document.createElement('div');
    bar.id = 'editor-toolbar';
    bar.className = 'editor-toolbar';

    const createGroup = this._makeGroup('create', [
      { value: 'block',  icon: 'block',  i18n: 'editor_tools_block'  },
      { value: 'sticky', icon: 'sticky', i18n: 'editor_tools_sticky' },
      { value: 'group',  icon: 'group',  i18n: 'editor_tools_group'  },
    ], (v) => this._setCreate(v));

    const arrowGroup = this._makeGroup('routing', [
      { value: 'straight',   icon: 'straight',   i18n: 'editor_tools_arrow_straight'   },
      { value: 'orthogonal', icon: 'orthogonal', i18n: 'editor_tools_arrow_orthogonal' },
      { value: 'manhattan',  icon: 'manhattan',  i18n: 'editor_tools_arrow_manhattan'  },
      { value: 'smooth',     icon: 'smooth',     i18n: 'editor_tools_arrow_smooth'     },
    ], (v) => this._setRouting(v));

    const selGroup = this._makeActionGroup([
      { id: 'group',     icon: 'group_sel', i18n: 'editor_tools_group_selection', handler: 'onGroupSelection' },
      { id: 'ungroup',   icon: 'ungroup',   i18n: 'editor_tools_ungroup',         handler: 'onUngroup'        },
      { id: 'delete',    icon: 'trash',     i18n: 'editor_tools_delete',          handler: 'onDeleteSelection', danger: true },
    ]);

    const histGroup = this._makeActionGroup([
      { id: 'undo', icon: 'undo', i18n: 'editor_tools_undo', handler: 'onUndo' },
      { id: 'redo', icon: 'redo', i18n: 'editor_tools_redo', handler: 'onRedo' },
    ]);

    bar.appendChild(createGroup);
    bar.appendChild(arrowGroup);
    bar.appendChild(selGroup);
    bar.appendChild(histGroup);
    document.body.appendChild(bar);
    this.barEl = bar;
  }

  _makeGroup(kind, items, onPick) {
    const wrap = document.createElement('div');
    wrap.className = 'et-group';
    const buttons = [];
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'et-btn';
      b.dataset.kind = kind;
      b.dataset.value = it.value;
      b.dataset.i18n = it.i18n;
      b.title = tr(it.i18n);
      b.setAttribute('aria-label', tr(it.i18n));
      b.appendChild(svgIcon(it.icon));
      b.addEventListener('click', () => onPick(it.value));
      wrap.appendChild(b);
      buttons.push(b);
    }
    return wrap;
  }

  _makeActionGroup(items) {
    const wrap = document.createElement('div');
    wrap.className = 'et-group';
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'et-btn';
      if (it.danger) b.classList.add('danger');
      b.dataset.action = it.id;
      b.dataset.i18n = it.i18n;
      b.title = tr(it.i18n);
      b.setAttribute('aria-label', tr(it.i18n));
      b.appendChild(svgIcon(it.icon));
      b.addEventListener('click', () => {
        const fn = this.handlers[it.handler];
        if (typeof fn === 'function') fn();
      });
      wrap.appendChild(b);
    }
    return wrap;
  }

  _setCreate(v) {
    if (!CREATE_MODES.includes(v)) return;
    this.state.create = v;
    persistState(this.state);
    this._applyButtonStates();
    if (typeof this.handlers.onCreateModeChange === 'function') {
      this.handlers.onCreateModeChange(v);
    }
  }

  _setRouting(v) {
    if (!ROUTINGS.includes(v)) return;
    this.state.routing = v;
    persistState(this.state);
    this._applyButtonStates();
    if (typeof this.handlers.onRoutingChange === 'function') {
      this.handlers.onRoutingChange(v);
    }
  }

  _applyButtonStates() {
    this.barEl.querySelectorAll('button.et-btn[data-kind]').forEach((b) => {
      const isActive = (b.dataset.kind === 'create' && b.dataset.value === this.state.create)
                    || (b.dataset.kind === 'routing' && b.dataset.value === this.state.routing);
      b.classList.toggle('active', isActive);
    });
  }

  _retranslate() {
    this.barEl.querySelectorAll('button[data-i18n]').forEach((b) => {
      const key = b.dataset.i18n;
      b.title = tr(key);
      b.setAttribute('aria-label', tr(key));
    });
  }

  getCreateMode() { return this.state.create; }
  getRouting() { return this.state.routing; }
}
