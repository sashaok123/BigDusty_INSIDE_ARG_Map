/* Activity feed panel. Renders the last N audit_log rows for the active
   canvas as a scrollable list. Subscribes to the WS `audit:log` event for
   live updates and polls every 30s as a fallback when WS is offline. Each
   row links back to the target node via the supplied focus callback. */

import { tr } from './i18n.js';
import { getCanvasActivity, isLoggedIn as apiIsLoggedIn } from './api-client.js';

const STORAGE_KEY = 'arg_map_activity_open';
const POLL_INTERVAL_MS = 30000;
const MAX_ROWS = 50;
const STATE_VERB_KEY = {
  node_created: 'activity_action_node_created',
  node_updated: 'activity_action_node_updated',
  node_deleted: 'activity_action_node_deleted',
  edge_created: 'activity_action_edge_created',
  edge_updated: 'activity_action_edge_updated',
  edge_deleted: 'activity_action_edge_deleted',
  canvas_replaced: 'activity_action_canvas_replaced',
  canvas_restored: 'activity_action_canvas_replaced',
};

function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[<>&"']/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

function initialsFor(name) {
  const s = (name || '?').trim();
  if (!s) return '?';
  return s.charAt(0).toUpperCase();
}

function avatarColor(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const palette = ['#e83d3d', '#e88a3d', '#e8c83d', '#3de88a', '#3dc8e8', '#9a6ce8', '#2e6fe8'];
  return palette[h % palette.length];
}

function relativeTime(at) {
  if (!at) return tr('activity_just_now');
  let stamp;
  try { stamp = new Date(at).getTime(); } catch (e) { stamp = NaN; void e; }
  if (!Number.isFinite(stamp)) return tr('activity_just_now');
  const diff = Date.now() - stamp;
  if (diff < 60000) return tr('activity_just_now');
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return tr('activity_min_ago', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return tr('activity_hr_ago', { n: hours });
  const days = Math.floor(hours / 24);
  return tr('activity_day_ago', { n: days });
}

export class ActivityFeed {
  constructor(opts) {
    this.viewport = opts.viewport;
    this.canvasId = opts.canvasId || 'main';
    this.getNodes = opts.getNodes || (() => new Map());
    this.onFocusNode = opts.onFocusNode || (() => {});
    this.isLoggedIn = opts.isLoggedIn || apiIsLoggedIn;
    this.rows = [];
    this._pollTimer = null;
    this._build();
    this._wire();
    if (this._loadOpenState()) {
      this.open();
    }
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'activity-feed';
    root.className = 'activity-feed closed';
    root.innerHTML = `
      <div class="activity-head">
        <span class="activity-title">${tr('activity_title')}</span>
        <button class="activity-close" type="button" aria-label="${tr('shortcut_close')}">&times;</button>
      </div>
      <div class="activity-body"></div>
    `;
    document.body.appendChild(root);
    this.rootEl = root;
    this.bodyEl = root.querySelector('.activity-body');
    this.closeBtn = root.querySelector('.activity-close');
  }

  _wire() {
    if (this.closeBtn) this.closeBtn.addEventListener('click', () => this.close());
    document.addEventListener('audit:log', (ev) => {
      if (!ev || !ev.detail) return;
      this._ingestLive(ev.detail.entry || {});
    });
    document.addEventListener('i18n:changed', () => {
      const title = this.rootEl && this.rootEl.querySelector('.activity-title');
      if (title) title.textContent = tr('activity_title');
      if (this.isOpen()) this._render();
    });
    if (this.bodyEl) {
      this.bodyEl.addEventListener('click', (ev) => {
        const link = ev.target && ev.target.closest && ev.target.closest('[data-target-id]');
        if (!link) return;
        const id = link.dataset.targetId;
        if (id) this.onFocusNode(id);
      });
    }
  }

  isOpen() { return this.rootEl && this.rootEl.classList.contains('open'); }

  open() {
    if (!this.rootEl) return;
    this.rootEl.classList.remove('closed');
    this.rootEl.classList.add('open');
    this._saveOpenState(true);
    this.refresh();
    this._startPolling();
  }

  close() {
    if (!this.rootEl) return;
    this.rootEl.classList.remove('open');
    this.rootEl.classList.add('closed');
    this._saveOpenState(false);
    this._stopPolling();
  }

  toggle() {
    if (this.isOpen()) this.close();
    else this.open();
  }

  _saveOpenState(open) {
    try { localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch (e) { void e; }
  }

  _loadOpenState() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) { return false; }
  }

  async refresh() {
    if (!this.isLoggedIn()) {
      this.rows = [];
      this._render();
      return;
    }
    try {
      const data = await getCanvasActivity(this.canvasId, MAX_ROWS);
      if (Array.isArray(data)) {
        this.rows = data;
        this._render();
      }
    } catch (e) {
      if (e && e.kind !== 'auth_expired') console.warn('[activity-feed] refresh failed', e);
    }
  }

  _ingestLive(entry) {
    if (!entry || typeof entry !== 'object') return;
    const synth = {
      id: entry.id || `live-${Date.now()}`,
      user_id: entry.user_id || null,
      username_display: entry.username_display || '',
      action: entry.action || 'unknown',
      target_id: entry.target_id || null,
      target_label: entry.target_label || null,
      payload: entry,
      created_at: entry.created_at || new Date().toISOString(),
    };
    this.rows = [synth].concat(this.rows).slice(0, MAX_ROWS);
    if (this.isOpen()) this._render();
  }

  _startPolling() {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => this.refresh(), POLL_INTERVAL_MS);
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _render() {
    if (!this.bodyEl) return;
    if (!this.rows || !this.rows.length) {
      this.bodyEl.innerHTML = `<div class="activity-empty">${tr('activity_empty')}</div>`;
      return;
    }
    const nodes = this.getNodes();
    const html = this.rows.map((r) => {
      const username = r.username_display || 'anon';
      const verbKey = STATE_VERB_KEY[r.action] || 'activity_action_other';
      const verb = tr(verbKey);
      let label = r.target_label || r.target_id || '';
      const targetId = r.target_id || '';
      if (targetId && nodes && typeof nodes.get === 'function') {
        const n = nodes.get(targetId);
        if (n) {
          const candidate = n.label || n.title || n.slug || n.id;
          if (typeof candidate === 'string' && candidate.trim()) label = candidate.trim();
        }
      }
      const safeUsername = escapeHtml(username);
      const safeLabel = escapeHtml(label);
      const safeVerb = escapeHtml(verb);
      const initial = escapeHtml(initialsFor(username));
      const avColor = avatarColor(username);
      const time = escapeHtml(relativeTime(r.created_at));
      const targetClass = targetId ? 'activity-target activity-target-clickable' : 'activity-target';
      const dataAttr = targetId ? ` data-target-id="${escapeHtml(targetId)}"` : '';
      return `
        <div class="activity-row">
          <span class="activity-avatar" style="background:${avColor}" aria-hidden="true">${initial}</span>
          <div class="activity-meat">
            <div class="activity-line">
              <span class="activity-user">${safeUsername}</span>
              <span class="activity-verb">${safeVerb}</span>
              <span class="${targetClass}"${dataAttr}>${safeLabel || ''}</span>
            </div>
            <div class="activity-time">${time}</div>
          </div>
        </div>
      `;
    }).join('');
    this.bodyEl.innerHTML = html;
  }
}
