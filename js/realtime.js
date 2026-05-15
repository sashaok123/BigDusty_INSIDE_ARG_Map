/* WebSocket subscriber for live canvas updates. Reconnects with exponential
   backoff, exposes a small status surface (connected/connecting/offline) and
   fires `realtime:change` on document after every applied event. If the
   server jumps the revision by more than 1 a full canvas re-fetch is
   triggered via the supplied `onResync` callback. Also handles presence
   broadcasts (`presence`) and emits `presence_hello` on connect; presence
   events are forwarded to document as `presence:update`. */

import { wsBase, CANVAS_ID, isPlaceholderApiBase } from './config.js';
import { getAccessToken, getCanvas, getCurrentUser, subscribeAuth, getClientId } from './api-client.js';

const BACKOFF_STEPS = [1000, 2000, 4000, 10000];

export class Realtime {
  constructor(opts) {
    this.onChange = opts.onChange || (() => {});
    this.onResync = opts.onResync || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.getRevision = opts.getRevision || (() => 0);
    this.enabled = !isPlaceholderApiBase();
    this._ws = null;
    this._closedByUs = false;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._lastStatus = '';

    subscribeAuth(() => {
      if (this.enabled) this._reconnectNow();
    });
  }

  start() {
    if (!this.enabled) { this._setStatus('offline'); return; }
    this._connect();
  }

  stop() {
    this._closedByUs = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    if (this._ws) { try { this._ws.close(); } catch (e) { void e; } this._ws = null; }
    this._setStatus('offline');
  }

  setEnabled(flag) {
    this.enabled = !!flag;
    if (!this.enabled) this.stop();
  }

  isConnected() { return !!(this._ws && this._ws.readyState === WebSocket.OPEN); }

  send(message) {
    if (!this.isConnected() || !message) return false;
    try {
      this._ws.send(JSON.stringify(message));
      return true;
    } catch (e) {
      console.warn('[realtime] send failed', e);
      return false;
    }
  }

  _setStatus(s) {
    if (s === this._lastStatus) return;
    this._lastStatus = s;
    this.onStatus(s);
  }

  _reconnectNow() {
    this._closedByUs = false;
    if (this._ws) {
      try { this._ws.close(); } catch (e) { void e; }
      this._ws = null;
    }
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._reconnectAttempts = 0;
    this._connect();
  }

  _connect() {
    if (!this.enabled) { this._setStatus('offline'); return; }
    this._setStatus('connecting');
    const tok = getAccessToken();
    const q = tok ? `?token=${encodeURIComponent(tok)}` : '';
    const url = `${wsBase()}/ws/canvas/${encodeURIComponent(CANVAS_ID)}${q}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }
    this._ws = ws;
    ws.addEventListener('open', () => {
      this._reconnectAttempts = 0;
      this._setStatus('connected');
      try {
        const u = getCurrentUser();
        ws.send(JSON.stringify({
          type: 'presence_hello',
          client_id: getClientId(),
          username: u && u.username ? u.username : 'anonymous',
        }));
      } catch (e) { void e; }
    });
    ws.addEventListener('message', (ev) => this._onMessage(ev));
    ws.addEventListener('close', () => {
      this._ws = null;
      this._setStatus('offline');
      if (!this._closedByUs) this._scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      try { ws.close(); } catch (e) { void e; }
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    const i = Math.min(this._reconnectAttempts, BACKOFF_STEPS.length - 1);
    const delay = BACKOFF_STEPS[i];
    this._reconnectAttempts += 1;
    this._setStatus('connecting');
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, delay);
  }

  async _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') {
      const local = this.getRevision();
      if (typeof msg.revision === 'number' && msg.revision !== local) {
        await this._fullResync();
      }
      return;
    }
    if (msg.type === 'presence') {
      try {
        document.dispatchEvent(new CustomEvent('presence:update', {
          detail: { users: Array.isArray(msg.users) ? msg.users : [] },
        }));
      } catch (e) { void e; }
      return;
    }
    if (msg.type === 'audit_log') {
      try {
        document.dispatchEvent(new CustomEvent('audit:log', { detail: { entry: msg.entry || {} } }));
      } catch (e) { void e; }
      return;
    }
    if (msg.type === 'node_locked' || msg.type === 'node_unlocked') {
      try {
        document.dispatchEvent(new CustomEvent('node:lock', {
          detail: {
            kind: msg.type,
            nodeId: msg.node_id || msg.nodeId || null,
            username: msg.username || '',
            clientId: msg.client_id || msg.clientId || null,
            selfClientId: getClientId(),
          },
        }));
      } catch (e) { void e; }
      return;
    }
    if (msg.type !== 'revision') return;
    const local = this.getRevision();
    const rev = msg.revision;
    if (typeof rev !== 'number') return;
    if (rev - local > 1) {
      await this._fullResync();
      return;
    }
    const change = msg.change || {};
    const payload = {
      revision: rev,
      kind: change.kind,
      id: change.id,
      data: change.data,
      by: msg.by || '',
      clientId: change.clientId || null,
      selfClientId: getClientId(),
    };
    try { this.onChange(payload); } catch (e) { console.warn('[realtime] change handler', e); }
    try { document.dispatchEvent(new CustomEvent('realtime:change', { detail: payload })); } catch (e) { void e; }
  }

  async _fullResync() {
    try {
      const data = await getCanvas();
      if (!data) return;
      this.onResync(data);
    } catch (e) {
      void e;
    }
  }
}
