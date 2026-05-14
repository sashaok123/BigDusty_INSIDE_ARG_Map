/* Thin fetch wrapper for the FastAPI backend. Stores tokens in localStorage
   under `argAuth`. On 401 a single auto-refresh is attempted; if that fails
   the local auth is cleared and an `auth:expired` event fires on document so
   the UI can prompt re-login. Also exposes `subscribeAuth` for chip + edit
   gate updates and a stable `clientId` echo via the `X-Client-Id` header. */

import { API_BASE, CANVAS_ID } from './config.js';

const STORAGE_KEY = 'argAuth';
const CLIENT_ID_KEY = 'argClientId';

let _cached = null;
let _refreshing = null;
const _authSubs = new Set();

function _load() {
  if (_cached !== null) return _cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { _cached = null; return null; }
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && typeof obj.access === 'string'
        && typeof obj.refresh === 'string' && obj.user) {
      _cached = obj;
      return obj;
    }
  } catch (e) { void e; }
  _cached = null;
  return null;
}

function _persist(obj) {
  _cached = obj;
  try {
    if (obj) localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    else     localStorage.removeItem(STORAGE_KEY);
  } catch (e) { void e; }
}

function _notify(kind) {
  for (const fn of _authSubs) {
    try { fn(kind, _cached); } catch (e) { console.warn('[api-client] subscriber', e); }
  }
}

export function subscribeAuth(fn) {
  if (typeof fn !== 'function') return () => {};
  _authSubs.add(fn);
  return () => _authSubs.delete(fn);
}

export function isLoggedIn() {
  return !!_load();
}

export function getCurrentUser() {
  const a = _load();
  return a ? a.user : null;
}

export function getAccessToken() {
  const a = _load();
  return a ? a.access : null;
}

export function getClientId() {
  let id = '';
  try { id = sessionStorage.getItem(CLIENT_ID_KEY) || ''; } catch (e) { void e; }
  if (id) return id;
  id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  try { sessionStorage.setItem(CLIENT_ID_KEY, id); } catch (e) { void e; }
  return id;
}

function _hdrs(auth) {
  const h = { 'Content-Type': 'application/json', 'X-Client-Id': getClientId() };
  if (auth) {
    const t = getAccessToken();
    if (t) h['Authorization'] = `Bearer ${t}`;
  }
  return h;
}

async function _request(path, opts) {
  const url = `${API_BASE}${path}`;
  const o = opts || {};
  const auth = !!o.auth;
  const method = o.method || 'GET';
  const init = { method, headers: _hdrs(auth) };
  if (o.body !== undefined) init.body = JSON.stringify(o.body);
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    const err = new Error('network');
    err.kind = 'network';
    err.cause = e;
    throw err;
  }
  if (res.status === 401 && auth && !o._retried) {
    const ok = await _tryRefresh();
    if (ok) return _request(path, { ...o, _retried: true });
    _persist(null);
    _notify('expired');
    try { document.dispatchEvent(new CustomEvent('auth:expired')); } catch (e) { void e; }
    const err = new Error('auth_expired');
    err.kind = 'auth_expired';
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch (e) { void e; }
    const err = new Error(`http_${res.status}`);
    err.kind = 'http';
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return null;
  const ctype = res.headers.get('content-type') || '';
  if (ctype.includes('application/json')) return res.json();
  return null;
}

async function _tryRefresh() {
  if (_refreshing) return _refreshing;
  const a = _load();
  if (!a || !a.refresh) return false;
  _refreshing = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: a.refresh }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      if (!data || typeof data.access_token !== 'string') return false;
      const cur = _load();
      if (!cur) return false;
      _persist({ ...cur, access: data.access_token });
      _notify('refreshed');
      return true;
    } catch (e) {
      return false;
    } finally {
      _refreshing = null;
    }
  })();
  return _refreshing;
}

export async function login(username, password) {
  const data = await _request('/auth/login', { method: 'POST', body: { username, password } });
  if (!data || !data.access_token || !data.refresh_token || !data.user) {
    throw new Error('bad_response');
  }
  _persist({ access: data.access_token, refresh: data.refresh_token, user: data.user });
  _notify('login');
  return data.user;
}

export async function logout() {
  const a = _load();
  if (a && a.refresh) {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: a.refresh }),
      });
    } catch (e) { void e; }
  }
  _persist(null);
  _notify('logout');
}

export async function refresh() {
  return _tryRefresh();
}

export async function whoami() {
  if (!isLoggedIn()) return null;
  try {
    return await _request('/auth/me', { auth: true });
  } catch (e) {
    if (e.kind === 'auth_expired') return null;
    throw e;
  }
}

export async function changePassword(oldPw, newPw) {
  return _request('/auth/change_password', {
    method: 'POST',
    auth: true,
    body: { old_password: oldPw, new_password: newPw },
  });
}

