/* Presence: shows tiny avatars for currently-online users in the top toolbar.
   Listens to realtime:change events as well as raw presence broadcasts via a
   `presence:update` CustomEvent. The server emits {type:"presence", users:[]}
   over the same WebSocket channel; realtime.js forwards those events. */

import { tr } from './i18n.js';

function el(tag, attrs) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
  }
  return e;
}

function initials(name) {
  if (!name) return '?';
  const trimmed = String(name).trim();
  if (!trimmed) return '?';
  if (trimmed.toLowerCase() === 'anonymous') return 'A';
  const c = trimmed.charAt(0).toUpperCase();
  return c || '?';
}

function colorFromName(name) {
  if (!name) return null;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 64% 48%)`;
}

export class PresencePanel {
  constructor(opts) {
    this.mountEl = opts.mountEl || document.getElementById('presence-badges');
    this.users = [];
    document.addEventListener('presence:update', (ev) => {
      const list = ev && ev.detail && Array.isArray(ev.detail.users) ? ev.detail.users : [];
      this.setUsers(list);
    });
    document.addEventListener('i18n:changed', () => this._render());
  }

  setUsers(users) {
    this.users = (users || []).map((u) => ({
      client_id: u && u.client_id ? String(u.client_id) : '',
      username: u && u.username ? String(u.username) : 'anonymous',
      connected_at: u && u.connected_at ? u.connected_at : null,
    }));
    this._render();
    try {
      document.dispatchEvent(new CustomEvent('presence:changed', { detail: { users: this.users } }));
    } catch (e) { void e; }
  }

  getUsers() { return this.users.slice(); }

  _render() {
    if (!this.mountEl) return;
    this.mountEl.innerHTML = '';
    const seen = new Set();
    for (const u of this.users) {
      if (seen.has(u.username)) continue;
      seen.add(u.username);
      const isAnon = !u.username || u.username.toLowerCase() === 'anonymous';
      const avatar = el('span', {
        class: isAnon ? 'presence-avatar anon' : 'presence-avatar',
        title: tr('presence_hover', { username: u.username }),
        'aria-label': u.username,
        text: initials(u.username),
      });
      const c = colorFromName(u.username);
      if (c && !isAnon) avatar.style.background = c;
      this.mountEl.appendChild(avatar);
    }
  }
}
