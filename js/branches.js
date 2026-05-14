/* Branches panel + manage-branches modal. Branches are tags on nodes plus
   a top-level array in canvas data. The panel sits on the right; each
   branch row has a visibility toggle and a focus button. */

import { tr } from './i18n.js';

const SESSION_KEY = 'arg.branchFilter';
const BRANCH_COLOR_HEX = {
  '1': '#e83d3d', '2': '#e88a3d', '3': '#e8c83d', '4': '#3de88a',
  '5': '#3dc8e8', '6': '#9a6ce8',
};

function colorHex(color) { return BRANCH_COLOR_HEX[color] || BRANCH_COLOR_HEX['1']; }

function readSession() {
  try { const raw = sessionStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; }
  catch (e) { void e; return null; }
}

function writeSession(state) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch (e) { void e; }
}

export class BranchesPanel {
  constructor(opts) {
    this.getBranches = opts.getBranches || (() => []);
    this.getNodes = opts.getNodes || (() => new Map());
    this.canEdit = opts.canEdit || (() => false);
    this.onFocus = opts.onFocus || (() => {});
    this.onFilterChange = opts.onFilterChange || (() => {});
    this.onManage = opts.onManage || (() => {});
    const sess = readSession();
    this.activeBranch = sess && typeof sess.active === 'string' ? sess.active : null;
    this.hidden = sess && Array.isArray(sess.hidden) ? new Set(sess.hidden) : new Set();
    this._build();
    document.addEventListener('i18n:changed', () => this._refresh());
  }

  _build() {
    const drawer = document.createElement('div');
    drawer.id = 'branches-panel';
    drawer.className = 'branches-panel';
    drawer.innerHTML = `
      <div class="branches-head">
        <span class="branches-title" data-i18n="branches_panel_title">${tr('branches_panel_title')}</span>
        <button type="button" class="branches-close" aria-label="Close"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg></button>
      </div>
      <div class="branches-rows"></div>
      <div class="branches-foot">
        <button type="button" class="branches-clear" data-i18n="branches_all">${tr('branches_all')}</button>
        <button type="button" class="branches-manage" data-i18n="branches_manage">${tr('branches_manage')}</button>
      </div>
    `;
    document.body.appendChild(drawer);
    this.el = drawer;
    this.rowsEl = drawer.querySelector('.branches-rows');
    drawer.querySelector('.branches-close').addEventListener('click', () => this.close());
    drawer.querySelector('.branches-clear').addEventListener('click', () => {
      this.activeBranch = null; this.hidden = new Set();
      this._persist(); this._refresh(); this._notifyFilter();
    });
    drawer.querySelector('.branches-manage').addEventListener('click', () => {
      if (typeof this.onManage === 'function') this.onManage();
    });
    const chipsBar = document.createElement('div');
    chipsBar.id = 'branches-chips';
    chipsBar.className = 'branches-chips';
    const toolbar = document.getElementById('toolbar');
    if (toolbar) {
      const center = toolbar.querySelector('.tb-zone-center');
      (center || toolbar).appendChild(chipsBar);
    } else {
      document.body.appendChild(chipsBar);
    }
    this.chipsEl = chipsBar;
    this._refresh();
  }

  open() { if (this.el) this.el.classList.add('open'); }
  close() { if (this.el) this.el.classList.remove('open'); }
  toggle() {
    if (this.el && this.el.classList.contains('open')) this.close(); else this.open();
  }
  setBranches() { this._refresh(); }
  setNodes() { this._refresh(); }
  getActive() { return this.activeBranch; }
  getHidden() { return new Set(this.hidden); }

  isNodeVisible(nodeBranches) {
    if (!Array.isArray(nodeBranches) || nodeBranches.length === 0) return true;
    for (const b of nodeBranches) {
      if (!this.hidden.has(b)) return true;
    }
    return false;
  }

