/* Side panel that renders the active node's markdown. Owns the status
   dropdown + edit overlay + close behaviour. Reads inline markdown from text
   nodes and falls back to data/puzzles/<slug>.md for legacy entries. */

import { renderMarkdown, attachCodeCopyButtons } from './markdown.js';
import { loadPuzzleMarkdown, setCachedMarkdown } from './data-loader.js';
import { statusLabel, statusVarName, STATUSES, isPuzzleNode, nodeMarkdown } from './nodes.js';
import { tr } from './i18n.js';

export class SidePanel {
  constructor(opts) {
    this.panelEl = opts.panelEl;
    this.statusSelectEl = opts.statusSelectEl;
    this.titleInputEl = opts.titleInputEl;
    this.tagsHostEl = opts.tagsHostEl;
    this.tagsInputEl = opts.tagsInputEl;
    this.branchesHostEl = opts.branchesHostEl;
    this.lockBtnEl = opts.lockBtnEl;
    this.deleteBtnEl = opts.deleteBtnEl;
    this.bodyEl = opts.bodyEl;
    this.closeEl = opts.closeEl;
    this.editBtnEl = opts.editBtnEl;
    this.saveBtnEl = opts.saveBtnEl;
    this.exportBtnEl = opts.exportBtnEl;
    this.statusDotEl = opts.statusDotEl;

    this.overlayEl = opts.overlayEl;
    this.overlayTextareaEl = opts.overlayTextareaEl;
    this.overlaySaveEl = opts.overlaySaveEl;
    this.overlayCancelEl = opts.overlayCancelEl;

    this.getNode = opts.getNode || (() => null);
    this.getBranches = opts.getBranches || (() => []);
    this.onStatusChange = opts.onStatusChange || (() => {});
    this.onContentChange = opts.onContentChange || (() => {});
    this.onLabelChange = opts.onLabelChange || (() => {});
    this.onTagsChange = opts.onTagsChange || (() => {});
    this.onBranchesChange = opts.onBranchesChange || (() => {});
    this.onLockToggle = opts.onLockToggle || (() => {});
    this.onDeleteNode = opts.onDeleteNode || (() => {});
    this.onConfirmCloseWithUnsaved = opts.onConfirmCloseWithUnsaved || ((cb) => cb(true));
    this.onClose = opts.onClose || (() => {});
    this.onExportMd = opts.onExportMd || (() => {});

    this.currentId = null;
    this.currentView = null;
    this.currentMd = '';
    this.editing = false;
    this.unsaved = false;
    this._tags = [];
    this._branchIds = [];
    this._locked = false;
    this._lastCommittedLabel = '';

    this.refreshStatusOptions();
    this._wireEvents();
    this._refreshLockButton();
  }

