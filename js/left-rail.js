/* Left-side primary navigation rail. 60-px fixed column with grouped icon
   buttons: app logo, Modes (Browse/Edit), Tools (only in editor mode and
   when authed: Block / Sticky / Group / Text / Image upload / Arrow style),
   View (Search focus / Outline / Minimap / Theme cycler / Language picker),
   bottom: Sign in / user chip. Replaces the old editor-toolbar second row. */

import { tr } from './i18n.js';

const STORAGE_KEY = 'arg.editorTools';
const CREATE_MODES = ['block', 'sticky', 'group', 'text'];
const ROUTINGS = ['straight', 'orthogonal', 'manhattan', 'smooth'];
const VIDEO_ICON = '<rect x="3.5" y="6.5" width="13" height="11" rx="1.5"/><path d="M16.5 10 L21 7.5 L21 16.5 L16.5 14 Z"/>';

const SVG_PATHS = {
  browse:     '<circle cx="11" cy="11" r="7"/><path d="M16.2 16.2L21 21"/>',
  edit:       '<path d="M14 4l6 6L9 21H3v-6L14 4z"/><path d="M13 5l6 6"/>',
  block:      '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/>',
  sticky:     '<path d="M4.5 4.5h12l3.5 3.5v11.5a0.5 0.5 0 0 1 -0.5 0.5H4.5a0.5 0.5 0 0 1 -0.5 -0.5v-15a0.5 0.5 0 0 1 0.5 -0.5z"/><path d="M16.5 4.5v3.5h3.5"/>',
  group:      '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" stroke-dasharray="3 2"/>',
  text:       '<path d="M5 6h14"/><path d="M12 6v14"/><path d="M9 20h6"/>',
  image_add:  '<rect x="3.5" y="4.5" width="13" height="13" rx="1.5"/><path d="M3.5 14L7 11l3 3l3-3l3 3"/><circle cx="13" cy="8.5" r="1.4"/><path d="M18 17v4M16 19h4"/>',
  arrow:      '<path d="M4 12h14"/><path d="M13 7l5 5l-5 5"/>',
  straight:   '<path d="M4 19 L20 5"/>',
  orthogonal: '<path d="M4 19 L4 12 L20 12 L20 5"/>',
  manhattan:  '<path d="M4 19 L4 15 L12 15 L12 9 L20 9 L20 5"/>',
  smooth:     '<path d="M4 19 C 10 19, 14 5, 20 5"/>',
  group_sel:  '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" stroke-dasharray="3 2"/><rect x="7" y="9" width="4" height="3"/><rect x="13" y="12" width="4" height="3"/>',
  ungroup:    '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" stroke-dasharray="3 2"/><path d="M7 9 L17 15"/><path d="M17 9 L7 15"/>',
  trash:      '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1 -13"/>',
  undo:       '<path d="M9 6L4 11l5 5"/><path d="M4 11h11a4 4 0 0 1 0 8H10"/>',
  redo:       '<path d="M15 6l5 5l-5 5"/><path d="M20 11H9a4 4 0 0 0 0 8h5"/>',
  search:     '<circle cx="11" cy="11" r="7"/><path d="M16.2 16.2L21 21"/>',
  outline:    '<path d="M5 6h14"/><path d="M5 12h14"/><path d="M5 18h14"/>',
  minimap:    '<rect x="3.5" y="3.5" width="17" height="13" rx="1.5"/><rect x="6.5" y="6.5" width="6" height="4"/>',
  theme_sun:  '<circle cx="12" cy="12" r="4.2"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"/>',
  theme_moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  theme_graphite: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16"/>',
  theme_auto: '<rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/>',
  lang:       '<path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/><circle cx="12" cy="12" r="9"/>',
  signin:     '<path d="M10 17l5-5l-5-5"/><path d="M15 12H3"/><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/>',
  video:      VIDEO_ICON,
  align:      '<path d="M3 5h18"/><path d="M3 9h12"/><path d="M3 13h18"/><path d="M3 17h9"/>',
  comment:    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
};

function svgIcon(name, size) {
  const svgNs = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(svgNs, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  const dim = size || '20';
  s.setAttribute('width', dim);
  s.setAttribute('height', dim);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = SVG_PATHS[name] || '';
  return s;
}

function loadToolState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object') return obj;
  } catch (e) { void e; }
  return null;
}

