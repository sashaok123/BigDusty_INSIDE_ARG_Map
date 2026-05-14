/* Hidden login UI. Three ways to surface the login modal:
   1. Ctrl/Cmd+Shift+L anywhere
   2. tiny `?` icon bottom-right (low opacity by default)
   3. URL flag `?login`
   After login a user chip appears in the toolbar with a dropdown
   (Change password / Logout / [admin] Manage users). */

import {
  login, logout, changePassword, listUsers, createUser, deleteUser,
  resetPassword, setAdmin, subscribeAuth, getCurrentUser, isLoggedIn,
} from './api-client.js';
import { tr } from './i18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function $(id) { return document.getElementById(id); }

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

function svgIcon() {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', '14');
  s.setAttribute('height', '14');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('d', 'M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 5a3 3 0 1 1 6 0v3H9V7zm3 7a2 2 0 0 1 1 3.74V19a1 1 0 1 1-2 0v-1.26A2 2 0 0 1 12 14z');
  s.appendChild(p);
  return s;
}

export class AuthUI {
  constructor(opts) {
    this.toolbarEl = opts.toolbarEl;
    this.afterModeSwitchEl = opts.afterModeSwitchEl;
    this.onLogin  = opts.onLogin  || (() => {});
    this.onLogout = opts.onLogout || (() => {});
    this._open = false;

    this._buildLoginModal();
    this._buildChangePwModal();
    this._buildManageUsersModal();
    this._buildLoginIcon();
    this._buildUserChip();

    document.addEventListener('keydown', (e) => this._onGlobalKey(e));
    document.addEventListener('auth:expired', () => this._onAuthExpired());
    document.addEventListener('i18n:changed', () => this._retranslate());

    subscribeAuth((kind) => {
      if (kind === 'login' || kind === 'logout') this._syncChip();
    });
    this._syncChip();

    if (/[?&]login(=|&|$)/.test(location.search)) {
      setTimeout(() => this.openLogin(), 50);
    }
  }

