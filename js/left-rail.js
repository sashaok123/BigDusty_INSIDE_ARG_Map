/* Left-side primary navigation rail. Labelled by default (200 px wide),
   collapses to icon-only (60 px) via a toggle at the bottom. Tools route
   through the shared tools.js activeTool state machine. Modes section is
   always visible to authed users; Tools and History only in Edit mode.
   Selection section only when at least one node is selected in Edit mode. */

import { tr } from './i18n.js';
import { setActiveTool, getActiveTool, onActiveToolChange } from './tools.js';

const STORAGE_KEY = 'argLeftRailCollapsed';
const LEGACY_STORAGE_KEY = 'arg.editorRail';

const SVG_PATHS = {
  browse:     '<circle cx="11" cy="11" r="7"/><path d="M16.2 16.2L21 21"/>',
  edit:       '<path d="M14 4l6 6L9 21H3v-6L14 4z"/><path d="M13 5l6 6"/>',
  select:     '<path d="M5 4l8 16 2-7 7-2L5 4z"/>',
  pan:        '<path d="M9 11V5a2 2 0 1 1 4 0v6"/><path d="M9 11V8a2 2 0 1 0-4 0v6a8 8 0 0 0 8 8h0a8 8 0 0 0 8-8v-2a2 2 0 1 0-4 0"/><path d="M13 11V4a2 2 0 1 1 4 0v8"/>',
  block:      '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/>',
  sticky:     '<path d="M4.5 4.5h12l3.5 3.5v11.5a0.5 0.5 0 0 1 -0.5 0.5H4.5a0.5 0.5 0 0 1 -0.5 -0.5v-15a0.5 0.5 0 0 1 0.5 -0.5z"/><path d="M16.5 4.5v3.5h3.5"/>',
  group:      '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" stroke-dasharray="3 2"/>',
  text:       '<path d="M5 6h14"/><path d="M12 6v14"/><path d="M9 20h6"/>',
  image:      '<rect x="3.5" y="4.5" width="17" height="13" rx="1.5"/><path d="M3.5 14L8 10l3 3l3-3l4 4"/><circle cx="14.5" cy="8.5" r="1.4"/>',
  video:      '<rect x="3.5" y="6.5" width="13" height="11" rx="1.5"/><path d="M16.5 10 L21 7.5 L21 16.5 L16.5 14 Z"/>',
  audio:      '<path d="M5 9v6h3l5 4V5L8 9z"/><path d="M16 8a5 5 0 0 1 0 8"/><path d="M19 5a9 9 0 0 1 0 14"/>',
  arrow:      '<path d="M4 12h14"/><path d="M13 7l5 5l-5 5"/>',
  transform:  '<rect x="2.5" y="6.5" width="6" height="11" rx="1"/><rect x="15.5" y="6.5" width="6" height="11" rx="1"/><path d="M9 12h6"/><path d="M13 9l3 3l-3 3"/>',
  pen:        '<path d="M15.5 4.5l4 4l-10 10l-5 1l1-5z"/><path d="M13.5 6.5l4 4"/>',
  group_sel:  '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" stroke-dasharray="3 2"/><rect x="7" y="9" width="4" height="3"/><rect x="13" y="12" width="4" height="3"/>',
  ungroup:    '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5" stroke-dasharray="3 2"/><path d="M7 9 L17 15"/><path d="M17 9 L7 15"/>',
  trash:      '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1 -13"/>',
  duplicate:  '<rect x="3.5" y="3.5" width="13" height="13" rx="1.5"/><rect x="7.5" y="7.5" width="13" height="13" rx="1.5"/>',
  lock:       '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock:     '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 7.4 -2.1"/>',
  undo:       '<path d="M9 6L4 11l5 5"/><path d="M4 11h11a4 4 0 0 1 0 8H10"/>',
  redo:       '<path d="M15 6l5 5l-5 5"/><path d="M20 11H9a4 4 0 0 0 0 8h5"/>',
  collapse:   '<path d="M15 6l-6 6 6 6"/>',
  expand:     '<path d="M9 6l6 6-6 6"/>',
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

function loadCollapsed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
  } catch (e) { void e; }
  try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch (e) { void e; }
  return false;
}

function persistCollapsed(value) {
  try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch (e) { void e; }
}

export class LeftRail {
  constructor(opts) {
    this.handlers = opts.handlers || {};
    this.state = { collapsed: loadCollapsed() };
    this._buttons = {};
    this._build();
    this._applyCollapsed();
    this._applyActiveTool(getActiveTool());
    this.refreshSelectionGroup();
    onActiveToolChange((t) => this._applyActiveTool(t));
    document.addEventListener('i18n:changed', () => this._retranslate());
  }

