/* Floating bottom-right canvas counters: nodes, edges, branches, bookmarks,
   verification statuses. Re-renders on `state:changed`. The toolbar toggle
   button is created at construction time and inserted next to the bookmarks
   button. Visibility preference persists in localStorage. */

import { tr } from './i18n.js';

const STORAGE_KEY = 'argCountersVisible';

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

function loadVisible() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === '0' || raw === 'false') return false;
    if (raw === '1' || raw === 'true') return true;
  } catch (e) { void e; }
  return true;
}

function persistVisible(value) {
  try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch (e) { void e; }
}

export class CountersWidget {
  constructor(opts) {
    this.viewport = opts.viewport;
    this.getNodes = opts.getNodes || (() => new Map());
    this.getEdges = opts.getEdges || (() => new Map());
    this.getBranches = opts.getBranches || (() => []);
    this.onBookmarksClick = opts.onBookmarksClick || (() => {});
    this.onVerificationFilter = opts.onVerificationFilter || (() => {});
    this.visible = loadVisible();
    this._build();
    this._buildToolbarButton();
    this._installListeners();
    this._applyVisibility();
    this.refresh();
  }

  _build() {
    const root = el('div', { id: 'counters-widget', class: 'counters-widget' });
    root.setAttribute('role', 'status');
    root.setAttribute('aria-label', tr('counters_widget_aria'));
    const row1 = el('div', { class: 'counters-row counters-row-primary' });
    const row2 = el('div', { class: 'counters-row counters-row-secondary' });
    root.appendChild(row1);
    root.appendChild(row2);
    if (this.viewport && this.viewport.parentNode) {
      this.viewport.parentNode.appendChild(root);
    } else {
      document.body.appendChild(root);
    }
    this.rootEl = root;
    this.row1El = row1;
    this.row2El = row2;
  }

  _buildToolbarButton() {
    const btn = el('button', {
      id: 'btn-counters-toggle',
      class: 'tb-icon-btn',
      type: 'button',
      title: tr('counters_widget_toggle_aria'),
      'aria-label': tr('counters_widget_toggle_aria'),
    });
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">'
      + '<path d="M4 20V10M10 20V4M16 20V14M22 20H2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
      + '</svg>';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    const zoneRight = document.querySelector('#toolbar .tb-zone-right .tb-group-view');
    if (zoneRight) {
      const settingsBtn = zoneRight.querySelector('#btn-settings');
      const bookmarksBtn = zoneRight.querySelector('#btn-bookmarks-toggle');
      const anchor = bookmarksBtn || settingsBtn;
      if (anchor) zoneRight.insertBefore(btn, anchor);
      else zoneRight.appendChild(btn);
    } else {
      const root = document.querySelector('#toolbar .tb-zone-right');
      if (root) root.appendChild(btn);
    }
    this.btnEl = btn;
  }

  _installListeners() {
    document.addEventListener('state:changed', () => this.refresh());
    document.addEventListener('i18n:changed', () => {
      if (this.btnEl) {
        this.btnEl.title = tr('counters_widget_toggle_aria');
        this.btnEl.setAttribute('aria-label', tr('counters_widget_toggle_aria'));
      }
      if (this.rootEl) this.rootEl.setAttribute('aria-label', tr('counters_widget_aria'));
      this.refresh();
    });
  }

  toggle() {
    this.visible = !this.visible;
    persistVisible(this.visible);
    this._applyVisibility();
  }

  _applyVisibility() {
    if (!this.rootEl) return;
    this.rootEl.classList.toggle('hidden', !this.visible);
    if (this.btnEl) this.btnEl.classList.toggle('active', this.visible);
  }

  refresh() {
    if (!this.rootEl) return;
    const stats = this._compute();
    this._renderRow(this.row1El, [
      { key: 'nodes',    value: stats.nodes,    i18n: 'counters_label_nodes' },
      { key: 'edges',    value: stats.edges,    i18n: 'counters_label_edges' },
      { key: 'branches', value: stats.branches, i18n: 'counters_label_branches' },
    ]);
    this._renderRow(this.row2El, [
      { key: 'bookmarks',  value: stats.bookmarks,  i18n: 'counters_label_bookmarks',  filter: 'bookmarks' },
      { key: 'verified',   value: stats.verified,   i18n: 'counters_label_verified',   filter: 'verified' },
      { key: 'hypothesis', value: stats.hypothesis, i18n: 'counters_label_hypothesis', filter: 'hypothesis' },
      { key: 'disputed',   value: stats.disputed,   i18n: 'counters_label_disputed',   filter: 'disputed' },
      { key: 'falsified',  value: stats.falsified,  i18n: 'counters_label_falsified',  filter: 'falsified' },
    ]);
  }

  _renderRow(host, entries) {
    if (!host) return;
    host.innerHTML = '';
    entries.forEach((entry, idx) => {
      if (idx > 0) {
        const sep = el('span', { class: 'counters-sep', text: '·' });
        host.appendChild(sep);
      }
      const isInteractive = !!entry.filter;
      const cell = el(isInteractive ? 'button' : 'span', {
        class: 'counters-cell' + (entry.value > 0 ? ' counters-cell-active' : ''),
      });
      if (isInteractive) {
        cell.type = 'button';
        cell.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this._handleClick(entry.filter);
        });
      }
      cell.textContent = tr(entry.i18n, { n: entry.value });
      host.appendChild(cell);
    });
  }

  _handleClick(filter) {
    if (filter === 'bookmarks') {
      try { this.onBookmarksClick(); } catch (e) { void e; }
      return;
    }
    try { this.onVerificationFilter(filter); } catch (e) { void e; }
  }

  _compute() {
    const nodes = this.getNodes() || new Map();
    const edges = this.getEdges() || new Map();
    const branches = this.getBranches() || [];
    let nodeCount = 0;
    let bookmarks = 0;
    let verified = 0;
    let hypothesis = 0;
    let disputed = 0;
    let falsified = 0;
    for (const n of nodes.values()) {
      if (!n) continue;
      nodeCount += 1;
      if (n.bookmarked) bookmarks += 1;
      const v = typeof n.verification === 'string' ? n.verification : '';
      if (v === 'verified') verified += 1;
      else if (v === 'hypothesis') hypothesis += 1;
      else if (v === 'disputed') disputed += 1;
      else if (v === 'falsified') falsified += 1;
    }
    const edgeCount = edges instanceof Map ? edges.size : (Array.isArray(edges) ? edges.length : 0);
    const branchCount = Array.isArray(branches) ? branches.length : 0;
    return {
      nodes: nodeCount,
      edges: edgeCount,
      branches: branchCount,
      bookmarks,
      verified,
      hypothesis,
      disputed,
      falsified,
    };
  }
}
