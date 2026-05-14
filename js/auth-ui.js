/* Login + account UI. Toolbar Sign in button (visible when not authed) and
   user chip with dropdown (Change password / Logout / [admin] Manage users).
   Ctrl/Cmd+Shift+L still opens the login modal. URL flag `?login` works too.
   Admin's Manage users modal has a Users tab and an Invitations tab. */

import {
  login, logout, changePassword, listUsers, createUser, deleteUser,
  resetPassword, setAdmin, subscribeAuth, getCurrentUser, isLoggedIn,
  listInvitations, createInvitation, deleteInvitation,
  checkInvitation, setupAccount,
} from './api-client.js';
import { tr } from './i18n.js';

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

export class AuthUI {
  constructor(opts) {
    this.toolbarEl = opts.toolbarEl;
    this.afterModeSwitchEl = opts.afterModeSwitchEl;
    this.onLogin  = opts.onLogin  || (() => {});
    this.onLogout = opts.onLogout || (() => {});
    this.onMessage = opts.onMessage || (() => {});
    this.adminHandlers = opts.adminHandlers || {};
    this._open = false;
    this._activeTab = 'users';

    this._buildLoginModal();
    this._buildChangePwModal();
    this._buildManageUsersModal();
    this._buildSignInButton();
    this._buildUserChip();
    this._buildSetupModal();

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
    this._checkInviteParam();
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

  _buildSignInButton() {
    const btn = el('button', {
      id: 'auth-signin-btn',
      class: 'tb-btn auth-signin',
      type: 'button',
      title: tr('login_title'),
      'aria-label': tr('login_title'),
      onclick: () => this.openLogin(),
    });
    btn.textContent = tr('sign_in_button');
    const zoneRight = document.querySelector('#toolbar .tb-zone-right');
    if (zoneRight) {
      zoneRight.appendChild(btn);
    } else if (this.toolbarEl) {
      this.toolbarEl.appendChild(btn);
    }
    this.signInBtnEl = btn;
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
    const zoneRight = document.querySelector('#toolbar .tb-zone-right');
    if (zoneRight) {
      zoneRight.appendChild(chip);
    } else if (this.afterModeSwitchEl && this.afterModeSwitchEl.parentNode) {
      this.afterModeSwitchEl.parentNode.insertBefore(chip, this.afterModeSwitchEl.nextSibling);
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
    const mk = (label, fn, opts) => {
      const o = opts || {};
      const b = el('button', { type: 'button', text: label, onclick: () => { this._closeMenu(); fn(); } });
      if (o.danger) b.classList.add('danger');
      if (o.divider) b.classList.add('divider');
      return b;
    };
    this.menuEl.appendChild(mk(tr('dropdown_change_password'), () => this._openChangePw()));
    if (u && u.is_admin) {
      this.menuEl.appendChild(mk(tr('dropdown_manage_users'), () => this._openManageUsers()));
      const h = this.adminHandlers || {};
      this.menuEl.appendChild(mk(tr('dropdown_activity_log'), () => { if (h.onOpenActivityLog) h.onOpenActivityLog(); }));
      this.menuEl.appendChild(mk(tr('dropdown_online_users'), () => { if (h.onOpenPresence) h.onOpenPresence(); }));
      this.menuEl.appendChild(mk(tr('dropdown_snapshots'),    () => { if (h.onOpenSnapshots) h.onOpenSnapshots(); }, { divider: true }));
      this.menuEl.appendChild(mk(tr('dropdown_download_snapshot'), () => { if (h.onDownloadSnapshot) h.onDownloadSnapshot(); }));
      this.menuEl.appendChild(mk(tr('dropdown_import'), () => { if (h.onImportCanvas) h.onImportCanvas(); }));
      this.menuEl.appendChild(mk(tr('dropdown_reset'),  () => { if (h.onResetDefaults) h.onResetDefaults(); }, { danger: true }));
    }
    this.menuEl.appendChild(mk(tr('dropdown_logout'), () => this._doLogout(), { danger: true, divider: true }));
  }

  refreshAdmin() {
    if (this.menuEl && this.menuEl.classList.contains('open')) this._populateMenu();
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
      if (this.signInBtnEl) this.signInBtnEl.classList.add('hidden');
    } else {
      this.chipEl.classList.remove('open');
      if (this.signInBtnEl) this.signInBtnEl.classList.remove('hidden');
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
      if (newIn.value.length < 8) { err.textContent = tr('setup_account_password_too_short'); return; }
      if (newIn.value !== confIn.value) { err.textContent = tr('setup_account_passwords_must_match'); return; }
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
    const titleEl = el('h2', { text: tr('dropdown_manage_users') });
    const close = el('button', { type: 'button', class: 'auth-x', html: '&times;',
      onclick: () => modal.classList.remove('open') });
    head.appendChild(titleEl); head.appendChild(close);

    const tabs = el('div', { class: 'auth-tabs' });
    const tabUsers = el('button', { type: 'button', class: 'auth-tab active', text: tr('admin_tab_users'),
      onclick: () => this._switchUsersTab('users') });
    const tabInv = el('button', { type: 'button', class: 'auth-tab', text: tr('admin_tab_invitations'),
      onclick: () => this._switchUsersTab('invitations') });
    tabs.appendChild(tabUsers); tabs.appendChild(tabInv);

    const body = el('div', { class: 'auth-modal-body' });
    const usersPane = el('div', { class: 'auth-tab-pane', 'data-tab': 'users' });
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
    usersPane.appendChild(addRow); usersPane.appendChild(err); usersPane.appendChild(list);

    const invPane = el('div', { class: 'auth-tab-pane', 'data-tab': 'invitations' });
    invPane.style.display = 'none';
    const invAddRow = el('div', { class: 'auth-users-add' });
    const invAddUser = el('input', { type: 'text', placeholder: tr('admin_invitation_username') });
    const invAddAdminWrap = el('label', { class: 'auth-checkbox' });
    const invAddAdmin = el('input', { type: 'checkbox' });
    invAddAdminWrap.appendChild(invAddAdmin);
    invAddAdminWrap.appendChild(document.createTextNode(' admin'));
    const invAddBtn = el('button', { type: 'button', class: 'auth-primary', text: tr('admin_invitation_generate') });
    invAddRow.appendChild(invAddUser); invAddRow.appendChild(invAddAdminWrap); invAddRow.appendChild(invAddBtn);

    const invResultRow = el('div', { class: 'auth-invite-result' });
    invResultRow.style.display = 'none';
    const invResultLabel = el('div', { class: 'auth-invite-label', text: tr('admin_invitation_url') });
    const invResultUrlIn = el('input', { type: 'text', readonly: 'readonly' });
    const invResultCopy = el('button', { type: 'button', class: 'auth-primary', text: tr('admin_invitation_copy') });
    invResultRow.appendChild(invResultLabel); invResultRow.appendChild(invResultUrlIn); invResultRow.appendChild(invResultCopy);

    const invErr = el('div', { class: 'auth-error' });
    const invList = el('div', { class: 'auth-invitations-list' });
    invPane.appendChild(invAddRow); invPane.appendChild(invResultRow); invPane.appendChild(invErr); invPane.appendChild(invList);

    body.appendChild(usersPane); body.appendChild(invPane);
    box.appendChild(head); box.appendChild(tabs); box.appendChild(body);
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
      if (!u || p.length < 8) { err.textContent = tr('setup_account_password_too_short'); return; }
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

    const reloadInvitations = async () => {
      invErr.textContent = '';
      invList.innerHTML = '';
      try {
        const rows = await listInvitations();
        for (const r of rows) invList.appendChild(this._renderInvitationRow(r, reloadInvitations));
      } catch (e) {
        if (e && e.kind === 'network') invErr.textContent = tr('login_error_network');
        else invErr.textContent = tr('login_error_credentials');
      }
    };

    invAddBtn.addEventListener('click', async () => {
      invErr.textContent = '';
      const u = invAddUser.value.trim();
      if (!u) { invErr.textContent = tr('setup_account_invalid_token'); return; }
      invAddBtn.disabled = true;
      try {
        const result = await createInvitation(u, invAddAdmin.checked);
        invAddUser.value = '';
        invAddAdmin.checked = false;
        if (result && result.setup_url) {
          invResultUrlIn.value = result.setup_url;
          invResultRow.style.display = 'flex';
          invResultUrlIn.focus();
          invResultUrlIn.select();
        }
        await reloadInvitations();
      } catch (e) {
        if (e && e.kind === 'network') invErr.textContent = tr('login_error_network');
        else if (e && e.status === 409) invErr.textContent = tr('login_error_credentials');
        else invErr.textContent = tr('login_error_credentials');
      } finally {
        invAddBtn.disabled = false;
      }
    });

    invResultCopy.addEventListener('click', async () => {
      const v = invResultUrlIn.value;
      if (!v) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(v);
        } else {
          invResultUrlIn.focus(); invResultUrlIn.select();
          document.execCommand('copy');
        }
        invResultCopy.textContent = tr('admin_invitation_copied');
        setTimeout(() => { invResultCopy.textContent = tr('admin_invitation_copy'); }, 1500);
      } catch (e) { void e; }
    });

    modal.addEventListener('mousedown', (e) => { if (e.target === modal) modal.classList.remove('open'); });

    this.usersModalEl = modal;
    this.usersTitleEl = titleEl;
    this.usersTabsEl = tabs;
    this.usersTabUsersBtn = tabUsers;
    this.usersTabInvBtn = tabInv;
    this.usersPaneEl = usersPane;
    this.usersInvPaneEl = invPane;
    this.usersAddBtnEl = addBtn;
    this.usersAddUserIn = addUser;
    this.usersAddPwIn = addPw;
    this.invAddUserIn = invAddUser;
    this.invAddBtnEl = invAddBtn;
    this.invResultLabelEl = invResultLabel;
    this.invResultCopyEl = invResultCopy;
    this.invResultRowEl = invResultRow;
    this.invResultUrlIn = invResultUrlIn;
    this._reloadUsers = reload;
    this._reloadInvitations = reloadInvitations;
  }