  _build() {
    const rail = document.createElement('div');
    rail.id = 'left-rail';
    rail.className = 'left-rail';

    rail.appendChild(this._sectionHeading('rail_section_modes'));
    const modes = this._makeSection('rail-modes');
    modes.appendChild(this._makeLabelBtn({
      id: 'rail-mode-viewer', icon: 'browse', i18n: 'mode_viewer',
      onClick: () => this.handlers.onModeChange && this.handlers.onModeChange('viewer'),
    }));
    modes.appendChild(this._makeLabelBtn({
      id: 'rail-mode-editor', icon: 'edit', i18n: 'mode_editor',
      onClick: () => this.handlers.onModeChange && this.handlers.onModeChange('editor'),
    }));
    rail.appendChild(modes);

    const toolsHead = this._sectionHeading('rail_section_tools');
    toolsHead.classList.add('rail-section-tools-head');
    rail.appendChild(toolsHead);
    this.toolsHeadEl = toolsHead;
    const tools = this._makeSection('rail-tools');

    tools.appendChild(this._makeLabelBtn({
      id: 'rail-tool-select', icon: 'select', i18n: 'tool_select', tool: 'select', shortcut: 'S',
      helpKey: 'tool_help_select',
      onClick: () => setActiveTool('select'),
    }));
    tools.appendChild(this._makeLabelBtn({
      id: 'rail-tool-pan', icon: 'pan', i18n: 'tool_pan', tool: 'pan', shortcut: 'H',
      helpKey: 'tool_help_pan',
      onClick: () => setActiveTool('pan'),
    }));

    tools.appendChild(this._sep());

    tools.appendChild(this._makeLabelBtn({
      id: 'rail-tool-block', icon: 'block', i18n: 'editor_tools_block', tool: 'block', shortcut: 'B',
      helpKey: 'tool_help_block',
      onClick: () => setActiveTool('block'),
    }));
    tools.appendChild(this._makeLabelBtn({
      id: 'rail-tool-sticky', icon: 'sticky', i18n: 'editor_tools_sticky', tool: 'sticky', shortcut: 'N',
      helpKey: 'tool_help_sticky',
      onClick: () => setActiveTool('sticky'),
    }));
    tools.appendChild(this._makeLabelBtn({
      id: 'rail-tool-group', icon: 'group', i18n: 'editor_tools_group', tool: 'group', shortcut: 'G',
      helpKey: 'tool_help_group',
      onClick: () => setActiveTool('group'),
    }));
    tools.appendChild(this._makeLabelBtn({
      id: 'rail-tool-text', icon: 'text', i18n: 'tool_add_text', tool: 'text', shortcut: 'T',
      helpKey: 'tool_help_text',
      onClick: () => setActiveTool('text'),
    }));
    tools.appendChild(this._makeLabelBtn({
      id: 'rail-tool-image', icon: 'image', i18n: 'tool_image', tool: 'image', shortcut: 'I',
      helpKey: 'tool_help_image',
      onClick: () => {
        setActiveTool('image');
        if (this.handlers.onUploadImage) this.handlers.onUploadImage();
      },
    }));
    tools.appendChild(this._makeLabelBtn({
      id: 'rail-tool-video', icon: 'video', i18n: 'tool_add_video', tool: 'video', shortcut: 'V',
      helpKey: 'tool_help_video',
      onClick: () => {
        setActiveTool('video');
        if (this.handlers.onAddVideo) this.handlers.onAddVideo();
      },
    }));
    tools.appendChild(this._makeLabelBtn({
      id: 'rail-tool-audio', icon: 'audio', i18n: 'tool_audio', tool: 'audio', shortcut: 'U',
      helpKey: 'tool_help_audio',
      onClick: () => {
        setActiveTool('audio');
        if (this.handlers.onUploadAudio) this.handlers.onUploadAudio();
      },
    }));
    tools.appendChild(this._makeLabelBtn({
      id: 'rail-tool-arrow', icon: 'arrow', i18n: 'tool_arrow', tool: 'arrow', shortcut: 'A',
      helpKey: 'tool_help_arrow',
      onClick: () => setActiveTool('arrow'),
    }));
    tools.appendChild(this._makeLabelBtn({
      id: 'rail-tool-transform', icon: 'transform', i18n: 'tool_transform', tool: 'transform', shortcut: 'R',
      helpKey: 'tool_help_transform',
      onClick: () => setActiveTool('transform'),
    }));
    tools.appendChild(this._makeLabelBtn({
      id: 'rail-tool-pen', icon: 'pen', i18n: 'tool_pen', tool: 'pen', shortcut: 'P',
      helpKey: 'tool_help_pen',
      onClick: () => setActiveTool('pen'),
    }));
    rail.appendChild(tools);
    this.toolsEl = tools;

    const selectionHead = this._sectionHeading('rail_section_selection');
    selectionHead.classList.add('rail-section-selection-head');
    rail.appendChild(selectionHead);
    this.selectionHeadEl = selectionHead;
    const selection = this._makeSection('rail-selection');
    selection.appendChild(this._makeLabelBtn({
      id: 'rail-sel-group', icon: 'group_sel', i18n: 'editor_tools_group_selection', shortcut: 'Ctrl+G',
      onClick: () => this.handlers.onGroupSelection && this.handlers.onGroupSelection(),
    }));
    selection.appendChild(this._makeLabelBtn({
      id: 'rail-sel-ungroup', icon: 'ungroup', i18n: 'editor_tools_ungroup', shortcut: 'Ctrl+Shift+G',
      onClick: () => this.handlers.onUngroup && this.handlers.onUngroup(),
    }));
    selection.appendChild(this._makeLabelBtn({
      id: 'rail-sel-duplicate', icon: 'duplicate', i18n: 'editor_tools_duplicate', shortcut: 'Ctrl+D',
      onClick: () => this.handlers.onDuplicate && this.handlers.onDuplicate(),
    }));
    selection.appendChild(this._makeLabelBtn({
      id: 'rail-sel-lock', icon: 'lock', i18n: 'editor_tools_lock', shortcut: 'L',
      onClick: () => this.handlers.onToggleLock && this.handlers.onToggleLock(),
    }));
    selection.appendChild(this._makeLabelBtn({
      id: 'rail-sel-delete', icon: 'trash', i18n: 'editor_tools_delete', shortcut: 'Del',
      danger: true,
      onClick: () => this.handlers.onDeleteSelection && this.handlers.onDeleteSelection(),
    }));
    rail.appendChild(selection);
    this.selectionEl = selection;

    const historyHead = this._sectionHeading('rail_section_history');
    historyHead.classList.add('rail-section-history-head');
    rail.appendChild(historyHead);
    this.historyHeadEl = historyHead;
    const history = this._makeSection('rail-history');
    history.appendChild(this._makeLabelBtn({
      id: 'rail-history-undo', icon: 'undo', i18n: 'editor_tools_undo', shortcut: 'Ctrl+Z',
      onClick: () => this.handlers.onUndo && this.handlers.onUndo(),
    }));
    history.appendChild(this._makeLabelBtn({
      id: 'rail-history-redo', icon: 'redo', i18n: 'editor_tools_redo', shortcut: 'Ctrl+Y',
      onClick: () => this.handlers.onRedo && this.handlers.onRedo(),
    }));
    rail.appendChild(history);
    this.historyEl = history;

    const footer = this._makeSection('rail-footer');
    const collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.id = 'rail-collapse-btn';
    collapseBtn.className = 'rail-collapse-btn';
    collapseBtn.dataset.i18n = 'rail_collapse';
    collapseBtn.title = tr('rail_collapse');
    collapseBtn.setAttribute('aria-label', tr('rail_collapse'));
    const collapseIcon = svgIcon('collapse', 18);
    const collapseLabel = document.createElement('span');
    collapseLabel.className = 'rail-btn-label';
    collapseLabel.textContent = tr('rail_collapse');
    collapseBtn.appendChild(collapseIcon);
    collapseBtn.appendChild(collapseLabel);
    collapseBtn.addEventListener('click', (e) => { e.preventDefault(); this._toggleCollapsed(); });
    this._buttons['rail-collapse-btn'] = collapseBtn;
    this._collapseLabelEl = collapseLabel;
    this._collapseIconEl = collapseIcon;
    footer.appendChild(collapseBtn);
    rail.appendChild(footer);
    this.footerEl = footer;

    document.body.appendChild(rail);
    this.railEl = rail;
  }