function persistToolState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { void e; }
}

export class LeftRail {
  constructor(opts) {
    this.handlers = opts.handlers || {};
    const stored = loadToolState();
    this.state = {
      create:  (stored && CREATE_MODES.includes(stored.create))  ? stored.create  : 'block',
      routing: (stored && ROUTINGS.includes(stored.routing))     ? stored.routing : 'orthogonal',
    };
    this._buttons = {};
    this._build();
    this._applyButtonStates();
    document.addEventListener('i18n:changed', () => this._retranslate());
  }

  _build() {
    const rail = document.createElement('div');
    rail.id = 'left-rail';
    rail.className = 'left-rail';

    const top = this._makeSection('rail-top');
    const logo = document.createElement('div');
    logo.className = 'rail-logo';
    logo.textContent = 'INSIDE';
    top.appendChild(logo);
    rail.appendChild(top);

    const modes = this._makeSection('rail-modes');
    modes.appendChild(this._makeIconBtn({
      id: 'rail-mode-viewer', icon: 'browse', i18n: 'mode_viewer',
      onClick: () => this.handlers.onModeChange && this.handlers.onModeChange('viewer'),
    }));
    modes.appendChild(this._makeIconBtn({
      id: 'rail-mode-editor', icon: 'edit', i18n: 'mode_editor',
      onClick: () => this.handlers.onModeChange && this.handlers.onModeChange('editor'),
    }));
    rail.appendChild(modes);

    const tools = this._makeSection('rail-tools');
    tools.appendChild(this._makeIconBtn({
      id: 'rail-tool-block', icon: 'block', i18n: 'editor_tools_block',
      onClick: () => this._setCreate('block'),
    }));
    tools.appendChild(this._makeIconBtn({
      id: 'rail-tool-sticky', icon: 'sticky', i18n: 'editor_tools_sticky',
      onClick: () => this._setCreate('sticky'),
    }));
    tools.appendChild(this._makeIconBtn({
      id: 'rail-tool-group', icon: 'group', i18n: 'editor_tools_group',
      onClick: () => this._setCreate('group'),
    }));
    tools.appendChild(this._makeIconBtn({
      id: 'rail-tool-text', icon: 'text', i18n: 'tool_add_text',
      onClick: () => this._setCreate('text'),
    }));
    tools.appendChild(this._makeIconBtn({
      id: 'rail-tool-upload', icon: 'image_add', i18n: 'upload_image_button',
      onClick: () => this.handlers.onUploadImage && this.handlers.onUploadImage(),
    }));
    tools.appendChild(this._makeIconBtn({
      id: 'rail-tool-video', icon: 'video', i18n: 'tool_add_video',
      onClick: () => this.handlers.onAddVideo && this.handlers.onAddVideo(),
    }));
    tools.appendChild(this._makeIconBtn({
      id: 'rail-tool-comment', icon: 'comment', i18n: 'tool_add_comment',
      onClick: () => this.handlers.onAddComment && this.handlers.onAddComment(),
    }));
    tools.appendChild(this._makeArrowSubmenu());
    tools.appendChild(this._makeIconBtn({
      id: 'rail-tool-group-sel', icon: 'group_sel', i18n: 'editor_tools_group_selection',
      onClick: () => this.handlers.onGroupSelection && this.handlers.onGroupSelection(),
    }));
    tools.appendChild(this._makeIconBtn({
      id: 'rail-tool-ungroup', icon: 'ungroup', i18n: 'editor_tools_ungroup',
      onClick: () => this.handlers.onUngroup && this.handlers.onUngroup(),
    }));
    tools.appendChild(this._makeIconBtn({
      id: 'rail-tool-delete', icon: 'trash', i18n: 'editor_tools_delete',
      danger: true,
      onClick: () => this.handlers.onDeleteSelection && this.handlers.onDeleteSelection(),
    }));
    const sep = document.createElement('div');
    sep.className = 'rail-separator';
    tools.appendChild(sep);
    tools.appendChild(this._makeIconBtn({
      id: 'rail-tool-undo', icon: 'undo', i18n: 'editor_tools_undo',
      onClick: () => this.handlers.onUndo && this.handlers.onUndo(),
    }));
    tools.appendChild(this._makeIconBtn({
      id: 'rail-tool-redo', icon: 'redo', i18n: 'editor_tools_redo',
      onClick: () => this.handlers.onRedo && this.handlers.onRedo(),
    }));
    rail.appendChild(tools);
    this.toolsEl = tools;

    document.body.appendChild(rail);
    this.railEl = rail;
  }