  computeFocusOpacity(nodeBranches) {
    if (!this.activeBranch) {
      if (this.hidden.size === 0) return 1;
      return this.isNodeVisible(nodeBranches) ? 1 : 0.1;
    }
    if (!Array.isArray(nodeBranches) || !nodeBranches.includes(this.activeBranch)) return 0.1;
    return 1;
  }

  _persist() {
    writeSession({ active: this.activeBranch, hidden: Array.from(this.hidden) });
  }

  _notifyFilter() {
    try {
      if (typeof this.onFilterChange === 'function') {
        this.onFilterChange({ active: this.activeBranch, hidden: new Set(this.hidden) });
      }
    } catch (e) { console.warn('[branches] filter handler', e); }
  }

  _refresh() {
    if (!this.rowsEl) return;
    const branches = this.getBranches();
    this.rowsEl.innerHTML = '';
    if (this.chipsEl) this.chipsEl.innerHTML = '';
    const allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = 'branch-chip branch-chip-all';
    allChip.textContent = tr('branches_all');
    if (!this.activeBranch && this.hidden.size === 0) allChip.classList.add('active');
    allChip.addEventListener('click', () => {
      this.activeBranch = null; this.hidden = new Set();
      this._persist(); this._refresh(); this._notifyFilter();
    });
    if (this.chipsEl) this.chipsEl.appendChild(allChip);
    for (const b of branches) {
      this.rowsEl.appendChild(this._makeRow(b));
      if (this.chipsEl) this.chipsEl.appendChild(this._makeChip(b));
    }
    if (this.el) {
      const head = this.el.querySelector('.branches-title');
      if (head) head.textContent = tr('branches_panel_title');
      const close = this.el.querySelector('.branches-close');
      if (close) close.setAttribute('aria-label', tr('file_viewer_close'));
      const clr = this.el.querySelector('.branches-clear');
      if (clr) clr.textContent = tr('branches_all');
      const mng = this.el.querySelector('.branches-manage');
      if (mng) mng.textContent = tr('branches_manage');
    }
  }

  _makeRow(b) {
    const row = document.createElement('div');
    row.className = 'branch-row';
    row.dataset.id = b.id;
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'branch-swatch';
    swatch.title = tr('branches_visible_toggle');
    swatch.setAttribute('aria-label', tr('branches_visible_toggle'));
    swatch.style.background = colorHex(b.color);
    if (this.hidden.has(b.id)) swatch.classList.add('hidden');
    swatch.addEventListener('click', () => {
      if (this.hidden.has(b.id)) this.hidden.delete(b.id); else this.hidden.add(b.id);
      this._persist(); this._refresh(); this._notifyFilter();
    });
    row.appendChild(swatch);
    const lbl = document.createElement('button');
    lbl.type = 'button';
    lbl.className = 'branch-label';
    lbl.textContent = b.label || b.id;
    lbl.title = tr('branches_focus');
    if (this.activeBranch === b.id) lbl.classList.add('active');
    lbl.addEventListener('click', () => this._activate(b.id));
    row.appendChild(lbl);
    return row;
  }

  _activate(id) {
    if (this.activeBranch === id) this.activeBranch = null;
    else { this.activeBranch = id; if (typeof this.onFocus === 'function') this.onFocus(id); }
    this._persist(); this._refresh(); this._notifyFilter();
  }

  _makeChip(b) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'branch-chip';
    if (this.activeBranch === b.id) chip.classList.add('active');
    if (this.hidden.has(b.id)) chip.classList.add('hidden');
    const dot = document.createElement('span');
    dot.className = 'branch-chip-dot';
    dot.style.background = colorHex(b.color);
    chip.appendChild(dot);
    const txt = document.createElement('span');
    txt.textContent = b.label || b.id;
    chip.appendChild(txt);
    chip.addEventListener('click', () => this._activate(b.id));
    return chip;
  }
}

