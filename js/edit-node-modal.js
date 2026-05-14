/* Rich edit modal for nodes (puzzle, sticky, group, file). Opens on
   double-click, right-click Edit, or Enter on a selected node. Fields:
   title, status segmented control, tag chip input, body editor with
   Edit/Preview tabs, caption (text + side + offset), color palette,
   parent-group dropdown, Save / Cancel / Delete. For image file-nodes
   also shows a preview with Crop / Replace buttons. */

import { tr, LANGS } from './i18n.js';
import { STATUSES, statusVarName, isGroupNode } from './nodes.js';
import { renderMarkdown } from './markdown.js';

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp)(\?.*)?$/i;
const IMAGE_MIME_RE = /^image\//i;

function looksLikeImage(view) {
  if (!view) return false;
  if (view.mime && IMAGE_MIME_RE.test(view.mime)) return true;
  const f = view.file;
  if (typeof f !== 'string') return false;
  if (IMAGE_EXT_RE.test(f)) return true;
  if (/\/images\//i.test(f)) return true;
  return false;
}

const COLOR_PRESETS = [
  { id: '',  label: 'none',    swatch: '' },
  { id: '1', label: 'red',     swatch: '#e83d3d' },
  { id: '2', label: 'orange',  swatch: '#e88a3d' },
  { id: '3', label: 'yellow',  swatch: '#e8c83d' },
  { id: '4', label: 'green',   swatch: '#3de88a' },
  { id: '5', label: 'cyan',    swatch: '#3dc8e8' },
  { id: '6', label: 'purple',  swatch: '#9a6ce8' },
];

const SIDES = ['top', 'bottom', 'left', 'right'];

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

export class EditNodeModal {
  constructor(opts) {
    this.getNodes = opts.getNodes || (() => new Map());
    this.canEdit = opts.canEdit || (() => true);
    this.onSave = opts.onSave || (() => {});
    this.onDelete = opts.onDelete || (() => {});
    this.onCancel = opts.onCancel || (() => {});
    this.onUnauthedSubmit = opts.onUnauthedSubmit || (() => {});
    this.onCropImage = opts.onCropImage || null;
    this.onReplaceImage = opts.onReplaceImage || null;
    this._build();
    document.addEventListener('i18n:changed', () => this._retranslate());
  }

  _build() {
    const modal = el('div', { id: 'edit-node-modal' });
    const box = el('div', { id: 'edit-node-box' });
    const head = el('div', { id: 'edit-node-head' });
    const titleHead = el('h2', { text: tr('edit_modal_title') });
    const closeBtn = el('button', { id: 'edit-node-close', type: 'button', html: '&times;',
      onclick: () => this._cancel() });
    head.appendChild(titleHead); head.appendChild(closeBtn);

    const body = el('div', { id: 'edit-node-body' });
    const signinHint = el('div', { id: 'edit-modal-signin-hint', text: tr('edit_modal_signin_hint') });

    const titleField = el('div', { class: 'em-field' });
    const titleLabel = el('label', { text: tr('edit_modal_title') });
    const titleInput = el('input', { type: 'text' });
    titleField.appendChild(titleLabel); titleField.appendChild(titleInput);

    const statusField = el('div', { class: 'em-field' });
    const statusLabel = el('label', { text: tr('edit_modal_status') });
    const statusSeg = el('div', { class: 'em-segmented' });
    const statusBtns = {};
    for (const s of STATUSES) {
      const b = el('button', { type: 'button', 'data-status': s });
      const dot = el('span', { class: 'em-status-dot' });
      dot.style.background = statusVarName(s);
      b.appendChild(dot);
      const tx = document.createElement('span');
      tx.textContent = this._statusLabel(s);
      b.appendChild(tx);
      b.addEventListener('click', () => this._setStatus(s));
      statusSeg.appendChild(b);
      statusBtns[s] = b;
    }
    statusField.appendChild(statusLabel); statusField.appendChild(statusSeg);

    const tagsField = el('div', { class: 'em-field' });
    const tagsLabel = el('label', { text: tr('edit_modal_tags') });
    const tagsHost = el('div', { class: 'em-chip-input' });
    const tagsInput = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', list: 'edit-tag-suggestions' });
    const tagsDatalist = el('datalist', { id: 'edit-tag-suggestions' });
    tagsHost.appendChild(tagsInput);
    tagsHost.appendChild(tagsDatalist);
    tagsField.appendChild(tagsLabel); tagsField.appendChild(tagsHost);

    const bodyField = el('div', { class: 'em-field' });
    const bodyLabel = el('label', { text: tr('edit_modal_body') });
    const tabs = el('div', { class: 'em-tabs' });
    const tabEdit = el('button', { type: 'button', class: 'active', text: tr('edit_modal_body_edit'),
      onclick: () => this._setBodyTab('edit') });
    const tabPreview = el('button', { type: 'button', text: tr('edit_modal_body_preview'),
      onclick: () => this._setBodyTab('preview') });
    tabs.appendChild(tabEdit); tabs.appendChild(tabPreview);
    const mdInput = el('textarea', { spellcheck: 'false' });
    const previewEl = el('div', { class: 'em-preview md-rendered' });
    previewEl.style.display = 'none';
    bodyField.appendChild(bodyLabel); bodyField.appendChild(tabs);
    bodyField.appendChild(mdInput); bodyField.appendChild(previewEl);

    const captionField = el('div', { class: 'em-field' });
    const captionLabel = el('label', { text: tr('edit_modal_caption') });
    const captionRow = el('div', { class: 'em-caption-row' });
    const captionTextIn = el('input', { type: 'text', placeholder: '' });
    captionTextIn.style.flex = '2';
    captionTextIn.style.minWidth = '120px';
    const captionSideSeg = el('div', { class: 'em-segmented' });
    const sideBtns = {};
    for (const s of SIDES) {
      const b = el('button', { type: 'button', 'data-side': s, text: this._sideLabel(s) });
      b.addEventListener('click', () => this._setCaptionSide(s));
      captionSideSeg.appendChild(b);
      sideBtns[s] = b;
    }
    const captionOffsetIn = el('input', { type: 'range', min: '4', max: '40', step: '1', value: '12' });
    const captionOffsetVal = el('span', { class: 'em-offset-value', text: '12 px' });
    captionRow.appendChild(captionTextIn);
    captionRow.appendChild(captionSideSeg);
    captionRow.appendChild(captionOffsetIn);
    captionRow.appendChild(captionOffsetVal);
    captionField.appendChild(captionLabel); captionField.appendChild(captionRow);
    captionOffsetIn.addEventListener('input', () => {
      captionOffsetVal.textContent = `${captionOffsetIn.value} px`;
    });

    const colorField = el('div', { class: 'em-field' });
    const colorLabel = el('label', { text: tr('edit_modal_color') });
    const colorRow = el('div', { class: 'em-colors' });
    const colorBtns = {};
    for (const c of COLOR_PRESETS) {
      const cls = c.id === '' ? 'em-color em-color-none' : 'em-color';
      const b = el('div', { class: cls, role: 'button', tabindex: '0', 'data-color': c.id, 'aria-label': c.label });
      if (c.swatch) b.style.background = c.swatch;
      b.addEventListener('click', () => this._setColor(c.id));
      b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') this._setColor(c.id); });
      colorRow.appendChild(b);
      colorBtns[c.id] = b;
    }
    colorField.appendChild(colorLabel); colorField.appendChild(colorRow);

    const parentField = el('div', { class: 'em-field' });
    const parentLabel = el('label', { text: tr('edit_modal_parent_group') });
    const parentSel = el('select');
    parentField.appendChild(parentLabel); parentField.appendChild(parentSel);

    const translationsField = el('div', { class: 'em-field em-translations' });
    const translationsLabel = el('label', { text: tr('translations_header') });
    const translationsHost = el('div', { class: 'em-translations-host' });
    const translationsRows = el('div', { class: 'em-translations-rows' });
    const translationsAddRow = el('div', { class: 'em-translations-add' });
    const translationsLangSel = el('select', { class: 'em-translations-lang' });
    for (const l of LANGS) {
      if (l === 'en') continue;
      const o = document.createElement('option');
      o.value = l;
      o.textContent = l.toUpperCase();
      translationsLangSel.appendChild(o);
    }
    const translationsAddBtn = el('button', { type: 'button', class: 'modal-btn', text: tr('translations_add') });
    translationsAddRow.appendChild(translationsLangSel);
    translationsAddRow.appendChild(translationsAddBtn);
    translationsHost.appendChild(translationsRows);
    translationsHost.appendChild(translationsAddRow);
    translationsField.appendChild(translationsLabel);
    translationsField.appendChild(translationsHost);
    translationsAddBtn.addEventListener('click', () => {
      const l = translationsLangSel.value;
      if (!l) return;
      if (!this._translations) this._translations = {};
      if (!this._translations[l]) this._translations[l] = { label: '', body: '' };
      this._renderTranslations();
    });

    const imageField = el('div', { class: 'em-field' });
    const imageLabel = el('label', { text: tr('edit_modal_image') });
    const imageRow = el('div', { class: 'em-image-row' });
    const imagePreview = el('div', { class: 'em-image-preview' });
    const imagePreviewEmpty = el('div', { class: 'em-image-preview-empty', text: tr('edit_modal_image_empty') });
    imagePreview.appendChild(imagePreviewEmpty);
    const imageActions = el('div', { class: 'em-image-actions' });
    const cropBtn = el('button', { type: 'button', class: 'modal-btn', text: tr('edit_modal_crop_image') });
    const replaceBtn = el('button', { type: 'button', class: 'modal-btn', text: tr('edit_modal_replace_image') });
    cropBtn.addEventListener('click', () => this._cropImage());
    replaceBtn.addEventListener('click', () => this._replaceImage());
    imageActions.appendChild(cropBtn);
    imageActions.appendChild(replaceBtn);
    imageRow.appendChild(imagePreview);
    imageRow.appendChild(imageActions);
    imageField.appendChild(imageLabel);
    imageField.appendChild(imageRow);
    imageField.style.display = 'none';

    body.appendChild(signinHint);
    body.appendChild(titleField);
    const row = el('div', { class: 'em-row' });
    row.appendChild(statusField); row.appendChild(colorField);
    body.appendChild(row);
    body.appendChild(tagsField);
    body.appendChild(bodyField);
    body.appendChild(captionField);
    body.appendChild(parentField);
    body.appendChild(translationsField);
    body.appendChild(imageField);

    const foot = el('div', { id: 'edit-node-foot' });
    const delBtn = el('button', { type: 'button', class: 'modal-btn danger', text: tr('edit_modal_delete') });
    delBtn.addEventListener('click', () => this._delete());
    const spacer = el('div', { class: 'em-spacer' });
    const cancelBtn = el('button', { type: 'button', class: 'modal-btn cancel', text: tr('edit_modal_cancel'),
      onclick: () => this._cancel() });
    const saveBtn = el('button', { type: 'button', class: 'modal-btn primary', text: tr('edit_modal_save'),
      onclick: () => this._save() });
    foot.appendChild(delBtn); foot.appendChild(spacer); foot.appendChild(cancelBtn); foot.appendChild(saveBtn);

    box.appendChild(head); box.appendChild(body); box.appendChild(foot);
    modal.appendChild(box);
    document.body.appendChild(modal);

    modal.addEventListener('mousedown', (e) => { if (e.target === modal) this._cancel(); });
    document.addEventListener('keydown', (e) => {
      if (!modal.classList.contains('open')) return;
      if (e.key === 'Escape') { e.preventDefault(); this._cancel(); }
    });

    tagsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        this._commitPendingTag();
      } else if (e.key === 'Backspace' && tagsInput.value === '' && this._tags.length) {
        this._tags.pop();
        this._renderTags();
      }
    });
    tagsInput.addEventListener('blur', () => this._commitPendingTag());
    mdInput.addEventListener('input', () => this._refreshPreviewIfShown());

    this.modalEl = modal;
    this.titleHeadEl = titleHead;
    this.signinHintEl = signinHint;
    this.titleLabelEl = titleLabel;
    this.titleInputEl = titleInput;
    this.statusLabelEl = statusLabel;
    this.statusBtnEls = statusBtns;
    this.tagsLabelEl = tagsLabel;
    this.tagsHostEl = tagsHost;
    this.tagsInputEl = tagsInput;
    this.tagsDatalistEl = tagsDatalist;
    this.bodyLabelEl = bodyLabel;
    this.bodyTabEditEl = tabEdit;
    this.bodyTabPreviewEl = tabPreview;
    this.mdInputEl = mdInput;
    this.previewEl = previewEl;
    this.captionLabelEl = captionLabel;
    this.captionTextEl = captionTextIn;
    this.captionSideEls = sideBtns;
    this.captionOffsetEl = captionOffsetIn;
    this.captionOffsetValEl = captionOffsetVal;
    this.colorLabelEl = colorLabel;
    this.colorBtnEls = colorBtns;
    this.parentLabelEl = parentLabel;
    this.parentSelectEl = parentSel;
    this.translationsLabelEl = translationsLabel;
    this.translationsRowsEl = translationsRows;
    this.translationsLangSelEl = translationsLangSel;
    this.translationsAddBtnEl = translationsAddBtn;
    this.deleteBtnEl = delBtn;
    this.cancelBtnEl = cancelBtn;
    this.saveBtnEl = saveBtn;
    this.imageFieldEl = imageField;
    this.imageLabelEl = imageLabel;
    this.imagePreviewEl = imagePreview;
    this.imagePreviewEmptyEl = imagePreviewEmpty;
    this.cropBtnEl = cropBtn;
    this.replaceBtnEl = replaceBtn;

    this._state = null;
    this._tags = [];
    this._readonly = false;
  }

  _setImagePreview(url) {
    const host = this.imagePreviewEl;
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    if (url) {
      const img = new Image();
      img.alt = '';
      img.src = url;
      host.appendChild(img);
    } else {
      host.appendChild(this.imagePreviewEmptyEl);
    }
  }

  _cropImage() {
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    if (!this._state || !this._state.file) return;
    if (typeof this.onCropImage !== 'function') return;
    const id = this._state.id;
    Promise.resolve(this.onCropImage(id, this._state.file)).then((newUrl) => {
      if (newUrl && this._state && this._state.id === id) {
        this._state.file = newUrl;
        this._setImagePreview(newUrl);
      }
    }).catch((e) => { void e; });
  }

  _replaceImage() {
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    if (!this._state) return;
    if (typeof this.onReplaceImage !== 'function') return;
    const id = this._state.id;
    Promise.resolve(this.onReplaceImage(id)).then((newUrl) => {
      if (newUrl && this._state && this._state.id === id) {
        this._state.file = newUrl;
        this._setImagePreview(newUrl);
      }
    }).catch((e) => { void e; });
  }

  _statusLabel(s) {
    return tr({
      'solved':   'status_solved',
      'partial':  'status_partial',
      'unsolved': 'status_unsolved',
      'no-data':  'status_nodata',
      'dead-end': 'status_dead_end',
    }[s] || s);
  }

  _sideLabel(s) {
    return tr({
      'top':    'edit_modal_caption_side_top',
      'bottom': 'edit_modal_caption_side_bottom',
      'left':   'edit_modal_caption_side_left',
      'right':  'edit_modal_caption_side_right',
    }[s] || s);
  }

  open(view, md) {
    this._state = {
      id: view.id,
      kind: view.kind || 'puzzle',
      type: view.type || null,
      file: view.file || null,
      mime: view.mime || null,
      title: view.title || '',
      status: view.status || 'unsolved',
      tags: Array.isArray(view.tags) ? [...view.tags] : [],
      md: md || '',
      caption: view.caption ? { ...view.caption } : { text: '', side: 'bottom', offset: 12 },
      color: view.color || '',
      parent: view.parent || '',
      rect: view.rect ? { ...view.rect } : null,
    };
    this._tags = [...this._state.tags];
    this._translations = view.translations ? JSON.parse(JSON.stringify(view.translations)) : null;
    this._renderTranslations();
    const isImage = looksLikeImage(this._state);
    this.imageFieldEl.style.display = isImage ? 'flex' : 'none';
    if (isImage) this._setImagePreview(this._state.file || '');
    this._readonly = !this.canEdit();
    this.modalEl.classList.toggle('em-readonly', this._readonly);
    if (this.signinHintEl) this.signinHintEl.classList.toggle('visible', this._readonly);
    this.deleteBtnEl.style.display = this._readonly ? 'none' : 'inline-block';
    this.saveBtnEl.disabled = this._readonly;
    this.titleHeadEl.textContent = tr('edit_modal_title');
    this.titleInputEl.value = this._state.title;
    this._setStatus(this._state.status, true);
    this._renderTags();
    this._rebuildTagSuggestions();
    this.mdInputEl.value = this._state.md;
    const cap = this._state.caption || { text: '', side: 'bottom', offset: 12 };
    this.captionTextEl.value = cap.text || '';
    this._setCaptionSide(cap.side || 'bottom', true);
    this.captionOffsetEl.value = String(cap.offset || 12);
    this.captionOffsetValEl.textContent = `${cap.offset || 12} px`;
    this._setColor(this._state.color || '', true);
    this._rebuildParentSelect(this._state.parent || '');
    if (this._state.kind === 'sticky') {
      this.mdInputEl.style.minHeight = '80px';
    } else {
      this.mdInputEl.style.minHeight = '160px';
    }
    this._setBodyTab('edit');
    this.modalEl.classList.add('open');
    setTimeout(() => { if (!this._readonly) this.titleInputEl.focus(); }, 30);
  }

  close() {
    this.modalEl.classList.remove('open');
    this._state = null;
  }

  isOpen() { return this.modalEl.classList.contains('open'); }

  _setStatus(s, silent) {
    if (!STATUSES.includes(s)) return;
    if (!this._state) return;
    this._state.status = s;
    for (const k of STATUSES) {
      const b = this.statusBtnEls[k];
      if (b) b.classList.toggle('active', k === s);
    }
    void silent;
  }

  _setCaptionSide(side, silent) {
    if (!SIDES.includes(side)) return;
    if (!this._state) return;
    if (!this._state.caption) this._state.caption = { text: '', side, offset: 12 };
    else this._state.caption.side = side;
    for (const k of SIDES) {
      const b = this.captionSideEls[k];
      if (b) b.classList.toggle('active', k === side);
    }
    void silent;
  }

  _setColor(c, silent) {
    if (!this._state) return;
    this._state.color = c;
    Object.entries(this.colorBtnEls).forEach(([k, b]) => {
      b.classList.toggle('active', k === c);
    });
    void silent;
  }

  _setBodyTab(t) {
    const isEdit = t === 'edit';
    this.bodyTabEditEl.classList.toggle('active', isEdit);
    this.bodyTabPreviewEl.classList.toggle('active', !isEdit);
    this.mdInputEl.style.display = isEdit ? 'block' : 'none';
    this.previewEl.style.display = isEdit ? 'none' : 'block';
    if (!isEdit) this._renderPreview();
  }

  _renderPreview() {
    const v = this.mdInputEl.value || '';
    this.previewEl.innerHTML = renderMarkdown(v);
  }

  _refreshPreviewIfShown() {
    if (this.previewEl.style.display === 'block') this._renderPreview();
  }

  _commitPendingTag() {
    const v = (this.tagsInputEl.value || '').trim();
    if (!v) return;
    const lower = v.toLowerCase();
    const exists = this._tags.some((t) => String(t).toLowerCase() === lower);
    if (!exists) this._tags.push(v);
    this.tagsInputEl.value = '';
    this._renderTags();
  }

  _renderTags() {
    const chips = this.tagsHostEl.querySelectorAll('.em-chip');
    chips.forEach((c) => c.parentNode && c.parentNode.removeChild(c));
    const refNode = this.tagsInputEl;
    for (let i = 0; i < this._tags.length; i++) {
      const t = this._tags[i];
      const chip = el('span', { class: 'em-chip' });
      const tx = document.createElement('span');
      tx.textContent = t;
      chip.appendChild(tx);
      const x = el('button', { type: 'button', html: '&times;', onclick: () => {
        this._tags.splice(i, 1);
        this._renderTags();
      }});
      chip.appendChild(x);
      this.tagsHostEl.insertBefore(chip, refNode);
    }
  }

  _rebuildTagSuggestions() {
    const nodes = this.getNodes();
    const set = new Set();
    for (const n of nodes.values()) {
      if (Array.isArray(n.tags)) for (const t of n.tags) if (typeof t === 'string') set.add(t);
    }
    this.tagsDatalistEl.innerHTML = '';
    for (const t of set) {
      const o = document.createElement('option');
      o.value = t;
      this.tagsDatalistEl.appendChild(o);
    }
  }

  _renderTranslations() {
    const host = this.translationsRowsEl;
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    const data = this._translations || {};
    for (const lang of Object.keys(data)) {
      const slot = data[lang] || {};
      const row = document.createElement('div');
      row.className = 'em-translation-row';
      const head = document.createElement('div');
      head.className = 'em-translation-head';
      const langLab = document.createElement('span');
      langLab.className = 'em-translation-lang';
      langLab.textContent = lang.toUpperCase();
      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'em-translation-remove';
      rmBtn.textContent = tr('translations_remove');
      rmBtn.addEventListener('click', () => {
        delete this._translations[lang];
        if (Object.keys(this._translations).length === 0) this._translations = null;
        this._renderTranslations();
      });
      head.appendChild(langLab);
      head.appendChild(rmBtn);
      const labelIn = document.createElement('input');
      labelIn.type = 'text';
      labelIn.placeholder = tr('translations_label_field');
      labelIn.value = slot.label || '';
      labelIn.addEventListener('input', () => { slot.label = labelIn.value; });
      const bodyIn = document.createElement('textarea');
      bodyIn.placeholder = tr('translations_body_field');
      bodyIn.value = slot.body || '';
      bodyIn.rows = 3;
      bodyIn.addEventListener('input', () => { slot.body = bodyIn.value; });
      row.appendChild(head);
      row.appendChild(labelIn);
      row.appendChild(bodyIn);
      host.appendChild(row);
    }
  }

  _rebuildParentSelect(currentParent) {
    const nodes = this.getNodes();
    this.parentSelectEl.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = tr('edit_modal_parent_none');
    this.parentSelectEl.appendChild(noneOpt);
    for (const n of nodes.values()) {
      if (!isGroupNode(n)) continue;
      if (this._state && n.id === this._state.id) continue;
      const o = document.createElement('option');
      o.value = n.id;
      o.textContent = n.label || n.id;
      this.parentSelectEl.appendChild(o);
    }
    this.parentSelectEl.value = currentParent || '';
  }

  _cancel() {
    this.close();
    this.onCancel();
  }

  _save() {
    if (this._readonly) {
      this.onUnauthedSubmit();
      return;
    }
    if (!this._state) return;
    this._commitPendingTag();
    const payload = {
      id: this._state.id,
      kind: this._state.kind,
      type: this._state.type || null,
      file: this._state.file || null,
      title: this.titleInputEl.value.trim(),
      status: this._state.status,
      tags: [...this._tags],
      md: this.mdInputEl.value,
      caption: {
        text: this.captionTextEl.value || '',
        side: this._state.caption ? this._state.caption.side : 'bottom',
        offset: parseInt(this.captionOffsetEl.value, 10) || 12,
      },
      color: this._state.color || '',
      parent: this.parentSelectEl.value || null,
      rect: this._state.rect,
    };
    if (!payload.caption.text && payload.caption.side === 'bottom' && payload.caption.offset === 12) {
      payload.caption = null;
    }
    if (this._translations && Object.keys(this._translations).length > 0) {
      const cleaned = {};
      for (const [l, slot] of Object.entries(this._translations)) {
        if (slot && (slot.label || slot.body)) cleaned[l] = { ...slot };
      }
      payload.translations = Object.keys(cleaned).length ? cleaned : null;
    } else {
      payload.translations = null;
    }
    this.close();
    this.onSave(payload);
  }

  _delete() {
    if (this._readonly) return;
    if (!this._state) return;
    const id = this._state.id;
    if (!confirm(tr('edit_modal_delete_confirm'))) return;
    this.close();
    this.onDelete(id);
  }

  _retranslate() {
    this.titleHeadEl.textContent = tr('edit_modal_title');
    if (this.signinHintEl) this.signinHintEl.textContent = tr('edit_modal_signin_hint');
    this.titleLabelEl.textContent = tr('edit_modal_title');
    this.statusLabelEl.textContent = tr('edit_modal_status');
    this.tagsLabelEl.textContent = tr('edit_modal_tags');
    this.bodyLabelEl.textContent = tr('edit_modal_body');
    this.bodyTabEditEl.textContent = tr('edit_modal_body_edit');
    this.bodyTabPreviewEl.textContent = tr('edit_modal_body_preview');
    this.captionLabelEl.textContent = tr('edit_modal_caption');
    for (const k of SIDES) {
      const b = this.captionSideEls[k];
      if (b) b.lastChild.textContent = this._sideLabel(k);
    }
    this.colorLabelEl.textContent = tr('edit_modal_color');
    this.parentLabelEl.textContent = tr('edit_modal_parent_group');
    if (this.translationsLabelEl) this.translationsLabelEl.textContent = tr('translations_header');
    if (this.translationsAddBtnEl) this.translationsAddBtnEl.textContent = tr('translations_add');
    this.deleteBtnEl.textContent = tr('edit_modal_delete');
    this.cancelBtnEl.textContent = tr('edit_modal_cancel');
    this.saveBtnEl.textContent = tr('edit_modal_save');
    if (this.imageLabelEl) this.imageLabelEl.textContent = tr('edit_modal_image');
    if (this.imagePreviewEmptyEl) this.imagePreviewEmptyEl.textContent = tr('edit_modal_image_empty');
    if (this.cropBtnEl) this.cropBtnEl.textContent = tr('edit_modal_crop_image');
    if (this.replaceBtnEl) this.replaceBtnEl.textContent = tr('edit_modal_replace_image');
    for (const s of STATUSES) {
      const b = this.statusBtnEls[s];
      if (b && b.lastChild) b.lastChild.textContent = this._statusLabel(s);
    }
    if (this.parentSelectEl.options.length > 0) {
      this.parentSelectEl.options[0].textContent = tr('edit_modal_parent_none');
    }
  }

  isReadonly() { return this._readonly; }
}
