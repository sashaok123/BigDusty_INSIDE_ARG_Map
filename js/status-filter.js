/* Status filter state + chip wiring. Multi-select via Shift+click. Single
   click toggles. Persists `active` set to localStorage. Fade rather than hide:
   non-matching nodes drop to 0.1 opacity; matching edges keep full opacity. */

import { STATUSES } from './nodes.js';
import { tr } from './i18n.js';

const STORAGE_KEY = 'arg_map_filter';
const ALL = 'all';

export class StatusFilter {
  constructor(opts) {
    this.chips = opts.chips || [];
    this.onChange = opts.onChange || (() => {});

    this.activeSet = new Set();
    this.activeKey = ALL;

    this._loadFromStorage();
    this._installChips();
    this.apply(this.activeKey, this.activeSet);
  }

  _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.key === ALL) {
        this.activeKey = ALL;
        this.activeSet = new Set();
        return;
      }
      if (data && Array.isArray(data.set)) {
        const set = new Set(data.set.filter((s) => STATUSES.includes(s)));
        if (set.size > 0) {
          this.activeSet = set;
          this.activeKey = set.size === 1 ? [...set][0] : 'multi';
        }
      }
    } catch (e) {
      void e;
    }
  }

  _saveToStorage() {
    try {
      const payload = this.activeKey === ALL
        ? { key: ALL }
        : { key: this.activeKey, set: [...this.activeSet] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      void e;
    }
  }

  _installChips() {
    for (const chip of this.chips) {
      chip.addEventListener('click', (ev) => {
        const f = chip.dataset.filter;
        if (!f) return;
        if (f === ALL) {
          this.apply(ALL, new Set());
          return;
        }
        if (ev.shiftKey && this.activeKey !== ALL) {
          const next = new Set(this.activeSet);
          if (next.has(f)) {
            next.delete(f);
          } else {
            next.add(f);
          }
          if (next.size === 0) {
            this.apply(ALL, new Set());
          } else {
            const key = next.size === 1 ? [...next][0] : 'multi';
            this.apply(key, next);
          }
          return;
        }
        if (this.activeKey === f) {
          this.apply(ALL, new Set());
          return;
        }
        this.apply(f, new Set([f]));
      });
    }
  }

  apply(key, set) {
    this.activeKey = key;
    this.activeSet = set instanceof Set ? set : new Set(set);
    this._refreshChips();
    this._saveToStorage();
    const effective = this._effectiveSet();
    this.onChange({
      activeKey: this.activeKey,
      activeSet: new Set(this.activeSet),
      effectiveSet: effective,
    });
  }

  cycle() {
    const order = [ALL, 'solved', 'partial', 'unsolved', 'no-data', 'dead-end'];
    const idx = order.indexOf(this.activeKey);
    const next = idx === -1 ? ALL : order[(idx + 1) % order.length];
    if (next === ALL) {
      this.apply(ALL, new Set());
    } else {
      this.apply(next, new Set([next]));
    }
  }

  clear() {
    this.apply(ALL, new Set());
  }

  _effectiveSet() {
    if (this.activeKey === ALL) return new Set(STATUSES);
    return new Set(this.activeSet);
  }

  _refreshChips() {
    for (const chip of this.chips) {
      const f = chip.dataset.filter;
      if (!f) continue;
      const isAll = f === ALL && this.activeKey === ALL;
      const isInSet = this.activeKey !== ALL && this.activeSet.has(f);
      chip.classList.toggle('active', isAll || isInSet);
    }
  }

  getActiveKey() { return this.activeKey; }
  getEffectiveSet() { return this._effectiveSet(); }
  getActiveSet() { return new Set(this.activeSet); }
}

export function filterLabel(key) {
  switch (key) {
    case 'all':      return tr('filter_all');
    case 'solved':   return tr('filter_solved');
    case 'partial':  return tr('filter_partial');
    case 'unsolved': return tr('filter_unsolved');
    case 'no-data':  return tr('filter_no_data');
    case 'dead-end': return tr('filter_dead_end');
    default:         return key;
  }
}
