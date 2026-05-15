/* Export modal. Dropdown of formats, filter chips for branches / statuses,
   live preview pane, Copy + Download buttons. Reads canvas state + arrowLayer
   via getters supplied at construction; everything happens client-side. */

import { tr } from './i18n.js';
import { STATUSES } from './nodes.js';
import {
  buildExportModel,
  enrichWithFileContent,
  exportAsMarkdownDigest,
  exportAsAiText,
  exportAsCytoscapeJson,
  exportAsMermaid,
  exportAsDot,
  exportAsGraphML,
  exportAsPlaintext,
  exportAsJsonCanvas,
  FORMAT_META,
} from './export.js';

const RENDER_DEBOUNCE_MS = 300;
const DEFAULT_MAX_BODY = 4000;

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

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

const FORMAT_DEFS = [
  {
    id: 'markdown',
    labelKey: 'export_format_markdown',
    hintKey: 'export_format_markdown_hint',
    render: (model) => exportAsMarkdownDigest(model),
  },
  {
    id: 'aitext',
    labelKey: 'export_format_aitext',
    hintKey: 'export_format_aitext_hint',
    render: (model) => exportAsAiText(model),
  },
  {
    id: 'mermaid',
    labelKey: 'export_format_mermaid',
    hintKey: 'export_format_mermaid_hint',
    render: (model) => exportAsMermaid(model),
  },
  {
    id: 'cytoscape',
    labelKey: 'export_format_cytoscape',
    hintKey: 'export_format_cytoscape_hint',
    render: (model) => exportAsCytoscapeJson(model),
  },
  {
    id: 'dot',
    labelKey: 'export_format_dot',
    hintKey: 'export_format_dot_hint',
    render: (model) => exportAsDot(model),
  },
  {
    id: 'graphml',
    labelKey: 'export_format_graphml',
    hintKey: 'export_format_graphml_hint',
    render: (model) => exportAsGraphML(model),
  },
  {
    id: 'jsoncanvas',
    labelKey: 'export_format_jsoncanvas',
    hintKey: 'export_format_jsoncanvas_hint',
    render: (model, ctx) => exportAsJsonCanvas(ctx.state, ctx.arrowLayer),
  },
  {
    id: 'plaintext',
    labelKey: 'export_format_plaintext',
    hintKey: 'export_format_plaintext_hint',
    render: (model) => exportAsPlaintext(model),
  },
];

export class ExportModal {
  constructor(opts) {
    const o = opts || {};
    this.getState = o.getState || (() => ({ nodes: new Map(), edges: new Map(), branches: [] }));
    this.getArrowLayer = o.getArrowLayer || (() => null);
    this.toast = typeof o.toast === 'function' ? o.toast : (() => {});
    this.activeFormat = 'markdown';
    this.filterBranches = new Set();
    this.filterStatuses = new Set();
    this.includeFileContent = false;
    this.maxBodyLength = DEFAULT_MAX_BODY;
    this._renderTimer = null;
    this._fileContentCache = new Map();
    this._build();
    document.addEventListener('i18n:changed', () => this._retranslate());
  }