  _sectionHeading(i18nKey) {
    const h = document.createElement('div');
    h.className = 'rail-section-head';
    h.dataset.i18n = i18nKey;
    h.textContent = tr(i18nKey);
    return h;
  }

  _makeSection(cls) {
    const s = document.createElement('div');
    s.className = `rail-section ${cls}`;
    return s;
  }

  _sep() {
    const sep = document.createElement('div');
    sep.className = 'rail-separator';
    return sep;
  }

  _makeLabelBtn(opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = opts.id;
    b.className = 'rail-btn rail-btn-labelled';
    if (opts.danger) b.classList.add('danger');
    b.dataset.i18n = opts.i18n;
    if (opts.tool) b.dataset.tool = opts.tool;
    if (opts.helpKey) b.dataset.helpKey = opts.helpKey;
    const aria = this._composeAria(opts);
    b.title = aria;
    b.setAttribute('aria-label', aria);
    b.appendChild(svgIcon(opts.icon));
    const lab = document.createElement('span');
    lab.className = 'rail-btn-label';
    lab.textContent = tr(opts.i18n);
    b.appendChild(lab);
    if (opts.shortcut) {
      const sc = document.createElement('span');
      sc.className = 'rail-btn-shortcut';
      sc.textContent = opts.shortcut;
      b.appendChild(sc);
    }
    if (opts.helpKey) {
      const help = document.createElement('span');
      help.className = 'rail-btn-help';
      help.textContent = '?';
      help.title = tr(opts.helpKey);
      help.setAttribute('aria-label', tr('tool_help_badge_aria', { name: tr(opts.i18n) }));
      help.setAttribute('role', 'img');
      help.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
      b.appendChild(help);
    }
    b.addEventListener('click', (e) => { e.preventDefault(); opts.onClick && opts.onClick(); });
    this._buttons[opts.id] = b;
    return b;
  }