export async function getCanvas() {
  return _request(`/canvas/${CANVAS_ID}`);
}

export async function getCanvasRevision() {
  return _request(`/canvas/${CANVAS_ID}/revision`);
}

export async function putCanvas(data, expectedRevision) {
  return _request(`/canvas/${CANVAS_ID}`, {
    method: 'PUT',
    auth: true,
    body: { data, expected_revision: expectedRevision },
  });
}

export async function createNode(node) {
  return _request(`/canvas/${CANVAS_ID}/nodes`, { method: 'POST', auth: true, body: node });
}

export async function patchNode(id, partial) {
  return _request(`/canvas/${CANVAS_ID}/nodes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    auth: true,
    body: partial,
  });
}

export async function deleteNode(id) {
  return _request(`/canvas/${CANVAS_ID}/nodes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    auth: true,
  });
}

export async function createEdge(edge) {
  return _request(`/canvas/${CANVAS_ID}/edges`, { method: 'POST', auth: true, body: edge });
}

export async function patchEdge(id, partial) {
  return _request(`/canvas/${CANVAS_ID}/edges/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    auth: true,
    body: partial,
  });
}

export async function deleteEdge(id) {
  return _request(`/canvas/${CANVAS_ID}/edges/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    auth: true,
  });
}

export async function listUsers() {
  return _request('/admin/users', { auth: true });
}

export async function createUser(username, password, isAdmin) {
  return _request('/admin/users', {
    method: 'POST',
    auth: true,
    body: { username, password, is_admin: !!isAdmin },
  });
}

export async function deleteUser(id) {
  return _request(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true });
}

export async function resetPassword(id, newPw) {
  return _request(`/admin/users/${encodeURIComponent(id)}/reset_password`, {
    method: 'POST',
    auth: true,
    body: { new_password: newPw },
  });
}

export async function setAdmin(id, isAdmin) {
  return _request(`/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    auth: true,
    body: { is_admin: !!isAdmin },
  });
}

export async function listInvitations() {
  return _request('/admin/invitations', { auth: true });
}

export async function createInvitation(username, isAdmin) {
  return _request('/admin/invitations', {
    method: 'POST',
    auth: true,
    body: { username, is_admin: !!isAdmin },
  });
}

export async function deleteInvitation(id) {
  return _request(`/admin/invitations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    auth: true,
  });
}

export async function getAuditLog() {
  return _request('/admin/audit', { auth: true });
}

export async function checkInvitation(token) {
  return _request(`/auth/invitation/${encodeURIComponent(token)}`);
}

export async function setupAccount(token, password) {
  const data = await _request('/auth/setup', {
    method: 'POST',
    body: { token, password },
  });
  if (!data || !data.access_token || !data.refresh_token || !data.user) {
    throw new Error('bad_response');
  }
  _persist({ access: data.access_token, refresh: data.refresh_token, user: data.user });
  _notify('login');
  return data.user;
}

export function absoluteImageUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || /^data:/i.test(url) || /^blob:/i.test(url)) return url;
  if (url.startsWith('/')) return `${API_BASE}${url}`;
  return url;
}

export async function uploadImage(blob, filename) {
  if (!isLoggedIn()) {
    const err = new Error('auth_required');
    err.kind = 'auth_expired';
    err.status = 401;
    throw err;
  }
  const form = new FormData();
  const name = filename || (blob && blob.name) || 'upload';
  if (blob instanceof Blob && !(blob instanceof File)) {
    form.append('file', blob, name);
  } else {
    form.append('file', blob, name);
  }
  const headers = { 'X-Client-Id': getClientId() };
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const url = `${API_BASE}/canvas/${CANVAS_ID}/images`;
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: form });
  } catch (e) {
    const err = new Error('network');
    err.kind = 'network';
    err.cause = e;
    throw err;
  }
  if (res.status === 401) {
    const ok = await _tryRefresh();
    if (ok) {
      const retryHeaders = { 'X-Client-Id': getClientId() };
      const t2 = getAccessToken();
      if (t2) retryHeaders['Authorization'] = `Bearer ${t2}`;
      try {
        res = await fetch(url, { method: 'POST', headers: retryHeaders, body: form });
      } catch (e) {
        const err = new Error('network');
        err.kind = 'network';
        err.cause = e;
        throw err;
      }
    } else {
      _persist(null);
      _notify('expired');
      try { document.dispatchEvent(new CustomEvent('auth:expired')); } catch (e) { void e; }
      const err = new Error('auth_expired');
      err.kind = 'auth_expired';
      err.status = 401;
      throw err;
    }
  }
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch (e) { void e; }
    const err = new Error(`http_${res.status}`);
    err.kind = 'http';
    err.status = res.status;
    err.body = body;
    throw err;
  }
  const data = await res.json();
  if (data && typeof data.url === 'string') {
    data.url = absoluteImageUrl(data.url);
  }
  return data;
}