  _build() {
    const overlay = el('div', { class: 'auth-modal export-modal', id: 'export-modal' });
    overlay.style.zIndex = '2400';
    const box = el('div', { class: 'auth-modal-box wide export-modal-box' });
    const head = el('div', { class: 'auth-modal-head' });
    this.titleEl = el('h2', { text: tr('export_modal_title') });
    const close = el('button', { type: 'button', class: 'auth-x', html: '&times;', onclick: () => this.close() });
    head.appendChild(this.titleEl); head.appendChild(close);

    const body = el('div', { class: 'auth-modal-body export-modal-body' });

    const filtersBlock = el('div', { class: 'export-filters' });

    this.branchLabelEl = el('div', { class: 'export-filter-label', text: tr('export_filter_branches') });
    this.branchChipsEl = el('div', { class: 'export-filter-chips' });
    filtersBlock.appendChild(this.branchLabelEl);
    filtersBlock.appendChild(this.branchChipsEl);

    this.statusLabelEl = el('div', { class: 'export-filter-label', text: tr('export_filter_statuses') });
    this.statusChipsEl = el('div', { class: 'export-filter-chips' });
    filtersBlock.appendChild(this.statusLabelEl);
    filtersBlock.appendChild(this.statusChipsEl);

    const optsRow = el('div', { class: 'export-options-row' });
    const fileLabel = el('label', { class: 'export-option' });
    this.includeFileCk = el('input', { type: 'checkbox' });
    this.includeFileCk.addEventListener('change', () => {
      this.includeFileContent = !!this.includeFileCk.checked;
      this._scheduleRender();
    });
    fileLabel.appendChild(this.includeFileCk);
    this.includeFileTextEl = el('span', { text: ` ${tr('export_include_file_content')}` });
    fileLabel.appendChild(this.includeFileTextEl);
    optsRow.appendChild(fileLabel);

    const maxBodyLabel = el('label', { class: 'export-option' });
    this.maxBodyTextEl = el('span', { text: `${tr('export_max_body_length')} ` });
    maxBodyLabel.appendChild(this.maxBodyTextEl);
    this.maxBodyInput = el('input', { type: 'number', min: '0', step: '500', value: String(this.maxBodyLength), class: 'export-max-body-input' });
    this.maxBodyInput.addEventListener('input', () => {
      const v = parseInt(this.maxBodyInput.value, 10);
      this.maxBodyLength = Number.isFinite(v) && v >= 0 ? v : DEFAULT_MAX_BODY;
      this._scheduleRender();
    });
    maxBodyLabel.appendChild(this.maxBodyInput);
    optsRow.appendChild(maxBodyLabel);

    filtersBlock.appendChild(optsRow);
    body.appendChild(filtersBlock);

    this.tabsEl = el('div', { class: 'export-tabs' });
    this.tabButtons = {};
    for (const def of FORMAT_DEFS) {
      const btn = el('button', { type: 'button', class: 'export-tab', text: tr(def.labelKey), 'data-format-id': def.id });
      btn.addEventListener('click', () => this._setActiveFormat(def.id));
      this.tabsEl.appendChild(btn);
      this.tabButtons[def.id] = btn;
    }
    body.appendChild(this.tabsEl);

    this.hintEl = el('div', { class: 'export-format-hint' });
    body.appendChild(this.hintEl);

    this.progressEl = el('div', { class: 'export-progress', style: 'display:none' });
    body.appendChild(this.progressEl);

    this.previewEl = el('pre', { class: 'export-preview', readonly: 'readonly' });
    body.appendChild(this.previewEl);

    const actions = el('div', { class: 'auth-actions export-actions' });
    this.copyBtn = el('button', { type: 'button', class: 'modal-btn', text: tr('export_copy') });
    this.copyBtn.addEventListener('click', () => this._doCopy());
    this.downloadBtn = el('button', { type: 'button', class: 'auth-primary', text: tr('export_download') });
    this.downloadBtn.addEventListener('click', () => this._doDownload());
    actions.appendChild(this.copyBtn);
    actions.appendChild(this.downloadBtn);
    body.appendChild(actions);

    box.appendChild(head);
    box.appendChild(body);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.close(); });

    this.modalEl = overlay;
    this._setActiveFormat('markdown', true);
  }

  open() {
    this._populateFilters();
    this.modalEl.classList.add('open');
    this._scheduleRender(0);
  }

  close() {
    this.modalEl.classList.remove('open');
    if (this._renderTimer) {
      clearTimeout(this._renderTimer);
      this._renderTimer = null;
    }
  }

  _retranslate() {
    if (this.titleEl) this.titleEl.textContent = tr('export_modal_title');
    if (this.branchLabelEl) this.branchLabelEl.textContent = tr('export_filter_branches');
    if (this.statusLabelEl) this.statusLabelEl.textContent = tr('export_filter_statuses');
    if (this.includeFileTextEl) this.includeFileTextEl.textContent = ` ${tr('export_include_file_content')}`;
    if (this.maxBodyTextEl) this.maxBodyTextEl.textContent = `${tr('export_max_body_length')} `;
    if (this.copyBtn) this.copyBtn.textContent = tr('export_copy');
    if (this.downloadBtn) this.downloadBtn.textContent = tr('export_download');
    for (const def of FORMAT_DEFS) {
      const btn = this.tabButtons[def.id];
      if (btn) btn.textContent = tr(def.labelKey);
    }
    if (this.activeFormat) {
      const def = FORMAT_DEFS.find((d) => d.id === this.activeFormat);
      if (def) this.hintEl.textContent = tr(def.hintKey);
    }
  }

  _populateFilters() {
    const state = this.getState();
    const branches = Array.isArray(state.branches) ? state.branches : [];
    this.branchChipsEl.innerHTML = '';
    for (const b of branches) {
      const chip = el('button', {
        type: 'button',
        class: 'export-chip',
        'data-branch-id': b.id,
        text: b.label || b.id,
      });
      if (this.filterBranches.has(b.id)) chip.classList.add('active');
      chip.addEventListener('click', () => {
        if (this.filterBranches.has(b.id)) {
          this.filterBranches.delete(b.id);
          chip.classList.remove('active');
        } else {
          this.filterBranches.add(b.id);
          chip.classList.add('active');
        }
        this._scheduleRender();
      });
      this.branchChipsEl.appendChild(chip);
    }
    if (!branches.length) {
      this.branchChipsEl.appendChild(el('span', { class: 'export-empty-note', text: tr('export_filter_none') }));
    }

    this.statusChipsEl.innerHTML = '';
    for (const s of STATUSES) {
      const labelKey = ({ 'solved': 'filter_solved', 'partial': 'filter_partial', 'unsolved': 'filter_unsolved', 'no-data': 'filter_no_data', 'dead-end': 'filter_dead_end' })[s] || 'filter_all';
      const chip = el('button', {
        type: 'button',
        class: 'export-chip',
        'data-status': s,
        text: tr(labelKey),
      });
      if (this.filterStatuses.has(s)) chip.classList.add('active');
      chip.addEventListener('click', () => {
        if (this.filterStatuses.has(s)) {
          this.filterStatuses.delete(s);
          chip.classList.remove('active');
        } else {
          this.filterStatuses.add(s);
          chip.classList.add('active');
        }
        this._scheduleRender();
      });
      this.statusChipsEl.appendChild(chip);
    }
  }

  _setActiveFormat(id, skipRender) {
    this.activeFormat = id;
    for (const k of Object.keys(this.tabButtons)) {
      this.tabButtons[k].classList.toggle('active', k === id);
    }
    const def = FORMAT_DEFS.find((d) => d.id === id);
    if (def) this.hintEl.textContent = tr(def.hintKey);
    if (!skipRender) this._scheduleRender(0);
  }

  _scheduleRender(delayOverride) {
    if (this._renderTimer) {
      clearTimeout(this._renderTimer);
      this._renderTimer = null;
    }
    const delay = typeof delayOverride === 'number' ? delayOverride : RENDER_DEBOUNCE_MS;
    this._renderTimer = setTimeout(() => {
      this._renderTimer = null;
      this._renderPreview();
    }, delay);
  }

  _currentOptions() {
    return {
      filterBranches: Array.from(this.filterBranches),
      filterStatuses: Array.from(this.filterStatuses),
      maxBodyLength: this.maxBodyLength,
    };
  }

  async _renderPreview() {
    const state = this.getState();
    const arrowLayer = this.getArrowLayer();
    const opts = this._currentOptions();
    const model = buildExportModel(state, arrowLayer, opts);
    if (this.includeFileContent) {
      const total = model.nodes.filter((n) => n.file).length;
      this._showProgress(tr('export_loading_files'), 0, total);
      try {
        await enrichWithFileContent(model, {
          onProgress: ({ done, total: t, current }) => {
            this._showProgress(tr('export_loading_files'), done, t, current);
          },
        });
      } catch (e) {
        void e;
      }
      this._hideProgress();
    } else {
      this._hideProgress();
    }
    const def = FORMAT_DEFS.find((d) => d.id === this.activeFormat);
    if (!def) {
      this.previewEl.textContent = '';
      return;
    }
    try {
      const text = def.render(model, { state, arrowLayer });
      this.previewEl.textContent = text;
      this._currentText = text;
      this._currentModel = model;
    } catch (e) {
      this.previewEl.textContent = `[render failed] ${e && e.message ? e.message : e}`;
      this._currentText = '';
      this._currentModel = null;
    }
  }

  _showProgress(label, done, total, current) {
    if (!this.progressEl) return;
    this.progressEl.style.display = 'block';
    const pct = total ? Math.round((done / total) * 100) : 0;
    const tail = current ? ` (${current})` : '';
    this.progressEl.textContent = `${label} ${done}/${total} (${pct}%)${tail}`;
  }

  _hideProgress() {
    if (this.progressEl) this.progressEl.style.display = 'none';
  }

  async _doCopy() {
    const text = this._currentText || '';
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      this.toast(tr('export_copied_toast'));
    } catch (e) {
      this.toast(tr('export_copy_failed_toast'));
    }
  }

  _doDownload() {
    const text = this._currentText || '';
    if (!text) return;
    const meta = FORMAT_META[this.activeFormat] || { ext: 'txt', mime: 'text/plain' };
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `arg-map-${this.activeFormat}-${ts}.${meta.ext}`;
    downloadBlob(text, filename, meta.mime);
  }
}
