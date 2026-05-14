/* Editor modal for creating/editing hotspots + right-click context menu.
   Discards are routed through a 3-button confirm to prevent data loss. */

import { STATUSES, statusLabel, slugify } from './nodes.js';
import { tr } from './i18n.js';

export class EditorModal {
  constructor(opts) {
    this.modalEl = opts.modalEl;
    this.headerTitleEl = opts.headerTitleEl;
    this.closeEl = opts.closeEl;
    this.titleEl = opts.titleEl;
    this.slugEl = opts.slugEl;
    this.statusEl = opts.statusEl;
    this.tagsEl = opts.tagsEl;
    this.mdEl = opts.mdEl;
    this.saveBtnEl = opts.saveBtnEl;
    this.cancelBtnEl = opts.cancelBtnEl;
    this.deleteBtnEl = opts.deleteBtnEl;

    this.confirmModalEl = opts.confirmModalEl;
    this.confirmTitleEl = opts.confirmTitleEl;
    this.confirmMessageEl = opts.confirmMessageEl;
    this.confirmActionsEl = opts.confirmActionsEl;

    this.onSave = opts.onSave || (() => {});
    this.onDelete = opts.onDelete || (() => {});
    this.onCancel = opts.onCancel || (() => {});

    this.mode = 'create';
    this.editingId = null;
    this.pendingRect = null;
    this.initialSnapshot = null;
    this.slugAutoFill = true;

    this._installStatusOptions();
    this._installEvents();
  }

  _installStatusOptions() {
    this.refreshStatusOptions();
  }

