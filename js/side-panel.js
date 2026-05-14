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
    this.titleEl = opts.titleEl;
    this.tagsEl = opts.tagsEl;
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
    this.onStatusChange = opts.onStatusChange || (() => {});
    this.onContentChange = opts.onContentChange || (() => {});
    this.onConfirmCloseWithUnsaved = opts.onConfirmCloseWithUnsaved || ((cb) => cb(true));
    this.onClose = opts.onClose || (() => {});
    this.onExportMd = opts.onExportMd || (() => {});

    this.currentId = null;
    this.currentView = null;
    this.currentMd = '';
    this.editing = false;
    this.unsaved = false;

    this.refreshStatusOptions();
    this._wireEvents();
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
    this.titleEl.textContent = view.title;
    this.statusSelectEl.value = view.status;
    this.statusDotEl.style.background = statusVarName(view.status);
    this.tagsEl.innerHTML = '';
    (view.tags || []).forEach((t) => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.textContent = t;
      this.tagsEl.appendChild(span);
    });
    this.bodyEl.innerHTML = `<p style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px">${tr('side_panel_loading')}</p>`;
    this.panelEl.classList.add('open');

    const node = this.getNode(view.id);
    if (node && isPuzzleNode(node)) {
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
    this.titleEl.textContent = view.title;
    this.statusSelectEl.value = view.status;
    this.statusDotEl.style.background = statusVarName(view.status);
    this.tagsEl.innerHTML = '';
    (view.tags || []).forEach((t) => {
      const span = document.createElement('span');
      span.className = 'tag';
      span.textContent = t;
      this.tagsEl.appendChild(span);
    });
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
    this.onClose();
  }
}