  _switchUsersTab(tab) {
    this._activeTab = tab;
    const isUsers = tab === 'users';
    this.usersTabUsersBtn.classList.toggle('active', isUsers);
    this.usersTabInvBtn.classList.toggle('active', !isUsers);
    this.usersPaneEl.style.display = isUsers ? 'block' : 'none';
    this.usersInvPaneEl.style.display = isUsers ? 'none' : 'block';
    if (!isUsers && typeof this._reloadInvitations === 'function') {
      this._reloadInvitations();
    }
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
    const toggleLabel = u.is_admin ? tr('user_revoke_admin') : tr('user_grant_admin');
    const toggle = el('button', { type: 'button', text: toggleLabel, onclick: async () => {
      const grant = !u.is_admin;
      const word = grant ? tr('user_admin_grant_word') : tr('user_admin_revoke_word');
      const titleK = grant ? 'user_grant_admin_title' : 'user_revoke_admin_title';
      const messageK = grant ? 'user_grant_admin_message' : 'user_revoke_admin_message';
      this._showAdminToggleConfirm({
        title: tr(titleK),
        message: tr(messageK, { username: u.username }),
        word,
        onConfirm: async () => {
          try { await setAdmin(u.id, grant); await reload(); }
          catch (e) { void e; }
        },
      });
    }});
    const me = getCurrentUser();
    const del = el('button', { type: 'button', class: 'danger', text: tr('user_delete'), onclick: async () => {
      const msg = `${tr('user_delete')}: ${u.username}\n${tr('delete_user_irreversible')}`;
      if (!confirm(msg)) return;
      try { await deleteUser(u.id); await reload(); } catch (e) { void e; }
    }});
    if (me && me.id === u.id) { del.disabled = true; toggle.disabled = true; }
    acts.appendChild(reset); acts.appendChild(toggle); acts.appendChild(del);
    row.appendChild(name); row.appendChild(acts);
    return row;
  }