  refreshStatusOptions() {
    const current = this.statusEl.value;
    this.statusEl.innerHTML = '';
    for (const s of STATUSES) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = statusLabel(s);
      this.statusEl.appendChild(opt);
    }
    if (current) this.statusEl.value = current;
  }

  _installEvents() {
    this.closeEl.addEventListener('click', () => this._tryClose('cancel'));
    this.cancelBtnEl.addEventListener('click', () => this._tryClose('cancel'));
    this.saveBtnEl.addEventListener('click', () => this._save());
    this.deleteBtnEl.addEventListener('click', () => {
      if (this.mode !== 'edit' || !this.editingId) return;
      this._showConfirm({
        title: tr('editor_delete_title'),
        message: tr('editor_delete_confirm'),
        actions: [
          { label: tr('editor_cancel_button'), kind: 'cancel', fn: () => this._hideConfirm() },
          { label: tr('editor_delete_button'), kind: 'danger', fn: () => {
            const id = this.editingId;
            this._hideConfirm();
            this._closeImmediate();
            this.onDelete(id);
          } },
        ],
      });
    });

    this.modalEl.addEventListener('mousedown', (e) => {
      if (e.target === this.modalEl) this._tryClose('outside');
    });

    this.titleEl.addEventListener('input', () => {
      if (this.slugAutoFill) {
        this.slugEl.value = slugify(this.titleEl.value);
      }
    });
    this.slugEl.addEventListener('input', () => {
      this.slugAutoFill = false;
    });

    document.addEventListener('keydown', (e) => {
      if (!this.modalEl.classList.contains('open')) return;
      if (e.key === 'Escape') this._tryClose('cancel');
    });
  }

  openCreate(rect, defaults) {
    this.mode = 'create';
    this.editingId = null;
    this.pendingRect = rect;
    this.slugAutoFill = true;
    this.headerTitleEl.textContent = tr('editor_new_hotspot');
    this.titleEl.value = (defaults && defaults.title) || '';
    this.slugEl.value = (defaults && defaults.slug) || '';
    this.statusEl.value = (defaults && defaults.status) || 'unsolved';
    this.tagsEl.value = (defaults && Array.isArray(defaults.tags)) ? defaults.tags.join(', ') : '';
    this.mdEl.value = (defaults && defaults.md) || '';
    this.deleteBtnEl.style.display = 'none';
    this._captureSnapshot();
    this.modalEl.classList.add('open');
    setTimeout(() => this.titleEl.focus(), 30);
  }

  openEdit(hotspot, md) {
    this.mode = 'edit';
    this.editingId = hotspot.id;
    this.pendingRect = { ...hotspot.rect };
    this.slugAutoFill = false;
    this.headerTitleEl.textContent = tr('editor_edit_hotspot');
    this.titleEl.value = hotspot.title || '';
    this.slugEl.value = hotspot.slug || hotspot.id;
    this.statusEl.value = hotspot.status || 'unsolved';
    this.tagsEl.value = (hotspot.tags || []).join(', ');
    this.mdEl.value = md || '';
    this.deleteBtnEl.style.display = 'inline-block';
    this._captureSnapshot();
    this.modalEl.classList.add('open');
    setTimeout(() => this.titleEl.focus(), 30);
  }

  _captureSnapshot() {
    this.initialSnapshot = {
      title: this.titleEl.value,
      slug: this.slugEl.value,
      status: this.statusEl.value,
      tags: this.tagsEl.value,
      md: this.mdEl.value,
    };
  }

  _hasUnsaved() {
    if (!this.initialSnapshot) return false;
    return (
      this.titleEl.value !== this.initialSnapshot.title ||
      this.slugEl.value !== this.initialSnapshot.slug ||
      this.statusEl.value !== this.initialSnapshot.status ||
      this.tagsEl.value !== this.initialSnapshot.tags ||
      this.mdEl.value !== this.initialSnapshot.md
    );
  }

  _save() {
    const title = this.titleEl.value.trim();
    if (!title) {
      this.titleEl.focus();
      this.titleEl.style.borderColor = 'var(--unsolved)';
      setTimeout(() => { this.titleEl.style.borderColor = ''; }, 1500);
      return;
    }
    const slug = slugify(this.slugEl.value || title);
    const status = STATUSES.includes(this.statusEl.value) ? this.statusEl.value : 'unsolved';
    const tags = this.tagsEl.value.split(',').map((t) => t.trim()).filter(Boolean);
    const md = this.mdEl.value;
    const rect = this.pendingRect;
    const payload = {
      id: this.mode === 'edit' ? this.editingId : null,
      title,
      slug,
      status,
      tags,
      rect,
      md,
      mode: this.mode,
    };
    this._closeImmediate();
    this.onSave(payload);
  }

  _tryClose(reason) {
    if (!this._hasUnsaved()) {
      this._closeImmediate();
      this.onCancel(reason);
      return;
    }
    this._showConfirm({
      title: tr('editor_discard_title'),
      message: tr('editor_discard_confirm_q'),
      actions: [
        { label: tr('editor_discard_keep'),    kind: 'cancel',  fn: () => this._hideConfirm() },
        { label: tr('editor_discard_discard'), kind: 'danger',  fn: () => {
          this._hideConfirm();
          this._closeImmediate();
          this.onCancel(reason);
        } },
        { label: tr('editor_discard_save'),    kind: 'primary', fn: () => {
          this._hideConfirm();
          this._save();
        } },
      ],
    });
  }

  _closeImmediate() {
    this.modalEl.classList.remove('open');
    this.editingId = null;
    this.pendingRect = null;
    this.initialSnapshot = null;
  }

  isOpen() { return this.modalEl.classList.contains('open'); }

  _showConfirm({ title, message, actions }) {
    this.confirmTitleEl.textContent = title;
    this.confirmMessageEl.textContent = message;
    this.confirmActionsEl.innerHTML = '';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = `modal-btn ${a.kind || 'cancel'}`;
      btn.textContent = a.label;
      btn.addEventListener('click', a.fn);
      this.confirmActionsEl.appendChild(btn);
    }
    this.confirmModalEl.classList.add('open');
  }

  _hideConfirm() {
    this.confirmModalEl.classList.remove('open');
    this.confirmActionsEl.innerHTML = '';
  }

  showConfirm(opts) { this._showConfirm(opts); }
  hideConfirm() { this._hideConfirm(); }
}

export class ContextMenu {
  constructor(container) {
    this.container = container;
    this.el = null;
    document.addEventListener('mousedown', (e) => {
      if (this.el && !this.el.contains(e.target)) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    window.addEventListener('blur', () => this.close());
  }

  open(x, y, items) {
    this.close();
    const el = document.createElement('div');
    el.className = 'context-menu';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    for (const it of items) {
      const b = document.createElement('button');
      b.textContent = it.label;
      if (it.danger) b.classList.add('danger');
      b.addEventListener('click', () => {
        this.close();
        it.fn();
      });
      el.appendChild(b);
    }
    this.container.appendChild(el);
    this.el = el;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 6) el.style.left = `${window.innerWidth - r.width - 6}px`;
    if (r.bottom > window.innerHeight - 6) el.style.top = `${window.innerHeight - r.height - 6}px`;
  }

  close() {
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
  }
}