  refreshStatusOptions() {
    const current = this.statusSelectEl.value;
    this.statusSelectEl.innerHTML = '';
    for (const s of STATUSES) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = statusLabel(s);
      this.statusSelectEl.appendChild(opt);
    }
    if (current) this.statusSelectEl.value = current;
  }

  refreshLocalised() {
    this.refreshStatusOptions();
    this._refreshLockButton();
    if (this.deleteBtnEl) this.deleteBtnEl.textContent = tr('edit_modal_delete');
  }

  _wireEvents() {
    this.closeEl.addEventListener('click', () => this.requestClose());
    this.statusSelectEl.addEventListener('change', (e) => {
      if (!this.currentId) return;
      this.onStatusChange(this.currentId, e.target.value);
    });
    this.editBtnEl.addEventListener('click', () => this.openEditOverlay());
    this.overlaySaveEl.addEventListener('click', () => this.saveEdit());
    this.overlayCancelEl.addEventListener('click', () => this.cancelEdit());
    this.overlayTextareaEl.addEventListener('input', () => {
      this.unsaved = this.overlayTextareaEl.value !== this.currentMd;
    });
    this.saveBtnEl.addEventListener('click', () => {
      this.onContentChange(this.currentId, this.currentMd, true);
    });
    this.exportBtnEl.addEventListener('click', () => {
      if (this.currentView) {
        this.onExportMd(this.currentView.slug, this.currentMd);
      }
    });
    if (this.titleInputEl) {
      this.titleInputEl.addEventListener('blur', () => this._commitLabel());
      this.titleInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.titleInputEl.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.titleInputEl.value = this._lastCommittedLabel;
          this.titleInputEl.blur();
        }
      });
    }
    if (this.tagsInputEl) {
      this.tagsInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          this._commitPendingTag();
        } else if (e.key === 'Backspace' && this.tagsInputEl.value === '' && this._tags.length) {
          this._tags.pop();
          this._renderTags();
          if (this.currentId) this.onTagsChange(this.currentId, [...this._tags]);
        }
      });
      this.tagsInputEl.addEventListener('blur', () => this._commitPendingTag());
    }
    if (this.tagsHostEl) {
      this.tagsHostEl.addEventListener('click', (e) => {
        if (e.target === this.tagsHostEl && this.tagsInputEl) this.tagsInputEl.focus();
      });
    }
    if (this.lockBtnEl) {
      this.lockBtnEl.addEventListener('click', () => {
        if (!this.currentId) return;
        const next = !this._locked;
        this._locked = next;
        this._refreshLockButton();
        this.onLockToggle(this.currentId, next);
      });
    }
    if (this.deleteBtnEl) {
      this.deleteBtnEl.addEventListener('click', () => {
        if (!this.currentId) return;
        this.onDeleteNode(this.currentId);
      });
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlayEl.classList.contains('open')) {
        this.cancelEdit();
      }
    });
  }

  async open(view) {
    if (this.editing && this.unsaved) {
      this.onConfirmCloseWithUnsaved((discard) => {
        if (discard) {
          this._discardEdits();
          this.open(view);
        }
      });
      return;
    }
    this.currentId = view.id;
    this.currentView = view;
    this._applyMetaToControls(view);
    this.bodyEl.innerHTML = `<p style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px">${tr('side_panel_loading')}</p>`;
    this.panelEl.classList.add('open');

    if (view.text && typeof view.text === 'string') {
      this.currentMd = view.text;
      this._renderBody();
      return;
    }
    const node = this.getNode(view.id);
    if (node && (isPuzzleNode(node) || (node.kind === 'text') || (node.kind === 'sticky'))) {
      const inline = nodeMarkdown(node);
      if (inline) {
        this.currentMd = inline;
        this._renderBody();
        return;
      }
    }
    const md = await loadPuzzleMarkdown(view.slug);
    this.currentMd = md;
    this._renderBody();
  }

  refreshStatusDot(status) {
    this.statusDotEl.style.background = statusVarName(status);
  }

  setNodeMeta(view) {
    if (!this.currentId || view.id !== this.currentId) return;
    this.currentView = view;
    this._applyMetaToControls(view);
  }

  _applyMetaToControls(view) {
    if (this.titleInputEl) {
      const next = view.title || '';
      const focused = document.activeElement === this.titleInputEl;
      if (!focused) this.titleInputEl.value = next;
      this._lastCommittedLabel = next;
    }
    this.statusSelectEl.value = view.status;
    this.statusDotEl.style.background = statusVarName(view.status);
    this._tags = Array.isArray(view.tags) ? [...view.tags] : [];
    this._renderTags();
    this._branchIds = Array.isArray(view.branches) ? [...view.branches] : [];
    this._renderBranches();
    this._locked = !!view.locked;
    this._refreshLockButton();
  }

  _renderTags() {
    if (!this.tagsHostEl || !this.tagsInputEl) return;
    const chips = this.tagsHostEl.querySelectorAll('.panel-chip');
    chips.forEach((c) => c.parentNode && c.parentNode.removeChild(c));
    for (let i = 0; i < this._tags.length; i++) {
      const t = this._tags[i];
      const chip = document.createElement('span');
      chip.className = 'panel-chip';
      const tx = document.createElement('span');
      tx.textContent = t;
      chip.appendChild(tx);
      const x = document.createElement('button');
      x.type = 'button';
      x.innerHTML = '&times;';
      x.addEventListener('click', (e) => {
        e.preventDefault();
        this._tags.splice(i, 1);
        this._renderTags();
        if (this.currentId) this.onTagsChange(this.currentId, [...this._tags]);
      });
      chip.appendChild(x);
      this.tagsHostEl.insertBefore(chip, this.tagsInputEl);
    }
  }

  _commitPendingTag() {
    if (!this.tagsInputEl) return;
    const v = (this.tagsInputEl.value || '').trim();
    this.tagsInputEl.value = '';
    if (!v) return;
    const lower = v.toLowerCase();
    const exists = this._tags.some((t) => String(t).toLowerCase() === lower);
    if (exists) return;
    this._tags.push(v);
    this._renderTags();
    if (this.currentId) this.onTagsChange(this.currentId, [...this._tags]);
  }

  _commitLabel() {
    if (!this.titleInputEl || !this.currentId) return;
    const next = (this.titleInputEl.value || '').trim();
    if (next === this._lastCommittedLabel) return;
    this._lastCommittedLabel = next;
    this.titleInputEl.value = next;
    this.onLabelChange(this.currentId, next);
  }

  _renderBranches() {
    if (!this.branchesHostEl) return;
    this.branchesHostEl.innerHTML = '';
    const branches = this.getBranches() || [];
    if (!branches.length) {
      const empty = document.createElement('div');
      empty.className = 'panel-branches-empty';
      empty.textContent = tr('branches_panel_title');
      this.branchesHostEl.appendChild(empty);
      return;
    }
    const cur = new Set(this._branchIds || []);
    for (const b of branches) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'panel-branch-chip';
      if (cur.has(b.id)) chip.classList.add('selected');
      chip.textContent = b.label || b.id;
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        const idx = this._branchIds.indexOf(b.id);
        if (idx >= 0) this._branchIds.splice(idx, 1);
        else this._branchIds.push(b.id);
        this._renderBranches();
        if (this.currentId) this.onBranchesChange(this.currentId, [...this._branchIds]);
      });
      this.branchesHostEl.appendChild(chip);
    }
  }

  _refreshLockButton() {
    if (!this.lockBtnEl) return;
    this.lockBtnEl.textContent = tr(this._locked ? 'ctx_unlock' : 'ctx_lock');
    this.lockBtnEl.classList.toggle('locked', !!this._locked);
  }

  _renderBody() {
    const html = renderMarkdown(this.currentMd);
    this.bodyEl.innerHTML = `<div class="md-rendered">${html}</div>`;
    attachCodeCopyButtons(this.bodyEl);
  }

  openEditOverlay() {
    this.editing = true;
    this.unsaved = false;
    this.overlayTextareaEl.value = this.currentMd;
    this.overlayEl.classList.add('open');
    this.overlayTextareaEl.focus();
  }

  saveEdit() {
    const newMd = this.overlayTextareaEl.value;
    this.currentMd = newMd;
    if (this.currentView) setCachedMarkdown(this.currentView.slug, newMd);
    this._renderBody();
    this.editing = false;
    this.unsaved = false;
    this.overlayEl.classList.remove('open');
    this.onContentChange(this.currentId, newMd, true);
  }

  cancelEdit() {
    if (this.unsaved) {
      this.onConfirmCloseWithUnsaved((discard) => {
        if (discard) this._discardEdits();
      });
      return;
    }
    this._discardEdits();
  }

  _discardEdits() {
    this.editing = false;
    this.unsaved = false;
    this.overlayEl.classList.remove('open');
  }

  isOpen() { return this.panelEl.classList.contains('open'); }
  currentSlug() { return this.currentView ? this.currentView.slug : null; }
  currentMarkdown() { return this.currentMd; }

  requestClose() {
    if (this.editing && this.unsaved) {
      this.onConfirmCloseWithUnsaved((discard) => {
        if (discard) {
          this._discardEdits();
          this._closeImmediate();
        }
      });
      return;
    }
    this._closeImmediate();
  }

  _closeImmediate() {
    this.panelEl.classList.remove('open');
    this.currentId = null;
    this.currentView = null;
    this.currentMd = '';
    this._tags = [];
    this._branchIds = [];
    this._locked = false;
    this._lastCommittedLabel = '';
    if (this.titleInputEl) this.titleInputEl.value = '';
    if (this.tagsInputEl) this.tagsInputEl.value = '';
    this._renderTags();
    this._refreshLockButton();
    this.onClose();
  }
}
