/* Command palette overlay. Ctrl+K to open. Fuzzy lower-case match by title;
   results grouped by category (Nodes / Commands / Filters / Outline /
   Settings) and sorted by score then by recency. Arrow keys navigate, Enter
   activates, Esc closes. */

import { tr, LANGS, setLang } from './i18n.js';

const STORAGE_KEY = 'arg_map_palette_recent';
const MAX_RECENT = 24;

export class CommandPalette {
  constructor(opts) {
    this.container = opts.container || document.body;
    this.getEntries = opts.getEntries || (() => []);
    this.onActivate = opts.onActivate || (() => {});

    this.recent = this._loadRecent();
    this.entries = [];
    this.filtered = [];
    this.selectedIdx = 0;
    this.langSubmode = false;

    this._build();
    this._wireEvents();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'command-palette';
    root.className = 'command-palette hidden';
    root.innerHTML = `
      <div class="command-palette-backdrop"></div>
      <div class="command-palette-box" role="dialog" aria-modal="true">
        <input class="command-palette-input" type="text" placeholder="${tr('palette_placeholder')}" autocomplete="off" spellcheck="false">
        <div class="command-palette-list"></div>
      </div>
    `;
    this.container.appendChild(root);
    this.rootEl = root;
    this.boxEl = root.querySelector('.command-palette-box');
    this.inputEl = root.querySelector('.command-palette-input');
    this.listEl = root.querySelector('.command-palette-list');
    this.backdropEl = root.querySelector('.command-palette-backdrop');
  }

  _wireEvents() {
    this.backdropEl.addEventListener('click', () => this.close());
    this.inputEl.addEventListener('input', () => this._update());
    this.inputEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        if (this.langSubmode) {
          this.langSubmode = false;
          this._update();
          return;
        }
        this.close();
      } else if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        this._moveSel(1);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        this._moveSel(-1);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        this._activateSelected();
      }
    });
  }

  open() {
    this.entries = this.getEntries();
    this.inputEl.value = '';
    this.langSubmode = false;
    this.rootEl.classList.remove('hidden');
    this.rootEl.classList.add('open');
    setTimeout(() => this.inputEl.focus(), 10);
    this._update();
  }

  close() {
    this.rootEl.classList.remove('open');
    this.rootEl.classList.add('hidden');
    this.inputEl.blur();
  }

  toggle() {
    if (this.isOpen()) this.close();
    else this.open();
  }

  isOpen() { return this.rootEl.classList.contains('open'); }

  retranslate() {
    if (this.inputEl) this.inputEl.placeholder = tr('palette_placeholder');
    if (this.isOpen()) this._update();
  }

  _update() {
    const term = (this.inputEl.value || '').trim().toLowerCase();
    if (this.langSubmode) {
      this.filtered = LANGS.map((l) => ({
        id: `lang:${l}`,
        category: 'settings',
        title: l.toUpperCase(),
        fn: () => {
          setLang(l);
          this.langSubmode = false;
          this.close();
        },
      }));
    } else {
      const scored = [];
      for (const e of this.entries) {
        const score = fuzzyScore(e.title, term, this.recent.indexOf(e.id));
        if (score >= 0) {
          scored.push({ ...e, _score: score });
        }
      }
      scored.sort((a, b) => b._score - a._score);
      this.filtered = scored;
    }
    this.selectedIdx = 0;
    this._render();
  }

  _moveSel(delta) {
    const n = this.filtered.length;
    if (!n) return;
    this.selectedIdx = (this.selectedIdx + delta + n) % n;
    this._renderSelection();
    const sel = this.listEl.querySelector('.command-row.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  _activateSelected() {
    const item = this.filtered[this.selectedIdx];
    if (!item) return;
    this._pushRecent(item.id);
    if (item.fn) item.fn();
    if (!this.langSubmode) this.close();
  }

  _render() {
    this.listEl.innerHTML = '';
    if (!this.filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'command-empty';
      empty.textContent = tr('palette_no_results');
      this.listEl.appendChild(empty);
      return;
    }
    let lastCat = null;
    for (let i = 0; i < this.filtered.length; i++) {
      const it = this.filtered[i];
      if (it.category !== lastCat) {
        lastCat = it.category;
        const head = document.createElement('div');
        head.className = 'command-cat';
        head.textContent = categoryLabel(lastCat);
        this.listEl.appendChild(head);
      }
      const row = document.createElement('div');
      row.className = 'command-row';
      row.dataset.idx = String(i);
      if (i === this.selectedIdx) row.classList.add('selected');
      const t = document.createElement('span');
      t.className = 'command-row-title';
      t.textContent = it.title;
      row.appendChild(t);
      if (it.hint) {
        const h = document.createElement('span');
        h.className = 'command-row-hint';
        h.textContent = it.hint;
        row.appendChild(h);
      }
      row.addEventListener('mouseenter', () => {
        this.selectedIdx = i;
        this._renderSelection();
      });
      row.addEventListener('click', () => this._activateSelected());
      this.listEl.appendChild(row);
    }
  }

  _renderSelection() {
    const rows = this.listEl.querySelectorAll('.command-row');
    rows.forEach((r) => {
      const idx = Number(r.dataset.idx);
      r.classList.toggle('selected', idx === this.selectedIdx);
    });
  }

  _pushRecent(id) {
    this.recent = [id, ...this.recent.filter((x) => x !== id)].slice(0, MAX_RECENT);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.recent));
    } catch (e) {
      void e;
    }
  }

  _loadRecent() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data.filter((x) => typeof x === 'string') : [];
    } catch (e) {
      return [];
    }
  }

  enterLangSubmode() {
    this.langSubmode = true;
    this.inputEl.value = '';
    this._update();
  }
}

function categoryLabel(cat) {
  switch (cat) {
    case 'nodes':    return tr('palette_category_nodes');
    case 'commands': return tr('palette_category_commands');
    case 'filters':  return tr('palette_category_filters');
    case 'outline':  return tr('palette_category_outline');
    case 'settings': return tr('palette_category_settings');
    default:         return cat;
  }
}

export function fuzzyScore(title, term, recentIdx) {
  const t = (title || '').toLowerCase();
  if (!term) {
    const recencyBoost = recentIdx >= 0 ? (1 / (1 + recentIdx)) * 0.6 : 0;
    return 1 + recencyBoost;
  }
  if (t.startsWith(term)) {
    return 100 - t.length * 0.01 + (recentIdx >= 0 ? 0.5 / (1 + recentIdx) : 0);
  }
  if (t.includes(term)) {
    return 60 - (t.indexOf(term) * 0.4) + (recentIdx >= 0 ? 0.3 / (1 + recentIdx) : 0);
  }
  let ti = 0;
  let consec = 0;
  let bestConsec = 0;
  for (let i = 0; i < term.length; i++) {
    while (ti < t.length && t[ti] !== term[i]) {
      ti += 1;
      consec = 0;
    }
    if (ti >= t.length) return -1;
    consec += 1;
    if (consec > bestConsec) bestConsec = consec;
    ti += 1;
  }
  return 20 + bestConsec * 1.2 + (recentIdx >= 0 ? 0.2 / (1 + recentIdx) : 0);
}