  _onGlobalKey(e) {
    const key = e.key && e.key.toLowerCase ? e.key.toLowerCase() : e.key;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'l') {
      e.preventDefault();
      this.openLogin();
    }
  }

  _onAuthExpired() {
    this._syncChip();
    this.openLogin(tr('login_error_credentials'));
  }

  _buildLoginIcon() {
    const a = el('button', {
      id: 'auth-login-icon',
      type: 'button',
      title: tr('login_title'),
      'aria-label': tr('login_title'),
      onclick: () => this.openLogin(),
    });
    a.appendChild(svgIcon());
    document.body.appendChild(a);
    this.loginIconEl = a;
  }

  _buildLoginModal() {
    const modal = el('div', { id: 'auth-login-modal', class: 'auth-modal' });
    const box   = el('div', { class: 'auth-modal-box' });
    const head  = el('div', { class: 'auth-modal-head' });
    const titleEl = el('h2', { text: tr('login_title') });
    const close = el('button', { type: 'button', class: 'auth-x', 'aria-label': tr('side_panel_close'), html: '&times;',
      onclick: () => this.closeLogin() });
    head.appendChild(titleEl); head.appendChild(close);
    const body = el('div', { class: 'auth-modal-body' });
    const userLabel = el('label', { text: tr('login_username') });
    const userIn = el('input', { type: 'text', autocomplete: 'username', spellcheck: 'false' });
    const pwLabel = el('label', { text: tr('login_password') });
    const pwIn = el('input', { type: 'password', autocomplete: 'current-password' });
    const err = el('div', { class: 'auth-error' });
    const actions = el('div', { class: 'auth-actions' });
    const submit = el('button', { type: 'button', class: 'auth-primary', text: tr('login_submit'),
      onclick: () => this._doLogin() });
    actions.appendChild(submit);
    body.appendChild(userLabel); body.appendChild(userIn);
    body.appendChild(pwLabel);   body.appendChild(pwIn);
    body.appendChild(err);       body.appendChild(actions);
    box.appendChild(head); box.appendChild(body);
    modal.appendChild(box);
    document.body.appendChild(modal);

    modal.addEventListener('mousedown', (e) => { if (e.target === modal) this.closeLogin(); });
    [userIn, pwIn].forEach((i) => i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._doLogin(); }
    }));

    this.loginModalEl   = modal;
    this.loginTitleEl   = titleEl;
    this.loginUserLabel = userLabel;
    this.loginUserIn    = userIn;
    this.loginPwLabel   = pwLabel;
    this.loginPwIn      = pwIn;
    this.loginErrEl     = err;
    this.loginSubmitEl  = submit;
    this.loginCloseEl   = close;
  }

  openLogin(msg) {
    this._open = true;
    this.loginErrEl.textContent = msg || '';
    this.loginUserIn.value = '';
    this.loginPwIn.value = '';
    this.loginModalEl.classList.add('open');
    setTimeout(() => this.loginUserIn.focus(), 30);
  }

  closeLogin() {
    this._open = false;
    this.loginModalEl.classList.remove('open');
  }

  isOpen() { return this._open; }

  async _doLogin() {
    const u = this.loginUserIn.value.trim();
    const p = this.loginPwIn.value;
    if (!u || !p) { this.loginErrEl.textContent = tr('login_error_credentials'); return; }
    this.loginSubmitEl.disabled = true;
    this.loginErrEl.textContent = '';
    try {
      const user = await login(u, p);
      this.closeLogin();
      this.onLogin(user);
    } catch (e) {
      if (e && e.kind === 'network') this.loginErrEl.textContent = tr('login_error_network');
      else this.loginErrEl.textContent = tr('login_error_credentials');
    } finally {
      this.loginSubmitEl.disabled = false;
    }
  }

  _buildUserChip() {
    const chip = el('div', { id: 'auth-user-chip' });
    const text = el('span', { class: 'chip-name' });
    const caret = el('span', { class: 'chip-caret', html: '&#9662;' });
    chip.appendChild(text); chip.appendChild(caret);
    chip.addEventListener('click', (e) => { e.stopPropagation(); this._toggleMenu(); });
    const ref = this.afterModeSwitchEl;
    if (ref && ref.parentNode) {
      ref.parentNode.insertBefore(chip, ref.nextSibling);
    } else {
      this.toolbarEl.appendChild(chip);
    }
    this.chipEl = chip; this.chipNameEl = text;

    const menu = el('div', { id: 'auth-user-menu' });
    document.body.appendChild(menu);
    this.menuEl = menu;
    document.addEventListener('mousedown', (e) => {
      if (this.menuEl.classList.contains('open')
          && !this.menuEl.contains(e.target) && !chip.contains(e.target)) {
        this._closeMenu();
      }
    });
  }

  _toggleMenu() {
    if (this.menuEl.classList.contains('open')) { this._closeMenu(); return; }
    this._populateMenu();
    const r = this.chipEl.getBoundingClientRect();
    this.menuEl.style.top = `${r.bottom + 4}px`;
    this.menuEl.style.right = `${window.innerWidth - r.right}px`;
    this.menuEl.classList.add('open');
  }

  _closeMenu() { this.menuEl.classList.remove('open'); }

  _populateMenu() {
    const u = getCurrentUser();
    this.menuEl.innerHTML = '';
    const mk = (label, fn, danger) => {
      const b = el('button', { type: 'button', text: label, onclick: () => { this._closeMenu(); fn(); } });
      if (danger) b.classList.add('danger');
      return b;
    };
    this.menuEl.appendChild(mk(tr('change_password_title'), () => this._openChangePw()));
    if (u && u.is_admin) this.menuEl.appendChild(mk(tr('manage_users'), () => this._openManageUsers()));
    this.menuEl.appendChild(mk(tr('logout'), () => this._doLogout(), true));
  }

  async _doLogout() {
    await logout();
    this.onLogout();
  }

  _syncChip() {
    const u = getCurrentUser();
    if (u) {
      this.chipNameEl.textContent = u.username;
      this.chipEl.classList.add('open');
      this.loginIconEl.classList.add('hidden');
    } else {
      this.chipEl.classList.remove('open');
      this.loginIconEl.classList.remove('hidden');
      this._closeMenu();
    }
  }

  _buildChangePwModal() {
    const modal = el('div', { id: 'auth-changepw-modal', class: 'auth-modal' });
    const box = el('div', { class: 'auth-modal-box' });
    const head = el('div', { class: 'auth-modal-head' });
    const titleEl = el('h2', { text: tr('change_password_title') });
    const close = el('button', { type: 'button', class: 'auth-x', html: '&times;',
      onclick: () => modal.classList.remove('open') });
    head.appendChild(titleEl); head.appendChild(close);
    const body = el('div', { class: 'auth-modal-body' });
    const oldLabel = el('label', { text: tr('change_password_old') });
    const oldIn = el('input', { type: 'password', autocomplete: 'current-password' });
    const newLabel = el('label', { text: tr('change_password_new') });
    const newIn = el('input', { type: 'password', autocomplete: 'new-password' });
    const confLabel = el('label', { text: tr('change_password_confirm') });
    const confIn = el('input', { type: 'password', autocomplete: 'new-password' });
    const err = el('div', { class: 'auth-error' });
    const actions = el('div', { class: 'auth-actions' });
    const submit = el('button', { type: 'button', class: 'auth-primary', text: tr('change_password_title') });
    actions.appendChild(submit);
    body.appendChild(oldLabel); body.appendChild(oldIn);
    body.appendChild(newLabel); body.appendChild(newIn);
    body.appendChild(confLabel); body.appendChild(confIn);
    body.appendChild(err); body.appendChild(actions);
    box.appendChild(head); box.appendChild(body);
    modal.appendChild(box);
    document.body.appendChild(modal);

    submit.addEventListener('click', async () => {
      err.textContent = '';
      if (newIn.value.length < 8) { err.textContent = tr('login_error_credentials'); return; }
      if (newIn.value !== confIn.value) { err.textContent = tr('login_error_credentials'); return; }
      submit.disabled = true;
      try {
        await changePassword(oldIn.value, newIn.value);
        modal.classList.remove('open');
        oldIn.value = newIn.value = confIn.value = '';
        if (typeof this.onMessage === 'function') this.onMessage(tr('change_password_success'));
      } catch (e) {
        if (e && e.kind === 'network') err.textContent = tr('login_error_network');
        else err.textContent = tr('login_error_credentials');
      } finally {
        submit.disabled = false;
      }
    });
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) modal.classList.remove('open'); });
    [oldIn, newIn, confIn].forEach((i) => i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit.click(); }
    }));

    this.changePwModalEl = modal;
    this.changePwTitleEl = titleEl;
    this.changePwLabels = { old: oldLabel, neu: newLabel, conf: confLabel };
    this.changePwSubmitEl = submit;
    this.changePwOldIn = oldIn; this.changePwNewIn = newIn; this.changePwConfIn = confIn;
  }

  _openChangePw() {
    this.changePwOldIn.value = '';
    this.changePwNewIn.value = '';
    this.changePwConfIn.value = '';
    this.changePwModalEl.classList.add('open');
    setTimeout(() => this.changePwOldIn.focus(), 30);
  }

  _buildManageUsersModal() {
    const modal = el('div', { id: 'auth-users-modal', class: 'auth-modal' });
    const box = el('div', { class: 'auth-modal-box wide' });
    const head = el('div', { class: 'auth-modal-head' });
    const titleEl = el('h2', { text: tr('manage_users') });
    const close = el('button', { type: 'button', class: 'auth-x', html: '&times;',
      onclick: () => modal.classList.remove('open') });
    head.appendChild(titleEl); head.appendChild(close);
    const body = el('div', { class: 'auth-modal-body' });

    const addRow = el('div', { class: 'auth-users-add' });
    const addUser = el('input', { type: 'text', placeholder: tr('login_username') });
    const addPw   = el('input', { type: 'password', placeholder: tr('login_password') });
    const addAdminWrap = el('label', { class: 'auth-checkbox' });
    const addAdmin = el('input', { type: 'checkbox' });
    addAdminWrap.appendChild(addAdmin);
    addAdminWrap.appendChild(document.createTextNode(' admin'));
    const addBtn  = el('button', { type: 'button', class: 'auth-primary', text: tr('user_add') });
    addRow.appendChild(addUser); addRow.appendChild(addPw);
    addRow.appendChild(addAdminWrap); addRow.appendChild(addBtn);

    const list = el('div', { class: 'auth-users-list' });
    const err = el('div', { class: 'auth-error' });

    body.appendChild(addRow); body.appendChild(err); body.appendChild(list);
    box.appendChild(head); box.appendChild(body);
    modal.appendChild(box);
    document.body.appendChild(modal);

    const reload = async () => {
      err.textContent = '';
      list.innerHTML = '';
      try {
        const users = await listUsers();
        for (const u of users) list.appendChild(this._renderUserRow(u, reload));
      } catch (e) {
        if (e && e.kind === 'network') err.textContent = tr('login_error_network');
        else err.textContent = tr('login_error_credentials');
      }
    };

    addBtn.addEventListener('click', async () => {
      err.textContent = '';
      const u = addUser.value.trim();
      const p = addPw.value;
      if (!u || p.length < 8) { err.textContent = tr('login_error_credentials'); return; }
      addBtn.disabled = true;
      try {
        await createUser(u, p, addAdmin.checked);
        addUser.value = ''; addPw.value = ''; addAdmin.checked = false;
        await reload();
      } catch (e) {
        if (e && e.kind === 'network') err.textContent = tr('login_error_network');
        else err.textContent = tr('login_error_credentials');
      } finally {
        addBtn.disabled = false;
      }
    });

    modal.addEventListener('mousedown', (e) => { if (e.target === modal) modal.classList.remove('open'); });

    this.usersModalEl = modal;
    this.usersTitleEl = titleEl;
    this.usersAddBtnEl = addBtn;
    this.usersAddUserIn = addUser;
    this.usersAddPwIn = addPw;
    this._reloadUsers = reload;
  }

  _renderUserRow(u, reload) {
    const row = el('div', { class: 'auth-user-row' });
    const name = el('span', { class: 'auth-user-name', text: u.username });
    if (u.is_admin) {
      const badge = el('span', { class: 'auth-admin-badge', text: 'admin' });
      name.appendChild(badge);
    }
    const acts = el('div', { class: 'auth-user-actions' });
    const reset = el('button', { type: 'button', text: tr('user_reset_password'), onclick: async () => {
      const np = prompt(tr('change_password_new'));
      if (!np || np.length < 8) return;
      try { await resetPassword(u.id, np); } catch (e) { void e; }
    }});
    const toggle = el('button', { type: 'button', text: tr('user_toggle_admin'), onclick: async () => {
      try { await setAdmin(u.id, !u.is_admin); await reload(); } catch (e) { void e; }
    }});
    const me = getCurrentUser();
    const del = el('button', { type: 'button', class: 'danger', text: tr('user_delete'), onclick: async () => {
      try { await deleteUser(u.id); await reload(); } catch (e) { void e; }
    }});
    if (me && me.id === u.id) del.disabled = true;
    acts.appendChild(reset); acts.appendChild(toggle); acts.appendChild(del);
    row.appendChild(name); row.appendChild(acts);
    return row;
  }

  async _openManageUsers() {
    this.usersModalEl.classList.add('open');
    if (typeof this._reloadUsers === 'function') this._reloadUsers();
  }

  _retranslate() {
    this.loginIconEl.setAttribute('title', tr('login_title'));
    this.loginIconEl.setAttribute('aria-label', tr('login_title'));
    this.loginTitleEl.textContent = tr('login_title');
    this.loginUserLabel.textContent = tr('login_username');
    this.loginPwLabel.textContent = tr('login_password');
    this.loginSubmitEl.textContent = tr('login_submit');
    this.changePwTitleEl.textContent = tr('change_password_title');
    this.changePwLabels.old.textContent = tr('change_password_old');
    this.changePwLabels.neu.textContent = tr('change_password_new');
    this.changePwLabels.conf.textContent = tr('change_password_confirm');
    this.changePwSubmitEl.textContent = tr('change_password_title');
    this.usersTitleEl.textContent = tr('manage_users');
    this.usersAddBtnEl.textContent = tr('user_add');
    this.usersAddUserIn.placeholder = tr('login_username');
    this.usersAddPwIn.placeholder = tr('login_password');
    if (isLoggedIn()) this._populateMenu();
  }
}
