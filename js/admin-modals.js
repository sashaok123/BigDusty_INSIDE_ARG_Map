/* Admin modals: Activity log, Snapshots history (with preview + restore),
   Online users (popover-style). Activity log calls GET /admin/audit; snapshots
   call GET/POST /admin/canvas/main/snapshots[/...]; presence reads from
   the latest broadcast cached in PresencePanel. */

import { tr } from './i18n.js';
import {
  getAuditLog,
  listSnapshots,
  getSnapshot,
  restoreSnapshot,
} from './api-client.js';

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

function relTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Math.max(0, Date.now() - t);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function actionLabel(action) {
  const key = `audit_action_${action}`;
  const trans = tr(key);
  if (trans !== key) return trans;
  return action;
}

export function openActivityLog() {
  const overlay = el('div', { class: 'auth-modal open' });
  overlay.style.zIndex = '2500';
  const box = el('div', { class: 'auth-modal-box wide' });
  const head = el('div', { class: 'auth-modal-head' });
  head.appendChild(el('h2', { text: tr('activity_log_title') }));
  const close = el('button', { type: 'button', class: 'auth-x', html: '&times;' });
  head.appendChild(close);
  const body = el('div', { class: 'auth-modal-body' });
  const toolbar = el('div', { class: 'admin-modal-toolbar' });
  const filterSel = el('select', { class: 'admin-modal-filter' });
  filterSel.appendChild(el('option', { value: '', text: tr('activity_log_filter') }));
  const refreshBtn = el('button', { type: 'button', class: 'auth-primary', text: tr('activity_log_refresh') });
  toolbar.appendChild(filterSel); toolbar.appendChild(refreshBtn);
  const list = el('div', { class: 'admin-modal-list' });
  body.appendChild(toolbar); body.appendChild(list);
  box.appendChild(head); box.appendChild(body);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const closeFn = () => { try { document.body.removeChild(overlay); } catch (e) { void e; } };
  close.addEventListener('click', closeFn);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeFn(); });

  let rows = [];
  let activeFilter = '';

  const renderRows = () => {
    list.innerHTML = '';
    const filtered = activeFilter ? rows.filter((r) => r.action === activeFilter) : rows;
    if (!filtered.length) {
      list.appendChild(el('div', { class: 'admin-modal-empty', text: tr('activity_log_empty') }));
      return;
    }
    for (const r of filtered) {
      const row = el('div', { class: 'admin-modal-row' });
      row.appendChild(el('span', { class: 'col-when', text: relTime(r.created_at) }));
      row.appendChild(el('span', { class: 'col-who', text: (r.payload && r.payload.username) || (r.user_id ? r.user_id.slice(0, 8) : tr('audit_anonymous')) }));
      row.appendChild(el('span', { class: 'col-action', text: actionLabel(r.action) }));
      let details = '';
      if (r.payload && typeof r.payload === 'object') {
        const parts = [];
        for (const k of Object.keys(r.payload)) {
          if (k === 'username') continue;
          const v = r.payload[k];
          if (v === null || v === undefined) continue;
          if (typeof v === 'string') parts.push(`${k}=${v}`);
          else if (typeof v === 'number' || typeof v === 'boolean') parts.push(`${k}=${v}`);
        }
        details = parts.slice(0, 3).join(' ');
      }
      row.appendChild(el('span', { class: 'col-details', text: details }));
      list.appendChild(row);
    }
  };

  const rebuildFilter = () => {
    const cur = activeFilter;
    while (filterSel.options.length > 1) filterSel.remove(1);
    const seen = new Set();
    for (const r of rows) {
      if (!r.action || seen.has(r.action)) continue;
      seen.add(r.action);
      const o = el('option', { value: r.action, text: actionLabel(r.action) });
      filterSel.appendChild(o);
    }
    filterSel.value = cur;
  };

  const reload = async () => {
    list.innerHTML = '';
    list.appendChild(el('div', { class: 'admin-modal-empty', text: '...' }));
    try {
      const data = await getAuditLog();
      rows = Array.isArray(data) ? data : [];
    } catch (e) {
      rows = [];
    }
    rebuildFilter();
    renderRows();
  };

  filterSel.addEventListener('change', () => { activeFilter = filterSel.value; renderRows(); });
  refreshBtn.addEventListener('click', () => reload());
  reload();
}