export function openManageBranchesModal(opts) {
  const get = opts.getBranches || (() => []);
  const onUpdate = opts.onUpdate || (() => {});
  const onConfirmDelete = opts.onConfirmDelete || ((msg) => window.confirm(msg));
  let working = (get() || []).map((b) => ({ ...b }));

  const overlay = document.createElement('div');
  overlay.className = 'manage-branches-overlay';
  overlay.innerHTML = `
    <div class="manage-branches-box">
      <div class="manage-branches-head">
        <h3>${tr('branches_manage')}</h3>
        <button type="button" class="mb-close" aria-label="Close"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg></button>
      </div>
      <div class="manage-branches-list"></div>
      <div class="manage-branches-foot">
        <button type="button" class="mb-add">${tr('branches_new_branch')}</button>
        <span class="spacer" style="flex:1"></span>
        <button type="button" class="mb-cancel">${tr('file_viewer_close')}</button>
        <button type="button" class="mb-save modal-btn primary">${tr('editor_save_button') || 'Save'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const listEl = overlay.querySelector('.manage-branches-list');
  const close = () => { try { document.body.removeChild(overlay); } catch (e) { void e; } };
  overlay.querySelector('.mb-close').addEventListener('click', close);
  overlay.querySelector('.mb-cancel').addEventListener('click', close);
  overlay.querySelector('.mb-save').addEventListener('click', () => { onUpdate(working); close(); });
  overlay.querySelector('.mb-add').addEventListener('click', () => {
    const base = `branch-${working.length + 1}`;
    let id = base; let n = 1;
    while (working.some((w) => w.id === id)) { n += 1; id = `${base}-${n}`; }
    working.push({ id, label: id, color: '1', description: '' });
    render();
  });

  function render() {
    listEl.innerHTML = '';
    working.forEach((b, idx) => {
      const row = document.createElement('div');
      row.className = 'mb-row';
      const dot = document.createElement('span');
      dot.className = 'mb-dot';
      dot.style.background = colorHex(b.color);
      row.appendChild(dot);
      const label = document.createElement('input');
      label.type = 'text'; label.value = b.label;
      label.className = 'mb-input mb-input-label';
      label.placeholder = tr('branches_edit_label');
      label.addEventListener('input', () => { b.label = label.value; });
      const idIn = document.createElement('input');
      idIn.type = 'text'; idIn.value = b.id;
      idIn.className = 'mb-input mb-input-id';
      idIn.placeholder = 'id';
      idIn.addEventListener('input', () => { const v = idIn.value.trim(); if (v) b.id = v; });
      const colorSel = document.createElement('select');
      colorSel.className = 'mb-input mb-input-color';
      ['1','2','3','4','5','6'].forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        if (c === b.color) opt.selected = true;
        colorSel.appendChild(opt);
      });
      colorSel.addEventListener('change', () => { b.color = colorSel.value; dot.style.background = colorHex(b.color); });
      const up = document.createElement('button');
      up.type = 'button'; up.className = 'mb-btn'; up.textContent = '↑';
      up.addEventListener('click', () => {
        if (idx > 0) { const tmp = working[idx]; working[idx] = working[idx-1]; working[idx-1] = tmp; render(); }
      });
      const down = document.createElement('button');
      down.type = 'button'; down.className = 'mb-btn'; down.textContent = '↓';
      down.addEventListener('click', () => {
        if (idx < working.length - 1) { const tmp = working[idx]; working[idx] = working[idx+1]; working[idx+1] = tmp; render(); }
      });
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'mb-btn mb-btn-danger'; del.textContent = '×';
      del.addEventListener('click', async () => {
        const ok = await Promise.resolve(onConfirmDelete(tr('branches_delete_confirm', { label: b.label || b.id })));
        if (!ok) return;
        working.splice(idx, 1); render();
      });
      row.appendChild(label); row.appendChild(idIn); row.appendChild(colorSel);
      row.appendChild(up); row.appendChild(down); row.appendChild(del);
      listEl.appendChild(row);
    });
  }
  render();
}