  _makeSection(cls) {
    const s = document.createElement('div');
    s.className = `rail-section ${cls}`;
    return s;
  }

  _makeIconBtn(opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = opts.id;
    b.className = 'rail-btn';
    if (opts.danger) b.classList.add('danger');
    b.dataset.i18n = opts.i18n;
    b.title = tr(opts.i18n);
    b.setAttribute('aria-label', tr(opts.i18n));
    b.appendChild(svgIcon(opts.icon));
    b.addEventListener('click', (e) => { e.preventDefault(); opts.onClick && opts.onClick(); });
    this._buttons[opts.id] = b;
    return b;
  }

  _makeArrowSubmenu() {
    const wrap = document.createElement('div');
    wrap.className = 'rail-submenu-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rail-btn rail-submenu-trigger';
    btn.dataset.i18n = 'rail_arrow_style';
    btn.title = tr('rail_arrow_style');
    btn.setAttribute('aria-label', tr('rail_arrow_style'));
    btn.appendChild(svgIcon(this.state.routing));
    this._buttons['rail-tool-arrow'] = btn;
    btn.dataset.routing = this.state.routing;
    const flyout = document.createElement('div');
    flyout.className = 'rail-flyout';
    for (const r of ROUTINGS) {
      const ob = document.createElement('button');
      ob.type = 'button';
      ob.className = 'rail-btn';
      ob.title = tr(`editor_tools_arrow_${r}`);
      ob.dataset.i18n = `editor_tools_arrow_${r}`;
      ob.appendChild(svgIcon(r));
      ob.addEventListener('click', (e) => {
        e.preventDefault();
        this._setRouting(r);
        flyout.classList.remove('open');
      });
      flyout.appendChild(ob);
    }
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      flyout.classList.toggle('open');
    });
    document.addEventListener('mousedown', (e) => {
      if (!wrap.contains(e.target)) flyout.classList.remove('open');
    });
    wrap.appendChild(btn);
    wrap.appendChild(flyout);
    return wrap;
  }

  _setCreate(v) {
    if (!CREATE_MODES.includes(v)) return;
    this.state.create = v;
    persistToolState(this.state);
    this._applyButtonStates();
    if (this.handlers.onCreateModeChange) this.handlers.onCreateModeChange(v);
  }

  _setRouting(v) {
    if (!ROUTINGS.includes(v)) return;
    this.state.routing = v;
    persistToolState(this.state);
    const trigger = this._buttons['rail-tool-arrow'];
    if (trigger) {
      while (trigger.firstChild) trigger.removeChild(trigger.firstChild);
      trigger.appendChild(svgIcon(v));
    }
    if (this.handlers.onRoutingChange) this.handlers.onRoutingChange(v);
  }

  _applyButtonStates() {
    const map = [
      ['block',  'rail-tool-block'],
      ['sticky', 'rail-tool-sticky'],
      ['group',  'rail-tool-group'],
      ['text',   'rail-tool-text'],
    ];
    for (const [k, id] of map) {
      const b = this._buttons[id];
      if (b) b.classList.toggle('active', this.state.create === k);
    }
  }

  setActiveMode(mode) {
    const v = this._buttons['rail-mode-viewer'];
    const e = this._buttons['rail-mode-editor'];
    if (v) v.classList.toggle('active', mode === 'viewer');
    if (e) e.classList.toggle('active', mode === 'editor');
  }

  setThemeChoice(choice) { void choice; }

  setLang(lang) { void lang; }

  setAuthState(authed, isAdmin) {
    if (this.railEl) {
      this.railEl.classList.toggle('authed', !!authed);
      this.railEl.classList.toggle('admin', !!isAdmin);
    }
  }

  getCreateMode() { return this.state.create; }
  getRouting() { return this.state.routing; }

  _retranslate() {
    if (!this.railEl) return;
    this.railEl.querySelectorAll('button[data-i18n]').forEach((b) => {
      const key = b.dataset.i18n;
      const text = tr(key);
      b.title = text;
      b.setAttribute('aria-label', text);
    });
  }
}
