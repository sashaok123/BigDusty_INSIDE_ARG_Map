/* Live search dropdown. Debounce 150 ms. Click result -> pan map + open
   side panel. Dims non-matching hotspots (does not hide them). */

import { matchesSearch } from './nodes.js';
import { tr } from './i18n.js';

const DEBOUNCE_MS = 150;
const MAX_RESULTS = 12;

export class SearchBar {
  constructor(opts) {
    this.inputEl = opts.inputEl;
    this.resultsEl = opts.resultsEl;
    this.getHotspots = opts.getHotspots;
    this.onPick = opts.onPick || (() => {});
    this.onTermChange = opts.onTermChange || (() => {});

    this.timer = null;
    this.lastTerm = '';
    this.installed = false;

    this._install();
  }

  _install() {
    this.inputEl.addEventListener('input', (e) => {
      const v = e.target.value;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this._update(v);
      }, DEBOUNCE_MS);
    });
    this.inputEl.addEventListener('focus', () => {
      if (this.lastTerm) this._renderResults(this.lastTerm);
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.resultsEl.contains(e.target) && e.target !== this.inputEl) {
        this.resultsEl.classList.remove('open');
      }
    });
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.inputEl.value = '';
        this._update('');
        this.inputEl.blur();
      }
    });
  }

  _update(term) {
    const v = term.trim();
    this.lastTerm = v;
    this._renderResults(v);
    const ids = new Set();
    if (v) {
      const hs = this.getHotspots();
      for (const h of hs) {
        if (matchesSearch(h, v)) ids.add(h.id);
      }
    }
    this.onTermChange(v, ids.size ? ids : null);
  }

  _renderResults(term) {
    if (!term) {
      this.resultsEl.classList.remove('open');
      this.resultsEl.innerHTML = '';
      return;
    }
    const hs = this.getHotspots();
    const matches = hs.filter((h) => matchesSearch(h, term)).slice(0, MAX_RESULTS);
    this.resultsEl.innerHTML = '';
    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.textContent = tr('search_no_matches');
      this.resultsEl.appendChild(empty);
      this.resultsEl.classList.add('open');
      return;
    }
    for (const h of matches) {
      const item = document.createElement('div');
      item.className = 'search-result';
      const t = document.createElement('span');
      t.className = 'sr-title';
      t.textContent = h.title;
      item.appendChild(t);
      const tags = document.createElement('span');
      tags.className = 'sr-tags';
      tags.textContent = (h.tags || []).join(', ');
      item.appendChild(tags);
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        this.onPick(h.id);
        this.resultsEl.classList.remove('open');
      });
      this.resultsEl.appendChild(item);
    }
    this.resultsEl.classList.add('open');
  }

  clear() {
    this.inputEl.value = '';
    this.lastTerm = '';
    this.resultsEl.classList.remove('open');
    this.resultsEl.innerHTML = '';
    this.onTermChange('', null);
  }
}