export function openSnapshots(opts) {
  const onPreview = opts && typeof opts.onPreview === 'function' ? opts.onPreview : null;
  const onRestored = opts && typeof opts.onRestored === 'function' ? opts.onRestored : null;
  const canvasId = (opts && opts.canvasId) || 'main';

  const overlay = el('div', { class: 'auth-modal open' });
  overlay.style.zIndex = '2500';
  const box = el('div', { class: 'auth-modal-box wide' });
  const head = el('div', { class: 'auth-modal-head' });
  head.appendChild(el('h2', { text: tr('snapshots_title') }));
  const close = el('button', { type: 'button', class: 'auth-x', html: '&times;' });
  head.appendChild(close);
  const body = el('div', { class: 'auth-modal-body' });
  const list = el('div', { class: 'admin-modal-list' });
  body.appendChild(list);
  box.appendChild(head); box.appendChild(body);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const closeFn = () => { try { document.body.removeChild(overlay); } catch (e) { void e; } };
  close.addEventListener('click', closeFn);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeFn(); });

  const reload = async () => {
    list.innerHTML = '';
    list.appendChild(el('div', { class: 'admin-modal-empty', text: '...' }));
    let rows = [];
    try {
      const data = await listSnapshots(canvasId);
      rows = Array.isArray(data) ? data : [];
    } catch (e) { rows = []; }
    list.innerHTML = '';
    if (!rows.length) {
      list.appendChild(el('div', { class: 'admin-modal-empty', text: tr('snapshots_empty') }));
      return;
    }
    for (const r of rows) {
      const row = el('div', { class: 'admin-modal-row snapshot-row' });
      row.appendChild(el('span', { class: 'col-when', text: `r${r.revision}` }));
      row.appendChild(el('span', { class: 'col-who', text: r.created_by || tr('audit_anonymous') }));
      row.appendChild(el('span', { class: 'col-when', text: relTime(r.created_at) }));
      row.appendChild(el('span', { class: 'col-details', text: r.comment || '' }));
      const acts = el('div', { class: 'col-actions' });
      const prev = el('button', { type: 'button', text: tr('snapshots_preview') });
      prev.addEventListener('click', async () => {
        try {
          const snap = await getSnapshot(canvasId, r.id);
          if (onPreview) onPreview(snap);
        } catch (e) { void e; }
      });
      const restore = el('button', { type: 'button', class: 'danger', text: tr('snapshots_restore') });
      restore.addEventListener('click', () => {
        confirmRestore(r, async () => {
          try {
            const result = await restoreSnapshot(canvasId, r.id);
            if (onRestored) onRestored(result);
            closeFn();
          } catch (e) { void e; }
        });
      });
      acts.appendChild(prev); acts.appendChild(restore);
      row.appendChild(acts);
      list.appendChild(row);
    }
  };

  reload();
}

function confirmRestore(snapshot, runRestore) {
  const overlay = el('div', { class: 'auth-modal open' });
  overlay.style.zIndex = '2700';
  const box = el('div', { class: 'auth-modal-box' });
  const head = el('div', { class: 'auth-modal-head' });
  head.appendChild(el('h2', { text: tr('snapshots_restore_confirm') }));
  const x = el('button', { type: 'button', class: 'auth-x', html: '&times;' });
  head.appendChild(x);
  const body = el('div', { class: 'auth-modal-body' });
  body.appendChild(el('p', { text: tr('snapshots_restore_message', { revision: snapshot.revision }) }));
  const word = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false' });
  word.placeholder = 'RESTORE';
  body.appendChild(word);
  const actions = el('div', { class: 'auth-actions' });
  const cancel = el('button', { type: 'button', class: 'modal-btn cancel', text: tr('editor_cancel_button') });
  const ok = el('button', { type: 'button', class: 'auth-primary danger', text: tr('snapshots_restore') });
  ok.disabled = true;
  actions.appendChild(cancel); actions.appendChild(ok);
  body.appendChild(actions);
  box.appendChild(head); box.appendChild(body);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const closeFn = () => { try { document.body.removeChild(overlay); } catch (e) { void e; } };
  x.addEventListener('click', closeFn);
  cancel.addEventListener('click', closeFn);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeFn(); });
  word.addEventListener('input', () => { ok.disabled = word.value !== 'RESTORE'; });
  ok.addEventListener('click', async () => {
    if (word.value !== 'RESTORE') return;
    ok.disabled = true;
    try { await runRestore(); closeFn(); } catch (e) { ok.disabled = false; }
  });
  setTimeout(() => word.focus(), 30);
}

export function openPresence(getUsers) {
  const overlay = el('div', { class: 'auth-modal open' });
  overlay.style.zIndex = '2500';
  const box = el('div', { class: 'auth-modal-box' });
  const head = el('div', { class: 'auth-modal-head' });
  head.appendChild(el('h2', { text: tr('dropdown_online_users') }));
  const close = el('button', { type: 'button', class: 'auth-x', html: '&times;' });
  head.appendChild(close);
  const body = el('div', { class: 'auth-modal-body' });
  const list = el('div', { class: 'admin-modal-list' });
  body.appendChild(list);
  box.appendChild(head); box.appendChild(body);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const closeFn = () => {
    try { document.body.removeChild(overlay); } catch (e) { void e; }
    document.removeEventListener('presence:changed', refresh);
  };
  close.addEventListener('click', closeFn);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeFn(); });

  const refresh = () => {
    const users = typeof getUsers === 'function' ? getUsers() : [];
    list.innerHTML = '';
    if (!users.length) {
      list.appendChild(el('div', { class: 'admin-modal-empty', text: tr('presence_empty') }));
      return;
    }
    for (const u of users) {
      const row = el('div', { class: 'admin-modal-row presence-row' });
      row.appendChild(el('span', { class: 'col-who', text: u.username || tr('audit_anonymous') }));
      const when = u.connected_at ? relTime(u.connected_at) : '';
      row.appendChild(el('span', { class: 'col-when', text: when }));
      list.appendChild(row);
    }
  };

  document.addEventListener('presence:changed', refresh);
  refresh();
}