  _composeAria(opts) {
    const base = tr(opts.i18n);
    const help = opts.helpKey ? tr(opts.helpKey) : '';
    const sc = opts.shortcut ? ` (${opts.shortcut})` : '';
    return help ? `${base}${sc} — ${help}` : `${base}${sc}`;
  }

  _toggleCollapsed() {
    this.state.collapsed = !this.state.collapsed;
    persistCollapsed(this.state.collapsed);
    this._applyCollapsed();
  }

  _applyCollapsed() {
    if (!this.railEl) return;
    this.railEl.classList.toggle('collapsed', this.state.collapsed);
    if (this._collapseIconEl) {
      this._collapseIconEl.innerHTML = SVG_PATHS[this.state.collapsed ? 'expand' : 'collapse'];
    }
    const key = this.state.collapsed ? 'rail_expand' : 'rail_collapse';
    if (this._collapseLabelEl) this._collapseLabelEl.textContent = tr(key);
    const btn = this._buttons['rail-collapse-btn'];
    if (btn) {
      btn.dataset.i18n = key;
      btn.title = tr(key);
      btn.setAttribute('aria-label', tr(key));
    }
  }

  _applyActiveTool(tool) {
    if (!this.railEl) return;
    const buttons = this.railEl.querySelectorAll('button[data-tool]');
    buttons.forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
  }

  refreshSelectionGroup() {
    if (!this.selectionEl) return;
    const info = (this.handlers.getSelectionInfo && this.handlers.getSelectionInfo()) || { size: 0, allLocked: false };
    const empty = !(info.size > 0);
    this.selectionEl.classList.toggle('rail-section-hidden', empty);
    if (this.selectionHeadEl) this.selectionHeadEl.classList.toggle('rail-section-hidden', empty);
    const lockBtn = this._buttons['rail-sel-lock'];
    if (lockBtn) {
      const labKey = info.allLocked ? 'editor_tools_unlock' : 'editor_tools_lock';
      lockBtn.dataset.i18n = labKey;
      const labEl = lockBtn.querySelector('.rail-btn-label');
      if (labEl) labEl.textContent = tr(labKey);
      const iconHolder = lockBtn.querySelector('svg');
      if (iconHolder) iconHolder.innerHTML = SVG_PATHS[info.allLocked ? 'unlock' : 'lock'];
      const aria = `${tr(labKey)} (L)`;
      lockBtn.title = aria;
      lockBtn.setAttribute('aria-label', aria);
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

  isCollapsed() { return !!this.state.collapsed; }

  _retranslate() {
    if (!this.railEl) return;
    this.railEl.querySelectorAll('button[data-i18n]').forEach((b) => {
      const key = b.dataset.i18n;
      const text = tr(key);
      const lab = b.querySelector('.rail-btn-label');
      if (lab) lab.textContent = text;
      const help = b.querySelector('.rail-btn-help');
      if (help && b.dataset.helpKey) {
        help.title = tr(b.dataset.helpKey);
        help.setAttribute('aria-label', tr('tool_help_badge_aria', { name: text }));
      }
      const composed = this._composeAriaFromButton(b, text);
      b.title = composed;
      b.setAttribute('aria-label', composed);
    });
    this.railEl.querySelectorAll('.rail-section-head[data-i18n]').forEach((h) => {
      h.textContent = tr(h.dataset.i18n);
    });
    if (this._collapseLabelEl) {
      const key = this.state.collapsed ? 'rail_expand' : 'rail_collapse';
      this._collapseLabelEl.textContent = tr(key);
    }
  }

  _composeAriaFromButton(b, text) {
    const sc = b.querySelector('.rail-btn-shortcut');
    const scText = sc ? ` (${sc.textContent})` : '';
    const help = b.dataset.helpKey ? tr(b.dataset.helpKey) : '';
    return help ? `${text}${scText} — ${help}` : `${text}${scText}`;
  }
}