  _showAdminToggleConfirm(opts) {
    const o = opts || {};
    const overlay = el('div', { class: 'auth-modal open' });
    overlay.style.zIndex = '2700';
    const box = el('div', { class: 'auth-modal-box' });
    const head = el('div', { class: 'auth-modal-head' });
    const titleEl = el('h2', { text: o.title || tr('user_admin_confirm_title') });
    const closeBtn = el('button', { type: 'button', class: 'auth-x', html: '&times;' });
    head.appendChild(titleEl); head.appendChild(closeBtn);
    const body = el('div', { class: 'auth-modal-body' });
    const msg = el('p', { class: 'auth-confirm-text', text: o.message || '' });
    const hint = el('p', { class: 'auth-confirm-hint',
      text: tr('user_admin_confirm_hint', { word: o.word }) });
    const input = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false' });
    input.placeholder = o.word;
    const err = el('div', { class: 'auth-error' });
    const actions = el('div', { class: 'auth-actions' });
    const cancelBtn = el('button', { type: 'button', class: 'modal-btn cancel', text: tr('editor_cancel_button') });
    const okBtn = el('button', { type: 'button', class: 'auth-primary', text: o.confirmLabel || tr('user_admin_confirm_apply') });
    okBtn.disabled = true;
    actions.appendChild(cancelBtn); actions.appendChild(okBtn);
    body.appendChild(msg); body.appendChild(hint); body.appendChild(input);
    body.appendChild(err); body.appendChild(actions);
    box.appendChild(head); box.appendChild(body);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const close = () => { try { document.body.removeChild(overlay); } catch (e) { void e; } };
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    input.addEventListener('input', () => {
      okBtn.disabled = input.value.trim() !== o.word;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (!okBtn.disabled) okBtn.click(); }
    });
    okBtn.addEventListener('click', async () => {
      if (input.value.trim() !== o.word) return;
      okBtn.disabled = true;
      try { await o.onConfirm(); close(); }
      catch (e) {
        err.textContent = tr('login_error_credentials');
        okBtn.disabled = false;
      }
    });
    setTimeout(() => input.focus(), 30);
  }

  _renderInvitationRow(inv, reload) {
    const row = el('div', { class: 'auth-user-row' });
    const name = el('span', { class: 'auth-user-name', text: inv.username });
    if (inv.is_admin_initial) {
      const badge = el('span', { class: 'auth-admin-badge', text: 'admin' });
      name.appendChild(badge);
    }
    const exp = el('span', { class: 'auth-invite-exp' });
    const expDate = inv.expires_at ? new Date(inv.expires_at) : null;
    if (expDate && !Number.isNaN(expDate.getTime())) {
      exp.textContent = `${tr('admin_invitation_expires')}: ${expDate.toLocaleDateString()}`;
    }
    name.appendChild(exp);
    const acts = el('div', { class: 'auth-user-actions' });
    const revoke = el('button', { type: 'button', class: 'danger', text: tr('admin_invitation_revoke'), onclick: async () => {
      try { await deleteInvitation(inv.id); await reload(); } catch (e) { void e; }
    }});
    if (inv.used_at) revoke.disabled = true;
    acts.appendChild(revoke);
    row.appendChild(name); row.appendChild(acts);
    return row;
  }

  async _openManageUsers() {
    this._switchUsersTab('users');
    this.usersModalEl.classList.add('open');
    if (typeof this._reloadUsers === 'function') this._reloadUsers();
  }

  _buildSetupModal() {
    const modal = el('div', { id: 'auth-setup-modal', class: 'auth-modal' });
    const box = el('div', { class: 'auth-modal-box' });
    const head = el('div', { class: 'auth-modal-head' });
    const titleEl = el('h2', { text: tr('setup_account_title') });
    const close = el('button', { type: 'button', class: 'auth-x', html: '&times;',
      onclick: () => modal.classList.remove('open') });
    head.appendChild(titleEl); head.appendChild(close);
    const body = el('div', { class: 'auth-modal-body' });
    const welcome = el('div', { class: 'auth-setup-welcome', text: tr('setup_account_welcome') });
    const userLabel = el('label', { text: tr('setup_account_username') });
    const userIn = el('input', { type: 'text', readonly: 'readonly' });
    const pwLabel = el('label', { text: tr('setup_account_password') });
    const pwIn = el('input', { type: 'password', autocomplete: 'new-password' });
    const confLabel = el('label', { text: tr('setup_account_password_confirm') });
    const confIn = el('input', { type: 'password', autocomplete: 'new-password' });
    const err = el('div', { class: 'auth-error' });
    const actions = el('div', { class: 'auth-actions' });
    const submit = el('button', { type: 'button', class: 'auth-primary', text: tr('setup_account_submit') });
    actions.appendChild(submit);
    body.appendChild(welcome);
    body.appendChild(userLabel); body.appendChild(userIn);
    body.appendChild(pwLabel); body.appendChild(pwIn);
    body.appendChild(confLabel); body.appendChild(confIn);
    body.appendChild(err); body.appendChild(actions);
    box.appendChild(head); box.appendChild(body);
    modal.appendChild(box);
    document.body.appendChild(modal);
    modal.addEventListener('mousedown', (e) => { if (e.target === modal) modal.classList.remove('open'); });
    [pwIn, confIn].forEach((i) => i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit.click(); }
    }));
    submit.addEventListener('click', () => this._submitSetup());

    this.setupModalEl = modal;
    this.setupTitleEl = titleEl;
    this.setupWelcomeEl = welcome;
    this.setupUserLabel = userLabel;
    this.setupUserIn = userIn;
    this.setupPwLabel = pwLabel;
    this.setupPwIn = pwIn;
    this.setupConfLabel = confLabel;
    this.setupConfIn = confIn;
    this.setupErrEl = err;
    this.setupSubmitEl = submit;
    this._setupToken = null;
  }

  async _checkInviteParam() {
    const m = /[?&]invite=([A-Za-z0-9_\-]+)/.exec(location.search);
    if (!m) return;
    const token = m[1];
    try {
      const info = await checkInvitation(token);
      if (info && info.valid) {
        this._setupToken = token;
        this.setupUserIn.value = info.username || '';
        this.setupPwIn.value = '';
        this.setupConfIn.value = '';
        this.setupErrEl.textContent = '';
        this.setupModalEl.classList.add('open');
        setTimeout(() => this.setupPwIn.focus(), 50);
      }
    } catch (e) {
      this._setupToken = token;
      this.setupUserIn.value = '';
      this.setupPwIn.value = '';
      this.setupConfIn.value = '';
      this.setupModalEl.classList.add('open');
      const status = e && e.status;
      this.setupErrEl.textContent = (status === 410)
        ? tr('setup_account_expired_token')
        : tr('setup_account_invalid_token');
      this.setupSubmitEl.disabled = true;
    }
  }

  async _submitSetup() {
    if (!this._setupToken) return;
    this.setupErrEl.textContent = '';
    const pw = this.setupPwIn.value;
    const conf = this.setupConfIn.value;
    if (pw.length < 8) { this.setupErrEl.textContent = tr('setup_account_password_too_short'); return; }
    if (pw !== conf) { this.setupErrEl.textContent = tr('setup_account_passwords_must_match'); return; }
    this.setupSubmitEl.disabled = true;
    try {
      const user = await setupAccount(this._setupToken, pw);
      this.setupModalEl.classList.remove('open');
      this._stripInviteParam();
      this.onMessage(tr('setup_account_success_toast', { username: user.username }));
      this.onLogin(user);
    } catch (e) {
      const status = e && e.status;
      if (status === 410) this.setupErrEl.textContent = tr('setup_account_expired_token');
      else if (e && e.kind === 'network') this.setupErrEl.textContent = tr('login_error_network');
      else this.setupErrEl.textContent = tr('setup_account_invalid_token');
    } finally {
      this.setupSubmitEl.disabled = false;
    }
  }

  _stripInviteParam() {
    try {
      const u = new URL(location.href);
      u.searchParams.delete('invite');
      const next = u.pathname + (u.searchParams.toString() ? `?${u.searchParams.toString()}` : '') + u.hash;
      history.replaceState(null, '', next);
    } catch (e) { void e; }
  }

  _retranslate() {
    if (this.signInBtnEl) {
      this.signInBtnEl.textContent = tr('sign_in_button');
      this.signInBtnEl.setAttribute('title', tr('login_title'));
      this.signInBtnEl.setAttribute('aria-label', tr('login_title'));
    }
    this.loginTitleEl.textContent = tr('login_title');
    this.loginUserLabel.textContent = tr('login_username');
    this.loginPwLabel.textContent = tr('login_password');
    this.loginSubmitEl.textContent = tr('login_submit');
    this.changePwTitleEl.textContent = tr('change_password_title');
    this.changePwLabels.old.textContent = tr('change_password_old');
    this.changePwLabels.neu.textContent = tr('change_password_new');
    this.changePwLabels.conf.textContent = tr('change_password_confirm');
    this.changePwSubmitEl.textContent = tr('change_password_title');
    this.usersTitleEl.textContent = tr('dropdown_manage_users');
    this.usersAddBtnEl.textContent = tr('user_add');
    this.usersAddUserIn.placeholder = tr('login_username');
    this.usersAddPwIn.placeholder = tr('login_password');
    this.usersTabUsersBtn.textContent = tr('admin_tab_users');
    this.usersTabInvBtn.textContent = tr('admin_tab_invitations');
    this.invAddUserIn.placeholder = tr('admin_invitation_username');
    this.invAddBtnEl.textContent = tr('admin_invitation_generate');
    this.invResultLabelEl.textContent = tr('admin_invitation_url');
    this.invResultCopyEl.textContent = tr('admin_invitation_copy');
    this.setupTitleEl.textContent = tr('setup_account_title');
    this.setupWelcomeEl.textContent = tr('setup_account_welcome');
    this.setupUserLabel.textContent = tr('setup_account_username');
    this.setupPwLabel.textContent = tr('setup_account_password');
    this.setupConfLabel.textContent = tr('setup_account_password_confirm');
    this.setupSubmitEl.textContent = tr('setup_account_submit');
    if (isLoggedIn()) this._populateMenu();
  }
}
