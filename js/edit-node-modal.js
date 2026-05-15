/* Docked node editor that lives inside #panel-mount. Built field stack:
   status segmented + color preset + title + tags chip input + body MD editor
   with toolbar + Edit/Preview tabs + caption + parent select + text-style +
   video URL + image preview with Crop/Replace + branches + lock + delete +
   translations. Single-click on a node opens this panel; double-click and
   ctx-menu Edit open the same panel. */

import { tr, LANGS } from './i18n.js';
import {
  STATUSES, statusVarName, isGroupNode, nodeMarkdown, isDocumentNode,
  isPuzzleNode, isStickyNode, isTextNode, isBlockNode, isVideoNode, isAudioNode,
  isTransformNode, ANNOTATION_KINDS,
  VERIFICATIONS, TECHNIQUES,
} from './nodes.js';
import { renderMarkdown } from './markdown.js';
import { translateMany, providerLabel } from './translate.js';
import { getTranslationProvider } from './settings.js';
import { buildMarkdownToolbar } from './md-toolbar.js';
import {
  pickRenderer, renderHtmlInto, renderTextInto, renderJsonInto,
  renderPdfInto, renderImageInto, renderHexInto, fetchAsText, fetchAsBytes,
} from './file-renderers.js';

const TEXT_SIZES = ['S', 'M', 'L', 'XL'];
const TEXT_FAMILIES = ['system', 'mono', 'serif'];
const TEXT_ALIGNS = ['left', 'center', 'right'];
const TEXT_COLOR_SWATCHES = [
  { id: 'auto',   swatch: 'auto' },
  { id: '#16181c', swatch: '#16181c' },
  { id: '#ffffff', swatch: '#ffffff' },
  { id: '#e83d3d', swatch: '#e83d3d' },
  { id: '#e88a3d', swatch: '#e88a3d' },
  { id: '#e8c83d', swatch: '#e8c83d' },
  { id: '#3de88a', swatch: '#3de88a' },
  { id: '#3dc8e8', swatch: '#3dc8e8' },
  { id: '#9a6ce8', swatch: '#9a6ce8' },
];
const YOUTUBE_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/;
const VIMEO_RE = /vimeo\.com\/(?:video\/)?(\d+)/;
const TWITCH_CLIP_RE = /(?:clips\.twitch\.tv\/|twitch\.tv\/\w+\/clip\/)([\w-]+)/;
const TWITCH_VIDEO_RE = /twitch\.tv\/videos\/(\d+)/;
const LOOM_RE = /loom\.com\/(?:share|embed)\/([\w]{16,})/;
const STREAMABLE_RE = /streamable\.com\/(?:e\/)?([\w-]+)/;
const DAILYMOTION_RE = /(?:dailymotion\.com\/(?:video|embed\/video)\/|dai\.ly\/)([\w]+)/;
const DIRECT_FILE_RE = /\.(mp4|webm|ogg|m4v|mov)(\?[^#]*)?(#.*)?$/i;

const DIRECT_MIME_MAP = {
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', m4v: 'video/mp4', mov: 'video/quicktime',
};

const VIDEO_MEDIA_KINDS = new Set(['youtube', 'vimeo', 'twitch', 'loom', 'streamable', 'dailymotion', 'video', 'file']);

export function isVideoMediaKind(kind) {
  return typeof kind === 'string' && VIDEO_MEDIA_KINDS.has(kind);
}

function twitchEmbedHost() {
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    return window.location.hostname;
  }
  return 'localhost';
}

export function detectVideoUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  const u = url.trim();
  let m = u.match(YOUTUBE_RE);
  if (m) {
    return {
      kind: 'youtube',
      provider: 'youtube',
      videoId: m[1],
      url: u,
      embedUrl: `https://www.youtube.com/embed/${m[1]}`,
    };
  }
  m = u.match(VIMEO_RE);
  if (m) {
    return {
      kind: 'vimeo',
      provider: 'vimeo',
      videoId: m[1],
      url: u,
      embedUrl: `https://player.vimeo.com/video/${m[1]}`,
    };
  }
  m = u.match(TWITCH_CLIP_RE);
  if (m) {
    const parent = encodeURIComponent(twitchEmbedHost());
    return {
      kind: 'twitch',
      provider: 'twitch',
      videoId: m[1],
      url: u,
      embedUrl: `https://clips.twitch.tv/embed?clip=${encodeURIComponent(m[1])}&parent=${parent}`,
    };
  }
  m = u.match(TWITCH_VIDEO_RE);
  if (m) {
    const parent = encodeURIComponent(twitchEmbedHost());
    return {
      kind: 'twitch',
      provider: 'twitch',
      videoId: m[1],
      url: u,
      embedUrl: `https://player.twitch.tv/?video=${encodeURIComponent(m[1])}&parent=${parent}`,
    };
  }
  m = u.match(LOOM_RE);
  if (m) {
    return {
      kind: 'loom',
      provider: 'loom',
      videoId: m[1],
      url: u,
      embedUrl: `https://www.loom.com/embed/${m[1]}`,
    };
  }
  m = u.match(STREAMABLE_RE);
  if (m) {
    return {
      kind: 'streamable',
      provider: 'streamable',
      videoId: m[1],
      url: u,
      embedUrl: `https://streamable.com/e/${m[1]}`,
    };
  }
  m = u.match(DAILYMOTION_RE);
  if (m) {
    return {
      kind: 'dailymotion',
      provider: 'dailymotion',
      videoId: m[1],
      url: u,
      embedUrl: `https://www.dailymotion.com/embed/video/${m[1]}`,
    };
  }
  m = u.match(DIRECT_FILE_RE);
  if (m) {
    const ext = (m[1] || '').toLowerCase();
    return {
      kind: 'file',
      provider: 'direct',
      url: u,
      mime: DIRECT_MIME_MAP[ext] || 'video/mp4',
    };
  }
  return null;
}

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

function setDisp(node, visible) {
  if (!node) return;
  node.style.display = visible ? '' : 'none';
}

export class EditNodeModal {
  constructor(opts) {
    this.panelEl = opts.panelEl;
    this.mountInto = opts.mountInto;
    this.getNodes = opts.getNodes || (() => new Map());
    this.getNode = opts.getNode || ((id) => {
      const m = this.getNodes();
      return m && typeof m.get === 'function' ? m.get(id) : null;
    });
    this.getBranches = opts.getBranches || (() => []);
    this.canEdit = opts.canEdit || (() => true);
    this.onSave = opts.onSave || (() => {});
    this.onDelete = opts.onDelete || (() => {});
    this.onClose = opts.onClose || (() => {});
    this.onOpenNode = opts.onOpenNode || (() => {});
    this.onUnauthedSubmit = opts.onUnauthedSubmit || (() => {});
    this.onCropImage = opts.onCropImage || null;
    this.onReplaceImage = opts.onReplaceImage || null;
    this.onStatusChange = opts.onStatusChange || (() => {});
    this.onLabelChange = opts.onLabelChange || (() => {});
    this.onTagsChange = opts.onTagsChange || (() => {});
    this.onBranchesChange = opts.onBranchesChange || (() => {});
    this.onLockToggle = opts.onLockToggle || (() => {});
    this.onContentChange = opts.onContentChange || (() => {});
    this.onExportMd = opts.onExportMd || (() => {});
    this.onConfirmCloseWithUnsaved = opts.onConfirmCloseWithUnsaved || ((cb) => cb(true));
    this.onOpenFullViewer = opts.onOpenFullViewer || null;
    this.onMetadataChange = opts.onMetadataChange || (() => {});
    this.onResyncFromGithub = opts.onResyncFromGithub || null;
    this.getGithubOrigin = opts.getGithubOrigin || (() => null);
    this.isAdmin = opts.isAdmin || (() => false);
    this.onProvenanceToggle = opts.onProvenanceToggle || (() => {});
    this.isProvenanceActive = opts.isProvenanceActive || (() => false);
    this.onAnnotationsChange = opts.onAnnotationsChange || (() => {});
    this._fileBodyCache = new Map();
    this._fileBytesCache = new Map();
    this._build();
    document.addEventListener('i18n:changed', () => this._retranslate());
  }

  _build() {
    const root = el('div', { class: 'edit-node-root' });
    const body = el('div', { class: 'edit-node-body' });
    const signinHint = el('div', { id: 'edit-modal-signin-hint', text: tr('edit_modal_signin_hint') });

    const titleField = el('div', { class: 'em-field' });
    const titleHeadRow = el('div', { class: 'em-field-head' });
    const titleLabel = el('label', { text: tr('edit_modal_title') });
    const titleWand = this._makeWandButton('label');
    titleHeadRow.appendChild(titleLabel);
    titleHeadRow.appendChild(titleWand);
    const titleInput = el('input', { type: 'text' });
    titleField.appendChild(titleHeadRow); titleField.appendChild(titleInput);

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
      b.addEventListener('click', () => this._setStatus(s, false));
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
    const bodyHead = el('div', { class: 'em-field-head' });
    const bodyLabel = el('label', { text: tr('edit_modal_body') });
    const bodyWandBtn = this._makeWandButton('body');
    bodyHead.appendChild(bodyLabel);
    bodyHead.appendChild(bodyWandBtn);
    const tabs = el('div', { class: 'em-tabs' });
    const tabEdit = el('button', { type: 'button', class: 'active', text: tr('edit_modal_body_edit'),
      onclick: () => this._setBodyTab('edit') });
    const tabPreview = el('button', { type: 'button', text: tr('edit_modal_body_preview'),
      onclick: () => this._setBodyTab('preview') });
    tabs.appendChild(tabEdit); tabs.appendChild(tabPreview);
    const mdInput = el('textarea', { spellcheck: 'false' });
    const mdToolbarRef = buildMarkdownToolbar(() => mdInput);
    const previewEl = el('div', { class: 'em-preview md-rendered' });
    previewEl.style.display = 'none';
    bodyField.appendChild(bodyHead);
    bodyField.appendChild(tabs);
    bodyField.appendChild(mdToolbarRef.el);
    bodyField.appendChild(mdInput); bodyField.appendChild(previewEl);

    const captionField = el('div', { class: 'em-field' });
    const captionLabel = el('label', { text: tr('edit_modal_caption') });
    const captionTextIn = el('textarea', { spellcheck: 'false', rows: '2', placeholder: '' });
    captionTextIn.classList.add('em-caption-textarea');
    const captionToolbarRef = buildMarkdownToolbar(() => captionTextIn);
    const captionRow = el('div', { class: 'em-caption-row' });
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
    captionRow.appendChild(captionSideSeg);
    captionRow.appendChild(captionOffsetIn);
    captionRow.appendChild(captionOffsetVal);
    captionField.appendChild(captionLabel);
    captionField.appendChild(captionToolbarRef.el);
    captionField.appendChild(captionTextIn);
    captionField.appendChild(captionRow);
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
    const openFullImageBtn = el('button', { type: 'button', class: 'modal-btn',
      text: tr('file_viewer_open_full') });
    cropBtn.addEventListener('click', () => this._cropImage());
    replaceBtn.addEventListener('click', () => this._replaceImage());
    openFullImageBtn.addEventListener('click', () => this._openFullViewer());
    imageActions.appendChild(cropBtn);
    imageActions.appendChild(replaceBtn);
    imageActions.appendChild(openFullImageBtn);
    imageRow.appendChild(imagePreview);
    imageRow.appendChild(imageActions);
    imageField.appendChild(imageLabel);
    imageField.appendChild(imageRow);
    imageField.style.display = 'none';

    const textStyleField = el('div', { class: 'em-field em-text-style' });
    const textStyleLabel = el('label', { text: tr('edit_modal_text_style') });
    const textStyleRow = el('div', { class: 'em-text-style-row' });
    const sizeSeg = el('div', { class: 'em-segmented' });
    const sizeBtns = {};
    for (const s of TEXT_SIZES) {
      const b = el('button', { type: 'button', text: s });
      b.addEventListener('click', () => this._setTextStyle({ size: s }));
      sizeSeg.appendChild(b);
      sizeBtns[s] = b;
    }
    const familySeg = el('div', { class: 'em-segmented' });
    const familyBtns = {};
    for (const f of TEXT_FAMILIES) {
      const b = el('button', { type: 'button', text: tr(`edit_modal_text_family_${f}`) });
      b.addEventListener('click', () => this._setTextStyle({ family: f }));
      familySeg.appendChild(b);
      familyBtns[f] = b;
    }
    const alignSeg = el('div', { class: 'em-segmented' });
    const alignBtns = {};
    for (const a of TEXT_ALIGNS) {
      const b = el('button', { type: 'button', text: tr(`edit_modal_text_align_${a}`) });
      b.addEventListener('click', () => this._setTextStyle({ align: a }));
      alignSeg.appendChild(b);
      alignBtns[a] = b;
    }
    const colorPickerRow = el('div', { class: 'em-text-color-row' });
    const textColorBtns = {};
    for (const c of TEXT_COLOR_SWATCHES) {
      const b = el('div', { class: c.id === 'auto' ? 'em-text-color em-text-color-auto'
                            : 'em-text-color', role: 'button', tabindex: '0' });
      if (c.id === 'auto') b.textContent = 'A';
      else b.style.background = c.swatch;
      b.addEventListener('click', () => this._setTextStyle({ color: c.id === 'auto' ? 'auto' : c.id }));
      colorPickerRow.appendChild(b);
      textColorBtns[c.id] = b;
    }
    const wrapToggleRow = el('div', { class: 'em-text-wrap-row' });
    const wrapToggleLabel = el('span', { class: 'em-text-wrap-label', text: tr('edit_modal_text_wrap') });
    const wrapToggleSeg = el('div', { class: 'em-segmented' });
    const wrapWordBtn = el('button', { type: 'button', text: tr('edit_modal_text_wrap_word') });
    wrapWordBtn.addEventListener('click', () => this._setTextStyle({ wrap: 'word' }));
    const wrapNoneBtn = el('button', { type: 'button', text: tr('edit_modal_text_wrap_none') });
    wrapNoneBtn.addEventListener('click', () => this._setTextStyle({ wrap: 'none' }));
    wrapToggleSeg.appendChild(wrapWordBtn);
    wrapToggleSeg.appendChild(wrapNoneBtn);
    wrapToggleRow.appendChild(wrapToggleLabel);
    wrapToggleRow.appendChild(wrapToggleSeg);
    textStyleRow.appendChild(sizeSeg);
    textStyleRow.appendChild(familySeg);
    textStyleRow.appendChild(alignSeg);
    textStyleField.appendChild(textStyleLabel);
    textStyleField.appendChild(textStyleRow);
    textStyleField.appendChild(colorPickerRow);
    textStyleField.appendChild(wrapToggleRow);
    textStyleField.style.display = 'none';

    const videoField = el('div', { class: 'em-field em-video' });
    const videoLabel = el('label', { text: tr('edit_modal_video_url') });
    const videoRow = el('div', { class: 'em-video-row' });
    const videoInput = el('input', { type: 'text', placeholder: tr('edit_modal_video_placeholder') });
    const videoApplyBtn = el('button', { type: 'button', class: 'modal-btn', text: tr('edit_modal_video_apply') });
    const videoHint = el('div', { class: 'em-video-hint' });
    videoRow.appendChild(videoInput);
    videoRow.appendChild(videoApplyBtn);
    videoApplyBtn.addEventListener('click', () => this._applyVideoUrl());
    videoInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._applyVideoUrl(); }
    });
    videoField.appendChild(videoLabel);
    videoField.appendChild(videoRow);
    videoField.appendChild(videoHint);
    videoField.style.display = 'none';

    const previewField = el('div', { class: 'em-field em-preview-section' });
    const previewHeadRow = el('div', { class: 'em-preview-head' });
    const previewLabel = el('label', { text: tr('file_preview_label') });
    const previewControls = el('div', { class: 'em-preview-controls' });
    const previewTabs = el('div', { class: 'em-preview-tabs' });
    const previewTabRenderBtn = el('button', { type: 'button', text: tr('file_viewer_render') });
    const previewTabSourceBtn = el('button', { type: 'button', text: tr('file_viewer_source') });
    previewTabRenderBtn.addEventListener('click', () => this._setPreviewTab('render'));
    previewTabSourceBtn.addEventListener('click', () => this._setPreviewTab('source'));
    previewTabs.appendChild(previewTabRenderBtn);
    previewTabs.appendChild(previewTabSourceBtn);
    const previewOpenFullBtn = el('button', { type: 'button', class: 'em-preview-open-full',
      text: tr('file_viewer_open_full') });
    previewOpenFullBtn.addEventListener('click', () => this._openFullViewer());
    previewControls.appendChild(previewTabs);
    previewControls.appendChild(previewOpenFullBtn);
    previewHeadRow.appendChild(previewLabel);
    previewHeadRow.appendChild(previewControls);
    const previewHost = el('div', { class: 'em-preview-host' });
    previewField.appendChild(previewHeadRow);
    previewField.appendChild(previewHost);
    previewField.style.display = 'none';

    body.appendChild(signinHint);
    const row = el('div', { class: 'em-row' });
    row.appendChild(statusField); row.appendChild(colorField);
    body.appendChild(row);
    body.appendChild(titleField);
    body.appendChild(tagsField);
    body.appendChild(bodyField);
    body.appendChild(textStyleField);
    body.appendChild(videoField);
    body.appendChild(captionField);
    body.appendChild(parentField);
    body.appendChild(this._buildBranchesField());
    body.appendChild(translationsField);
    body.appendChild(imageField);
    body.appendChild(this._buildTransformFields());
    body.appendChild(this._buildAnnotationsField());
    body.appendChild(previewField);
    body.appendChild(this._buildMetadataSection());
    body.appendChild(this._buildProvenanceField());

    const foot = el('div', { id: 'edit-node-foot' });
    const lockBtn = el('button', { type: 'button', class: 'modal-btn em-lock-btn', text: tr('ctx_lock') });
    lockBtn.addEventListener('click', () => this._toggleLock());
    const exportBtn = el('button', { type: 'button', class: 'modal-btn', text: tr('side_panel_export_md') });
    exportBtn.addEventListener('click', () => this._exportMd());
    const delBtn = el('button', { type: 'button', class: 'modal-btn danger', text: tr('edit_modal_delete') });
    delBtn.addEventListener('click', () => this._delete());
    const spacer = el('div', { class: 'em-spacer' });
    const saveBtn = el('button', { type: 'button', class: 'modal-btn primary', text: tr('edit_modal_save'),
      onclick: () => this._save() });
    foot.appendChild(lockBtn); foot.appendChild(exportBtn); foot.appendChild(delBtn);
    foot.appendChild(spacer); foot.appendChild(saveBtn);

    root.appendChild(body); root.appendChild(foot);
    if (this.mountInto) this.mountInto.appendChild(root);

    tagsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        this._commitPendingTag();
      } else if (e.key === 'Backspace' && tagsInput.value === '' && this._tags.length) {
        this._tags.pop();
        this._renderTags();
        this._commitTagsInline();
      }
    });
    tagsInput.addEventListener('blur', () => this._commitPendingTag());
    titleInput.addEventListener('blur', () => this._commitLabelInline());
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); }
      else if (e.key === 'Escape') {
        e.preventDefault();
        titleInput.value = this._lastCommittedLabel || '';
        titleInput.blur();
      }
    });
    mdInput.addEventListener('input', () => this._refreshPreviewIfShown());

    this.rootEl = root;
    this.signinHintEl = signinHint;
    this.titleFieldEl = titleField;
    this.titleLabelEl = titleLabel;
    this.titleInputEl = titleInput;
    this.statusFieldEl = statusField;
    this.statusLabelEl = statusLabel;
    this.statusBtnEls = statusBtns;
    this.tagsFieldEl = tagsField;
    this.tagsLabelEl = tagsLabel;
    this.tagsHostEl = tagsHost;
    this.tagsInputEl = tagsInput;
    this.tagsDatalistEl = tagsDatalist;
    this.bodyFieldEl = bodyField;
    this.bodyLabelEl = bodyLabel;
    this.bodyTabEditEl = tabEdit;
    this.bodyTabPreviewEl = tabPreview;
    this.mdInputEl = mdInput;
    this.previewEl = previewEl;
    this.captionFieldEl = captionField;
    this.captionLabelEl = captionLabel;
    this.captionTextEl = captionTextIn;
    this.captionSideEls = sideBtns;
    this.captionOffsetEl = captionOffsetIn;
    this.captionOffsetValEl = captionOffsetVal;
    this.colorFieldEl = colorField;
    this.colorLabelEl = colorLabel;
    this.colorBtnEls = colorBtns;
    this.parentFieldEl = parentField;
    this.parentLabelEl = parentLabel;
    this.parentSelectEl = parentSel;
    this.translationsFieldEl = translationsField;
    this.translationsLabelEl = translationsLabel;
    this.translationsRowsEl = translationsRows;
    this.translationsLangSelEl = translationsLangSel;
    this.translationsAddBtnEl = translationsAddBtn;
    this.deleteBtnEl = delBtn;
    this.saveBtnEl = saveBtn;
    this.lockBtnEl = lockBtn;
    this.exportBtnEl = exportBtn;
    this.imageFieldEl = imageField;
    this.imageLabelEl = imageLabel;
    this.imagePreviewEl = imagePreview;
    this.imagePreviewEmptyEl = imagePreviewEmpty;
    this.cropBtnEl = cropBtn;
    this.replaceBtnEl = replaceBtn;
    this.openFullImageBtnEl = openFullImageBtn;
    this.textStyleFieldEl = textStyleField;
    this.textStyleLabelEl = textStyleLabel;
    this.sizeBtnEls = sizeBtns;
    this.familyBtnEls = familyBtns;
    this.alignBtnEls = alignBtns;
    this.textColorBtnEls = textColorBtns;
    this.wrapWordBtnEl = wrapWordBtn;
    this.wrapNoneBtnEl = wrapNoneBtn;
    this.wrapToggleLabelEl = wrapToggleLabel;
    this.videoFieldEl = videoField;
    this.videoLabelEl = videoLabel;
    this.videoInputEl = videoInput;
    this.videoApplyBtnEl = videoApplyBtn;
    this.videoHintEl = videoHint;
    this.titleWandEl = titleWand;
    this.bodyWandEl = bodyWandBtn;
    this.mdToolbarRef = mdToolbarRef;
    this.previewFieldEl = previewField;
    this.previewLabelEl = previewLabel;
    this.previewHostEl = previewHost;
    this.previewTabsEl = previewTabs;
    this.previewTabRenderEl = previewTabRenderBtn;
    this.previewTabSourceEl = previewTabSourceBtn;
    this.previewOpenFullEl = previewOpenFullBtn;
    this._previewTab = 'render';
    this._previewText = '';
    this._previewKind = '';
    this._previewToken = 0;

    this._state = null;
    this.currentView = null;
    this._tags = [];
    this._readonly = false;
    this._lastCommittedLabel = '';
    this._lastCommittedTagsKey = '';
    this._lastCommittedBranchesKey = '';
    this._suppressInlineCommits = false;
  }

  _makeWandButton(field) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'em-wand';
    b.title = tr('translate_to_all');
    b.setAttribute('aria-label', tr('translate_to_all'));
    b.dataset.field = field;
    b.innerHTML = '<span aria-hidden="true">&#x2728;</span>';
    b.addEventListener('click', () => this._translateField(field));
    return b;
  }

  _setTextStyle(patch) {
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    if (!this._state) return;
    if (!this._state.text_style) this._state.text_style = {};
    Object.assign(this._state.text_style, patch || {});
    this._syncTextStyleButtons();
  }

  _syncTextStyleButtons() {
    const ts = (this._state && this._state.text_style) || {};
    for (const s of TEXT_SIZES) {
      const b = this.sizeBtnEls[s];
      if (b) b.classList.toggle('active', (ts.size || 'M') === s);
    }
    for (const f of TEXT_FAMILIES) {
      const b = this.familyBtnEls[f];
      if (b) b.classList.toggle('active', (ts.family || 'system') === f);
    }
    for (const a of TEXT_ALIGNS) {
      const b = this.alignBtnEls[a];
      if (b) b.classList.toggle('active', (ts.align || 'left') === a);
    }
    const cur = ts.color || 'auto';
    for (const [id, b] of Object.entries(this.textColorBtnEls)) {
      b.classList.toggle('active', id === cur);
    }
    if (this.wrapWordBtnEl) this.wrapWordBtnEl.classList.toggle('active', (ts.wrap || 'word') !== 'none');
    if (this.wrapNoneBtnEl) this.wrapNoneBtnEl.classList.toggle('active', ts.wrap === 'none');
  }

  _applyVideoUrl() {
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    if (!this._state) return;
    const url = (this.videoInputEl.value || '').trim();
    if (!url) {
      this._state.media = null;
      if (this.videoHintEl) this.videoHintEl.textContent = '';
      return;
    }
    const info = detectVideoUrl(url);
    if (!info) {
      this.videoHintEl.textContent = tr('edit_modal_video_unknown');
      this.videoHintEl.classList.add('em-video-hint-error');
      return;
    }
    this._state.media = info;
    this._state.kind = 'video';
    if (this.videoHintEl) {
      this.videoHintEl.textContent = tr('edit_modal_video_recognised', { provider: info.provider });
      this.videoHintEl.classList.remove('em-video-hint-error');
    }
  }

  async _translateField(field) {
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    const provider = getTranslationProvider();
    if (!provider || provider.name === 'none') {
      try { document.dispatchEvent(new CustomEvent('toast', { detail: { msg: tr('translate_set_up_hint'), kind: 'info' } })); } catch (e) { void e; }
      return;
    }
    const src = field === 'body'
      ? (this.mdInputEl.value || '')
      : field === 'caption'
        ? (this.captionTextEl.value || '')
        : (this.titleInputEl.value || '');
    if (!src.trim()) return;
    if (!this._translations) this._translations = {};
    const targets = LANGS.filter((l) => l !== 'en');
    try {
      const results = await translateMany(src, 'en', targets, provider);
      for (const [lang, value] of Object.entries(results)) {
        if (!value) continue;
        if (!this._translations[lang]) this._translations[lang] = { label: '', body: '' };
        if (field === 'body') this._translations[lang].body = value;
        else if (field === 'caption') {
          this._translations[lang].caption = this._translations[lang].caption || {};
          this._translations[lang].caption.text = value;
        }
        else this._translations[lang].label = value;
      }
      this._renderTranslations();
      try { document.dispatchEvent(new CustomEvent('toast', { detail: { msg: tr('translate_done', { provider: providerLabel(provider.name) }), kind: 'info' } })); } catch (e) { void e; }
    } catch (e) {
      console.warn('[edit-node-modal] translate failed', e);
      try { document.dispatchEvent(new CustomEvent('toast', { detail: { msg: tr('translate_failed'), kind: 'error' } })); } catch (er) { void er; }
    }
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

  async open(view, md) {
    if (!view) return;
    if (md === undefined) {
      const n = this.getNode(view.id);
      md = n ? nodeMarkdown(n) : (view.text || '');
    }
    this._suppressInlineCommits = true;
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
      text_style: view.text_style ? { ...view.text_style } : null,
      media: view.media ? { ...view.media } : null,
      branches: Array.isArray(view.branches) ? [...view.branches] : [],
      locked: !!view.locked,
      verification: typeof view.verification === 'string' ? view.verification : '',
      source_url: typeof view.source_url === 'string' ? view.source_url : '',
      tool: typeof view.tool === 'string' ? view.tool : '',
      technique: typeof view.technique === 'string' ? view.technique : '',
      github_path: typeof view.github_path === 'string' ? view.github_path : '',
      bookmarked: !!view.bookmarked,
      input: typeof view.input === 'string' ? view.input : '',
      output: typeof view.output === 'string' ? view.output : '',
      method: typeof view.method === 'string' ? view.method : '',
      annotations: Array.isArray(view.annotations) ? view.annotations.map((a) => ({ ...a })) : [],
    };
    this.currentView = view;
    this._tags = [...this._state.tags];
    this._lastCommittedLabel = this._state.title || '';
    this._lastCommittedTagsKey = this._tagsKey(this._tags);
    this._lastCommittedBranchesKey = this._branchesKey(this._state.branches);
    this._translations = view.translations ? JSON.parse(JSON.stringify(view.translations)) : null;
    this._renderTranslations();
    this._renderBranches();
    const isImage = looksLikeImage(this._state);
    if (isImage) this._setImagePreview(this._state.file || '');
    const isVideo = this._state.kind === 'video' || (this._state.media && isVideoMediaKind(this._state.media.kind));
    if (isVideo) {
      this.videoInputEl.value = (this._state.media && this._state.media.url) || '';
      if (this.videoHintEl) {
        if (this._state.media && this._state.media.provider) {
          this.videoHintEl.textContent = tr('edit_modal_video_recognised', { provider: this._state.media.provider });
        } else this.videoHintEl.textContent = '';
      }
    }
    this._applyKindVisibility();
    this._populateMetadataFields();
    this._readonly = !this.canEdit();
    if (this.rootEl) this.rootEl.classList.toggle('em-readonly', this._readonly);
    if (this.signinHintEl) this.signinHintEl.classList.toggle('visible', this._readonly);
    this.deleteBtnEl.style.display = this._readonly ? 'none' : 'inline-block';
    this.saveBtnEl.disabled = this._readonly;
    this.titleInputEl.value = this._state.title;
    this._setStatus(this._state.status, true);
    this._renderTags();
    this._rebuildTagSuggestions();
    this.mdInputEl.value = this._state.md;
    if (!this._state.text_style) this._state.text_style = {};
    this._syncTextStyleButtons();
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
    this._refreshLockButton();
    this._loadPreview();
    if (this.panelEl) this.panelEl.classList.add('open');
    this._suppressInlineCommits = false;
    try { this.onOpenNode(view.id); } catch (e) { void e; }
  }

  _loadPreview() {
    const field = this.previewFieldEl;
    const host = this.previewHostEl;
    if (!field || !host) return;
    const s = this._state;
    if (!s || !s.file) { field.style.display = 'none'; host.innerHTML = ''; return; }
    const isImage = looksLikeImage(s);
    const isDoc = s.kind === 'document';
    if (!isDoc || isImage) { field.style.display = 'none'; host.innerHTML = ''; return; }
    field.style.display = 'flex';
    const mime = (s.mime || '').toLowerCase();
    const filename = s.name || s.file || '';
    const kind = pickRenderer(mime, filename);
    this._previewKind = kind;
    this._previewTab = 'render';
    const showHtmlTabs = kind === 'html';
    if (this.previewTabsEl) this.previewTabsEl.style.display = showHtmlTabs ? '' : 'none';
    if (showHtmlTabs) this._syncPreviewTabButtons();
    if (this.previewOpenFullEl) {
      this.previewOpenFullEl.style.display = typeof this.onOpenFullViewer === 'function' ? '' : 'none';
    }
    const token = ++this._previewToken;
    if (kind === 'pdf') {
      renderPdfInto(host, s.file);
      return;
    }
    if (kind === 'image') {
      renderImageInto(host, s.file, filename);
      return;
    }
    host.innerHTML = '';
    const status = document.createElement('div');
    status.className = 'em-preview-status';
    status.textContent = tr('file_preview_loading');
    host.appendChild(status);
    if (kind === 'hex') {
      this._loadHexPreview(token, host, filename);
    } else {
      this._loadTextPreview(token, host, mime, filename, kind);
    }
  }

  _loadTextPreview(token, host, mime, filename, kind) {
    const id = this._state ? this._state.id : null;
    const url = this._state ? this._state.file : null;
    const cached = id ? this._fileBodyCache.get(id) : null;
    const apply = (text) => {
      if (token !== this._previewToken) return;
      this._previewText = text;
      if (kind === 'html') {
        if (this._previewTab === 'render') renderHtmlInto(host, text);
        else renderTextInto(host, text, mime, filename);
      } else if (kind === 'json') {
        renderJsonInto(host, text);
      } else {
        renderTextInto(host, text, mime, filename);
      }
    };
    if (cached != null) { apply(cached); return; }
    fetchAsText(url).then((text) => {
      if (id) this._fileBodyCache.set(id, text);
      apply(text);
    }).catch((e) => {
      if (token !== this._previewToken) return;
      host.innerHTML = '';
      const err = document.createElement('div');
      err.className = 'em-preview-status is-error';
      err.textContent = (e && e.message) || tr('file_preview_fetch_failed');
      host.appendChild(err);
    });
  }

  _loadHexPreview(token, host, filename) {
    const id = this._state ? this._state.id : null;
    const url = this._state ? this._state.file : null;
    const cached = id ? this._fileBytesCache.get(id) : null;
    const apply = (bytes) => {
      if (token !== this._previewToken) return;
      renderHexInto(host, bytes, { onDownload: () => this._downloadPreviewFile(filename) });
    };
    if (cached) { apply(cached); return; }
    fetchAsBytes(url).then((bytes) => {
      if (id) this._fileBytesCache.set(id, bytes);
      apply(bytes);
    }).catch((e) => {
      if (token !== this._previewToken) return;
      host.innerHTML = '';
      const err = document.createElement('div');
      err.className = 'em-preview-status is-error';
      err.textContent = (e && e.message) || tr('file_preview_fetch_failed');
      host.appendChild(err);
    });
  }

  _setPreviewTab(name) {
    if (this._previewKind !== 'html') return;
    this._previewTab = name === 'source' ? 'source' : 'render';
    this._syncPreviewTabButtons();
    const host = this.previewHostEl;
    if (!host || this._previewText == null) return;
    const mime = this._state ? (this._state.mime || '').toLowerCase() : 'text/html';
    const filename = this._state ? (this._state.name || this._state.file || '') : '';
    if (this._previewTab === 'render') renderHtmlInto(host, this._previewText);
    else renderTextInto(host, this._previewText, mime, filename);
  }

  _syncPreviewTabButtons() {
    if (this.previewTabRenderEl) this.previewTabRenderEl.classList.toggle('active', this._previewTab === 'render');
    if (this.previewTabSourceEl) this.previewTabSourceEl.classList.toggle('active', this._previewTab === 'source');
  }

  _openFullViewer() {
    if (typeof this.onOpenFullViewer !== 'function') return;
    if (!this._state) return;
    const view = this.currentView || this._state;
    try { this.onOpenFullViewer(view); } catch (e) { void e; }
  }

  _downloadPreviewFile(filename) {
    if (!this._state || !this._state.file) return;
    const a = document.createElement('a');
    a.href = this._state.file;
    a.download = filename || 'file';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  invalidatePreviewCache(id) {
    if (!id) return;
    this._fileBodyCache.delete(id);
    this._fileBytesCache.delete(id);
  }

  isOpen() {
    return !!(this.panelEl && this.panelEl.classList.contains('open'));
  }

  currentSlug() {
    return this.currentView ? this.currentView.slug : null;
  }

  currentMarkdown() {
    return (this._state && this._state.md) || '';
  }

  setNodeMeta(view) {
    if (!this.isOpen() || !this._state) return;
    if (!view || view.id !== this._state.id) return;
    this._suppressInlineCommits = true;
    this.currentView = view;
    this._state.title = view.title || '';
    this._state.status = view.status || 'unsolved';
    this._state.tags = Array.isArray(view.tags) ? [...view.tags] : [];
    this._state.branches = Array.isArray(view.branches) ? [...view.branches] : [];
    this._state.locked = !!view.locked;
    this._state.color = view.color || '';
    this._state.parent = view.parent || '';
    this._state.caption = view.caption ? { ...view.caption } : this._state.caption;
    if (view.kind) this._state.kind = view.kind;
    if (view.mime !== undefined) this._state.mime = view.mime;
    if (view.media !== undefined) this._state.media = view.media ? { ...view.media } : null;
    if (view.verification !== undefined) this._state.verification = view.verification || '';
    if (view.source_url !== undefined) this._state.source_url = view.source_url || '';
    if (view.tool !== undefined) this._state.tool = view.tool || '';
    if (view.technique !== undefined) this._state.technique = view.technique || '';
    if (view.github_path !== undefined) this._state.github_path = view.github_path || '';
    if (view.bookmarked !== undefined) this._state.bookmarked = !!view.bookmarked;
    if (view.input !== undefined) this._state.input = view.input || '';
    if (view.output !== undefined) this._state.output = view.output || '';
    if (view.method !== undefined) this._state.method = view.method || '';
    if (view.annotations !== undefined) {
      this._state.annotations = Array.isArray(view.annotations) ? view.annotations.map((a) => ({ ...a })) : [];
    }
    this._tags = [...this._state.tags];
    this._lastCommittedLabel = this._state.title;
    this._lastCommittedTagsKey = this._tagsKey(this._tags);
    this._lastCommittedBranchesKey = this._branchesKey(this._state.branches);
    if (document.activeElement !== this.titleInputEl) {
      this.titleInputEl.value = this._state.title;
    }
    this._setStatus(this._state.status, true);
    this._renderTags();
    this._renderBranches();
    this._setColor(this._state.color, true);
    this._refreshLockButton();
    this._applyKindVisibility();
    this._populateMetadataFields();
    this._suppressInlineCommits = false;
  }

  _populateMetadataFields() {
    if (!this._state) return;
    if (this.metadataSourceInputEl && document.activeElement !== this.metadataSourceInputEl) {
      this.metadataSourceInputEl.value = this._state.source_url || '';
    }
    if (this.metadataToolInputEl && document.activeElement !== this.metadataToolInputEl) {
      this.metadataToolInputEl.value = this._state.tool || '';
    }
    if (this.metadataTechSelEl) {
      const v = this._state.technique || '';
      const opts = Array.from(this.metadataTechSelEl.options).map((o) => o.value);
      this.metadataTechSelEl.value = opts.includes(v) ? v : '';
    }
    this._syncVerificationButtons();
    this._syncBookmarkButton();
    this._applyMetadataVisibility();
  }

  refreshLocalised() {
    this._retranslate();
  }

  refreshStatusOptions() {
    if (!this.statusBtnEls) return;
    for (const s of STATUSES) {
      const b = this.statusBtnEls[s];
      if (b && b.lastChild) b.lastChild.textContent = this._statusLabel(s);
    }
  }

  refreshStatusDot(status) {
    if (!this._state) return;
    this._state.status = status;
    this._setStatus(status, true);
  }

  _setStatus(s, silent) {
    if (!STATUSES.includes(s)) return;
    if (!this._state) return;
    const prev = this._state.status;
    this._state.status = s;
    for (const k of STATUSES) {
      const b = this.statusBtnEls[k];
      if (b) b.classList.toggle('active', k === s);
    }
    if (!silent && !this._suppressInlineCommits && prev !== s) {
      if (this._readonly) { this.onUnauthedSubmit(); return; }
      this.onStatusChange(this._state.id, s);
    }
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

  _applyKindVisibility() {
    const s = this._state;
    if (!s) return;
    const probe = { kind: s.kind, type: s.type, mime: s.mime, media: s.media };
    const isImage = looksLikeImage(s);
    const isBlock = isBlockNode(probe);
    const isText = isTextNode(probe);
    const isSticky = isStickyNode(probe);
    const isPuzzle = isPuzzleNode(probe);
    const isGroup = isGroupNode(probe);
    const isVideo = isVideoNode(probe);
    const isAudio = isAudioNode(probe);
    const isDocument = isDocumentNode(probe);
    const isTransform = isTransformNode(probe);
    const showStatus = isBlock || isPuzzle || isVideo || isAudio || isDocument || isTransform;
    const showBody = !isTransform && (isText || isSticky || isPuzzle || isVideo || isAudio);
    const showCaption = !isTransform && ((isBlock && isImage) || isPuzzle || isVideo || isDocument);
    const showParent = !isGroup;
    const showTextStyle = isText;
    const showVideo = isVideo;
    const showImage = isBlock && isImage;
    const showAnnotations = isBlock && isImage;
    const showTransform = isTransform;
    const showExportMd = !isTransform && (isText || isSticky || isPuzzle);
    const showTranslations = !isTransform && (isText || isSticky || isPuzzle || isVideo || isAudio);
    const showProvenance = !isGroup;
    setDisp(this.statusFieldEl, showStatus);
    setDisp(this.bodyFieldEl, showBody);
    setDisp(this.captionFieldEl, showCaption);
    setDisp(this.parentFieldEl, showParent);
    setDisp(this.textStyleFieldEl, showTextStyle);
    setDisp(this.videoFieldEl, showVideo);
    setDisp(this.imageFieldEl, showImage);
    setDisp(this.annotationsFieldEl, showAnnotations);
    setDisp(this.transformFieldEl, showTransform);
    setDisp(this.translationsFieldEl, showTranslations);
    setDisp(this.provenanceFieldEl, showProvenance);
    if (this.exportBtnEl) this.exportBtnEl.style.display = showExportMd ? '' : 'none';
    if (this.openFullImageBtnEl) {
      this.openFullImageBtnEl.style.display = showImage && typeof this.onOpenFullViewer === 'function' ? '' : 'none';
    }
    if (showTransform) this._syncTransformFields();
    if (showAnnotations) this._renderAnnotationsList();
    if (showProvenance) this._syncProvenanceButton();
    this._applyMetadataVisibility();
  }

  _syncTransformFields() {
    if (!this._state) return;
    if (this.transformInputEl && document.activeElement !== this.transformInputEl) {
      this.transformInputEl.value = this._state.input || '';
    }
    if (this.transformOutputEl && document.activeElement !== this.transformOutputEl) {
      this.transformOutputEl.value = this._state.output || '';
    }
    const m = this._state.method || '';
    if (this.transformMethodSelEl) {
      const opts = Array.from(this.transformMethodSelEl.options).map((o) => o.value);
      if (m && !opts.includes(m)) {
        this.transformMethodSelEl.value = 'other';
        if (this.transformMethodCustomEl) {
          this.transformMethodCustomEl.style.display = '';
          if (document.activeElement !== this.transformMethodCustomEl) this.transformMethodCustomEl.value = m;
        }
      } else {
        this.transformMethodSelEl.value = m;
        if (this.transformMethodCustomEl) {
          this.transformMethodCustomEl.style.display = (m === 'other') ? '' : 'none';
          if (m !== 'other' && document.activeElement !== this.transformMethodCustomEl) this.transformMethodCustomEl.value = '';
        }
      }
    }
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
    this.tagsInputEl.value = '';
    if (!v) return;
    const lower = v.toLowerCase();
    const exists = this._tags.some((t) => String(t).toLowerCase() === lower);
    if (exists) return;
    this._tags.push(v);
    this._renderTags();
    this._commitTagsInline();
  }

  _commitTagsInline() {
    if (this._suppressInlineCommits || !this._state) return;
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    const key = this._tagsKey(this._tags);
    if (key === this._lastCommittedTagsKey) return;
    this._lastCommittedTagsKey = key;
    this._state.tags = [...this._tags];
    this.onTagsChange(this._state.id, [...this._tags]);
  }

  _commitLabelInline() {
    if (this._suppressInlineCommits || !this._state) return;
    const next = (this.titleInputEl.value || '').trim();
    if (next === this._lastCommittedLabel) return;
    if (this._readonly) {
      this.titleInputEl.value = this._lastCommittedLabel || '';
      this.onUnauthedSubmit();
      return;
    }
    this._lastCommittedLabel = next;
    this._state.title = next;
    this.onLabelChange(this._state.id, next);
  }

  _tagsKey(arr) {
    return JSON.stringify(Array.isArray(arr) ? arr : []);
  }

  _branchesKey(arr) {
    return JSON.stringify(Array.isArray(arr) ? arr.slice().sort() : []);
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
        this._commitTagsInline();
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

  _buildBranchesField() {
    const field = el('div', { class: 'em-field em-branches' });
    const lbl = el('label', { text: tr('branches_assign_label') });
    const host = el('div', { class: 'em-branches-host' });
    field.appendChild(lbl);
    field.appendChild(host);
    this.branchesFieldEl = field;
    this._branchesHostEl = host;
    this._branchesLabelEl = lbl;
    return field;
  }

  _buildTransformFields() {
    const wrap = el('div', { class: 'em-field em-transform' });
    const inputLabel = el('label', { text: tr('transform_input_label') });
    const inputTa = el('textarea', { rows: '3', class: 'em-transform-mono', placeholder: tr('transform_input_placeholder') });
    inputTa.addEventListener('blur', () => this._commitTransformField('input', inputTa.value));
    inputTa.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); inputTa.blur(); }
    });
    const methodLabel = el('label', { text: tr('transform_method_label') });
    const methodSel = el('select', { class: 'em-transform-method' });
    const methodNone = el('option', { value: '', text: tr('technique_none') });
    methodSel.appendChild(methodNone);
    for (const t of TECHNIQUES) {
      const o = el('option', { value: t, text: this._techniqueLabel(t) });
      methodSel.appendChild(o);
    }
    methodSel.addEventListener('change', () => this._commitTransformField('method', methodSel.value));
    const methodCustom = el('input', { type: 'text', class: 'em-transform-method-custom', placeholder: tr('transform_method_custom_placeholder') });
    methodCustom.addEventListener('blur', () => this._commitTransformField('method', methodCustom.value.trim()));
    methodCustom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); methodCustom.blur(); } });
    methodCustom.style.display = 'none';
    const outputLabel = el('label', { text: tr('transform_output_label') });
    const outputTa = el('textarea', { rows: '3', class: 'em-transform-mono', placeholder: tr('transform_output_placeholder') });
    outputTa.addEventListener('blur', () => this._commitTransformField('output', outputTa.value));
    outputTa.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); outputTa.blur(); }
    });
    wrap.appendChild(inputLabel);
    wrap.appendChild(inputTa);
    wrap.appendChild(methodLabel);
    wrap.appendChild(methodSel);
    wrap.appendChild(methodCustom);
    wrap.appendChild(outputLabel);
    wrap.appendChild(outputTa);
    wrap.style.display = 'none';
    this.transformFieldEl = wrap;
    this.transformInputLabelEl = inputLabel;
    this.transformInputEl = inputTa;
    this.transformMethodLabelEl = methodLabel;
    this.transformMethodSelEl = methodSel;
    this.transformMethodCustomEl = methodCustom;
    this.transformOutputLabelEl = outputLabel;
    this.transformOutputEl = outputTa;
    return wrap;
  }

  _buildAnnotationsField() {
    const wrap = el('div', { class: 'em-field em-annotations' });
    const header = el('button', { type: 'button', class: 'em-annotations-header' });
    const chev = el('span', { class: 'em-annotations-chev', text: '▸' });
    const headerLabel = el('span', { class: 'em-annotations-header-label', text: tr('annotations_section') });
    header.appendChild(chev); header.appendChild(headerLabel);
    const body = el('div', { class: 'em-annotations-body' });
    const list = el('div', { class: 'em-annotations-list' });
    const addRow = el('div', { class: 'em-annotations-add' });
    const kindSel = el('select', { class: 'em-annotation-kind' });
    for (const k of ANNOTATION_KINDS) {
      const o = el('option', { value: k, text: tr(`annotation_kind_${k}`) });
      kindSel.appendChild(o);
    }
    const textIn = el('input', { type: 'text', class: 'em-annotation-text', placeholder: tr('annotations_text_placeholder') });
    const colorIn = el('input', { type: 'color', class: 'em-annotation-color', value: '#e8c83d' });
    const addBtn = el('button', { type: 'button', class: 'modal-btn', text: tr('annotations_add') });
    addBtn.addEventListener('click', () => {
      this._addAnnotation({
        kind: kindSel.value,
        text: textIn.value || '',
        color: colorIn.value || '#e8c83d',
        x: 32, y: 32, w: 120, h: 64,
      });
      textIn.value = '';
    });
    addRow.appendChild(kindSel); addRow.appendChild(textIn); addRow.appendChild(colorIn); addRow.appendChild(addBtn);
    body.appendChild(list); body.appendChild(addRow);
    wrap.appendChild(header); wrap.appendChild(body);
    header.addEventListener('click', () => {
      const open = wrap.classList.toggle('em-annotations-open');
      chev.textContent = open ? '▾' : '▸';
    });
    wrap.style.display = 'none';
    this.annotationsFieldEl = wrap;
    this.annotationsHeaderLabelEl = headerLabel;
    this.annotationsListEl = list;
    this.annotationsKindSelEl = kindSel;
    this.annotationsAddBtnEl = addBtn;
    this.annotationsTextPlaceholderEl = textIn;
    return wrap;
  }

  _buildProvenanceField() {
    const wrap = el('div', { class: 'em-field em-provenance' });
    const btn = el('button', { type: 'button', class: 'em-provenance-btn modal-btn' });
    btn.textContent = tr('provenance_show');
    btn.addEventListener('click', () => this._toggleProvenance());
    wrap.appendChild(btn);
    wrap.style.display = 'none';
    this.provenanceFieldEl = wrap;
    this.provenanceBtnEl = btn;
    return wrap;
  }

  _renderAnnotationsList() {
    const host = this.annotationsListEl;
    if (!host) return;
    host.innerHTML = '';
    const items = (this._state && Array.isArray(this._state.annotations)) ? this._state.annotations : [];
    if (!items.length) {
      const empty = el('div', { class: 'em-annotations-empty', text: tr('annotations_empty') });
      host.appendChild(empty);
      return;
    }
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      const row = el('div', { class: 'em-annotation-row' });
      const k = el('span', { class: 'em-annotation-kindlabel', text: tr(`annotation_kind_${a.kind}`) });
      const swatch = el('span', { class: 'em-annotation-swatch' });
      swatch.style.background = a.color || '#e8c83d';
      const txt = el('input', { type: 'text', class: 'em-annotation-textin', value: a.text || '',
        placeholder: tr('annotations_text_placeholder') });
      txt.addEventListener('blur', () => this._patchAnnotation(i, { text: txt.value || '' }));
      txt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); txt.blur(); } });
      const delBtn = el('button', { type: 'button', class: 'em-annotation-del', html: '&times;',
        onclick: () => this._deleteAnnotation(i) });
      row.appendChild(swatch); row.appendChild(k); row.appendChild(txt); row.appendChild(delBtn);
      host.appendChild(row);
    }
  }

  _addAnnotation(spec) {
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    if (!this._state) return;
    const items = Array.isArray(this._state.annotations) ? this._state.annotations.slice() : [];
    const ann = {
      id: `ann-${Date.now().toString(36)}-${items.length}`,
      kind: spec.kind || 'rect',
      x: Number.isFinite(spec.x) ? spec.x : 32,
      y: Number.isFinite(spec.y) ? spec.y : 32,
      w: Number.isFinite(spec.w) ? spec.w : 120,
      h: Number.isFinite(spec.h) ? spec.h : 64,
      text: typeof spec.text === 'string' ? spec.text : '',
      color: typeof spec.color === 'string' ? spec.color : '#e8c83d',
      strokeWidth: 2,
    };
    items.push(ann);
    this._state.annotations = items;
    this._renderAnnotationsList();
    this._commitAnnotations();
  }

  _patchAnnotation(i, patch) {
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    if (!this._state) return;
    const items = Array.isArray(this._state.annotations) ? this._state.annotations.slice() : [];
    if (!items[i]) return;
    items[i] = { ...items[i], ...patch };
    this._state.annotations = items;
    this._commitAnnotations();
  }

  _deleteAnnotation(i) {
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    if (!this._state) return;
    const items = Array.isArray(this._state.annotations) ? this._state.annotations.slice() : [];
    if (i < 0 || i >= items.length) return;
    items.splice(i, 1);
    this._state.annotations = items;
    this._renderAnnotationsList();
    this._commitAnnotations();
  }

  _commitAnnotations() {
    if (this._suppressInlineCommits || !this._state) return;
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    this.onAnnotationsChange(this._state.id, Array.isArray(this._state.annotations) ? this._state.annotations.slice() : []);
  }

  _commitTransformField(field, value) {
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    if (!this._state) return;
    if (this._suppressInlineCommits) return;
    const next = typeof value === 'string' ? value : '';
    if ((this._state[field] || '') === next) return;
    this._state[field] = next;
    if (typeof this.onMetadataChange === 'function') this.onMetadataChange(this._state.id, { [field]: next });
  }

  _toggleProvenance() {
    if (!this._state) return;
    const cur = !!this.isProvenanceActive(this._state.id);
    const next = !cur;
    this.onProvenanceToggle(this._state.id, next);
    this._syncProvenanceButton();
  }

  _syncProvenanceButton() {
    if (!this.provenanceBtnEl || !this._state) return;
    const on = !!this.isProvenanceActive(this._state.id);
    this.provenanceBtnEl.classList.toggle('on', on);
    this.provenanceBtnEl.textContent = on ? tr('provenance_hide') : tr('provenance_show');
  }

  _buildMetadataSection() {
    const field = el('div', { class: 'em-field em-metadata' });
    const header = el('button', { type: 'button', class: 'em-metadata-header' });
    const chev = el('span', { class: 'em-metadata-chev', text: '▾' });
    const headerLabel = el('span', { class: 'em-metadata-header-label', text: tr('metadata_section') });
    header.appendChild(chev);
    header.appendChild(headerLabel);
    const body = el('div', { class: 'em-metadata-body' });

    const verifLabel = el('label', { text: tr('verification_label') });
    const verifSeg = el('div', { class: 'em-segmented' });
    const verifBtns = {};
    const verifChoices = [...VERIFICATIONS, ''];
    for (const v of verifChoices) {
      const b = el('button', { type: 'button', 'data-verif': v || 'none',
        text: this._verificationLabel(v) });
      b.addEventListener('click', () => this._setVerification(v));
      verifSeg.appendChild(b);
      verifBtns[v || 'none'] = b;
    }

    const sourceLabel = el('label', { text: tr('source_url_label') });
    const sourceInput = el('input', { type: 'text', placeholder: tr('source_url_placeholder') });
    sourceInput.addEventListener('blur', () => this._commitMetadataField('source_url', sourceInput.value.trim()));
    sourceInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sourceInput.blur(); } });

    const toolLabel = el('label', { text: tr('tool_label') });
    const toolInput = el('input', { type: 'text', placeholder: tr('tool_placeholder') });
    toolInput.addEventListener('blur', () => this._commitMetadataField('tool', toolInput.value.trim()));
    toolInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); toolInput.blur(); } });

    const techLabel = el('label', { text: tr('technique_label') });
    const techSel = el('select');
    const techNone = el('option', { value: '', text: tr('technique_none') });
    techSel.appendChild(techNone);
    for (const t of TECHNIQUES) {
      const o = el('option', { value: t, text: this._techniqueLabel(t) });
      techSel.appendChild(o);
    }
    techSel.addEventListener('change', () => this._commitMetadataField('technique', techSel.value));

    const ghLabel = el('label', { text: tr('github_path_label') });
    const ghRow = el('div', { class: 'em-metadata-gh-row' });
    const ghInput = el('input', { type: 'text', readonly: 'readonly' });
    const ghOpenBtn = el('button', { type: 'button', class: 'modal-btn', text: tr('open_on_github') });
    ghOpenBtn.addEventListener('click', () => this._openGithubPath());
    const ghResyncBtn = el('button', { type: 'button', class: 'modal-btn', text: tr('resync_from_github') });
    ghResyncBtn.addEventListener('click', () => this._resyncFromGithub());
    ghRow.appendChild(ghInput);
    ghRow.appendChild(ghOpenBtn);
    ghRow.appendChild(ghResyncBtn);

    const bookmarkRow = el('div', { class: 'em-metadata-bookmark-row' });
    const bookmarkBtn = el('button', { type: 'button', class: 'em-metadata-bookmark-btn' });
    const star = el('span', { class: 'em-metadata-bookmark-star', text: '☆' });
    const bmLabel = el('span', { class: 'em-metadata-bookmark-label', text: tr('bookmark_toggle') });
    bookmarkBtn.appendChild(star);
    bookmarkBtn.appendChild(bmLabel);
    bookmarkBtn.addEventListener('click', () => this._toggleBookmark());
    bookmarkRow.appendChild(bookmarkBtn);

    body.appendChild(verifLabel);
    body.appendChild(verifSeg);
    body.appendChild(sourceLabel);
    body.appendChild(sourceInput);
    body.appendChild(toolLabel);
    body.appendChild(toolInput);
    body.appendChild(techLabel);
    body.appendChild(techSel);
    body.appendChild(ghLabel);
    body.appendChild(ghRow);
    body.appendChild(bookmarkRow);

    field.appendChild(header);
    field.appendChild(body);

    header.addEventListener('click', () => {
      const open = field.classList.toggle('em-metadata-open');
      chev.textContent = open ? '▾' : '▸';
    });

    this.metadataFieldEl = field;
    this.metadataHeaderEl = header;
    this.metadataHeaderLabelEl = headerLabel;
    this.metadataChevEl = chev;
    this.metadataBodyEl = body;
    this.metadataVerifLabelEl = verifLabel;
    this.metadataVerifBtnEls = verifBtns;
    this.metadataSourceLabelEl = sourceLabel;
    this.metadataSourceInputEl = sourceInput;
    this.metadataToolLabelEl = toolLabel;
    this.metadataToolInputEl = toolInput;
    this.metadataTechLabelEl = techLabel;
    this.metadataTechSelEl = techSel;
    this.metadataGhLabelEl = ghLabel;
    this.metadataGhInputEl = ghInput;
    this.metadataGhOpenBtnEl = ghOpenBtn;
    this.metadataGhResyncBtnEl = ghResyncBtn;
    this.metadataBookmarkBtnEl = bookmarkBtn;
    this.metadataBookmarkStarEl = star;
    this.metadataBookmarkLabelEl = bmLabel;
    return field;
  }

  _verificationLabel(v) {
    if (!v) return tr('verification_none');
    return tr(`verification_${v}`);
  }

  _techniqueLabel(t) {
    if (!t) return tr('technique_none');
    return tr(`technique_${t}`);
  }

  _setVerification(v) {
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    if (!this._state) return;
    const norm = VERIFICATIONS.includes(v) ? v : '';
    this._state.verification = norm;
    this._syncVerificationButtons();
    if (!this._suppressInlineCommits) this.onMetadataChange(this._state.id, { verification: norm });
  }

  _syncVerificationButtons() {
    const cur = (this._state && this._state.verification) || '';
    const key = cur || 'none';
    for (const [k, b] of Object.entries(this.metadataVerifBtnEls || {})) {
      b.classList.toggle('active', k === key);
    }
  }

  _commitMetadataField(field, value) {
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    if (!this._state) return;
    if (this._suppressInlineCommits) return;
    const next = field === 'technique' && !TECHNIQUES.includes(value) ? '' : value;
    if ((this._state[field] || '') === (next || '')) return;
    if (next) this._state[field] = next;
    else delete this._state[field];
    this.onMetadataChange(this._state.id, { [field]: next || '' });
  }

  _toggleBookmark() {
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    if (!this._state) return;
    const next = !this._state.bookmarked;
    this._state.bookmarked = next;
    this._syncBookmarkButton();
    if (!this._suppressInlineCommits) this.onMetadataChange(this._state.id, { bookmarked: next });
  }

  _syncBookmarkButton() {
    if (!this.metadataBookmarkBtnEl) return;
    const on = !!(this._state && this._state.bookmarked);
    this.metadataBookmarkBtnEl.classList.toggle('on', on);
    if (this.metadataBookmarkStarEl) this.metadataBookmarkStarEl.textContent = on ? '★' : '☆';
  }

  _openGithubPath() {
    if (!this._state || !this._state.github_path) return;
    const origin = this.getGithubOrigin();
    if (!origin || !origin.owner || !origin.repo) return;
    const branch = origin.branch || 'main';
    const url = `https://github.com/${encodeURIComponent(origin.owner)}/${encodeURIComponent(origin.repo)}/blob/${encodeURIComponent(branch)}/${this._state.github_path.split('/').map(encodeURIComponent).join('/')}`;
    try { window.open(url, '_blank', 'noopener'); } catch (e) { void e; }
  }

  _resyncFromGithub() {
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    if (!this._state || !this._state.github_path) return;
    if (typeof this.onResyncFromGithub !== 'function') return;
    this.onResyncFromGithub(this._state.id);
  }

  _applyMetadataVisibility() {
    if (!this.metadataFieldEl || !this._state) return;
    const isGroup = isGroupNode({ kind: this._state.kind, type: this._state.type });
    setDisp(this.metadataFieldEl, !isGroup);
    const hasGhPath = !!(this._state.github_path);
    if (this.metadataGhInputEl) this.metadataGhInputEl.value = this._state.github_path || '';
    if (this.metadataGhOpenBtnEl) this.metadataGhOpenBtnEl.style.display = hasGhPath ? '' : 'none';
    if (this.metadataGhResyncBtnEl) {
      const canResync = hasGhPath && typeof this.onResyncFromGithub === 'function' && this.isAdmin();
      this.metadataGhResyncBtnEl.style.display = canResync ? '' : 'none';
    }
  }

  _renderBranches() {
    if (!this._branchesHostEl) return;
    this._branchesHostEl.innerHTML = '';
    const branches = this.getBranches() || [];
    if (!branches.length) {
      const empty = document.createElement('div');
      empty.className = 'em-branches-empty';
      empty.textContent = tr('branches_panel_title');
      this._branchesHostEl.appendChild(empty);
      return;
    }
    const cur = new Set((this._state && this._state.branches) || []);
    for (const b of branches) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'em-branch-chip';
      if (cur.has(b.id)) chip.classList.add('selected');
      chip.textContent = b.label || b.id;
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        if (!this._state) return;
        const c = Array.isArray(this._state.branches) ? this._state.branches.slice() : [];
        const idx = c.indexOf(b.id);
        if (idx >= 0) c.splice(idx, 1);
        else c.push(b.id);
        this._state.branches = c;
        this._renderBranches();
        this._commitBranchesInline();
      });
      this._branchesHostEl.appendChild(chip);
    }
  }

  _commitBranchesInline() {
    if (this._suppressInlineCommits || !this._state) return;
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    const key = this._branchesKey(this._state.branches);
    if (key === this._lastCommittedBranchesKey) return;
    this._lastCommittedBranchesKey = key;
    this.onBranchesChange(this._state.id, [...(this._state.branches || [])]);
  }

  _toggleLock() {
    if (!this._state) return;
    if (this._readonly) { this.onUnauthedSubmit(); return; }
    const next = !this._state.locked;
    this._state.locked = next;
    this._refreshLockButton();
    this.onLockToggle(this._state.id, next);
  }

  _refreshLockButton() {
    if (!this.lockBtnEl) return;
    const locked = !!(this._state && this._state.locked);
    this.lockBtnEl.textContent = tr(locked ? 'ctx_unlock' : 'ctx_lock');
    this.lockBtnEl.classList.toggle('locked', locked);
  }

  _exportMd() {
    if (!this._state) return;
    const slug = (this.currentView && this.currentView.slug) || this._state.id;
    const md = this.mdInputEl ? this.mdInputEl.value : (this._state.md || '');
    this.onExportMd(slug, md);
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

  requestClose() {
    if (this.onConfirmCloseWithUnsaved && this._isBodyDirty()) {
      this.onConfirmCloseWithUnsaved((discard) => {
        if (discard) this._closeImmediate();
      });
      return;
    }
    this._closeImmediate();
  }

  _isBodyDirty() {
    if (!this._state) return false;
    const cur = this.mdInputEl ? this.mdInputEl.value : '';
    return cur !== (this._state.md || '');
  }

  _closeImmediate() {
    const prevId = this._state ? this._state.id : null;
    if (this._state && typeof this.isProvenanceActive === 'function' && this.isProvenanceActive(this._state.id)) {
      try { this.onProvenanceToggle(this._state.id, false); } catch (e) { void e; }
    }
    if (this.panelEl) this.panelEl.classList.remove('open');
    this._state = null;
    this.currentView = null;
    this._tags = [];
    this._lastCommittedLabel = '';
    this._lastCommittedTagsKey = '';
    this._lastCommittedBranchesKey = '';
    if (this.titleInputEl) this.titleInputEl.value = '';
    if (this.tagsInputEl) this.tagsInputEl.value = '';
    if (this.mdInputEl) this.mdInputEl.value = '';
    if (this.captionTextEl) this.captionTextEl.value = '';
    if (this.metadataSourceInputEl) this.metadataSourceInputEl.value = '';
    if (this.metadataToolInputEl) this.metadataToolInputEl.value = '';
    if (this.metadataTechSelEl) this.metadataTechSelEl.value = '';
    if (this.metadataGhInputEl) this.metadataGhInputEl.value = '';
    this._renderTags();
    this._refreshLockButton();
    this._previewToken += 1;
    this._previewText = '';
    this._previewKind = '';
    if (this.previewFieldEl) this.previewFieldEl.style.display = 'none';
    if (this.previewHostEl) this.previewHostEl.innerHTML = '';
    if (typeof this.onClose === 'function') this.onClose(prevId);
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
        if (slot && (slot.label || slot.body || (slot.caption && slot.caption.text))) cleaned[l] = { ...slot };
      }
      payload.translations = Object.keys(cleaned).length ? cleaned : null;
    } else {
      payload.translations = null;
    }
    if (this._state.text_style && Object.keys(this._state.text_style).length) {
      payload.text_style = { ...this._state.text_style };
    } else {
      payload.text_style = null;
    }
    if (this._state.media) payload.media = { ...this._state.media };
    else payload.media = null;
    payload.branches = Array.isArray(this._state.branches) ? [...this._state.branches] : [];
    payload.verification = this._state.verification || '';
    payload.source_url = this._state.source_url || '';
    payload.tool = this._state.tool || '';
    payload.technique = this._state.technique || '';
    payload.github_path = this._state.github_path || '';
    payload.bookmarked = !!this._state.bookmarked;
    if (this._state.kind === 'transform') {
      payload.input = typeof this._state.input === 'string' ? this._state.input : '';
      payload.output = typeof this._state.output === 'string' ? this._state.output : '';
      payload.method = typeof this._state.method === 'string' ? this._state.method : '';
    }
    payload.annotations = Array.isArray(this._state.annotations) ? this._state.annotations.map((a) => ({ ...a })) : [];
    this._state.md = payload.md;
    this.onSave(payload);
    if (typeof this.onContentChange === 'function') this.onContentChange(payload.id, payload.md, true);
  }

  _delete() {
    if (this._readonly) return;
    if (!this._state) return;
    const id = this._state.id;
    if (!confirm(tr('edit_modal_delete_confirm'))) return;
    this._closeImmediate();
    this.onDelete(id);
  }

  _retranslate() {
    if (this.signinHintEl) this.signinHintEl.textContent = tr('edit_modal_signin_hint');
    if (this.titleLabelEl) this.titleLabelEl.textContent = tr('edit_modal_title');
    if (this.statusLabelEl) this.statusLabelEl.textContent = tr('edit_modal_status');
    if (this.tagsLabelEl) this.tagsLabelEl.textContent = tr('edit_modal_tags');
    if (this.bodyLabelEl) this.bodyLabelEl.textContent = tr('edit_modal_body');
    if (this.bodyTabEditEl) this.bodyTabEditEl.textContent = tr('edit_modal_body_edit');
    if (this.bodyTabPreviewEl) this.bodyTabPreviewEl.textContent = tr('edit_modal_body_preview');
    if (this.captionLabelEl) this.captionLabelEl.textContent = tr('edit_modal_caption');
    for (const k of SIDES) {
      const b = this.captionSideEls[k];
      if (b) b.lastChild.textContent = this._sideLabel(k);
    }
    if (this.colorLabelEl) this.colorLabelEl.textContent = tr('edit_modal_color');
    if (this.parentLabelEl) this.parentLabelEl.textContent = tr('edit_modal_parent_group');
    if (this.translationsLabelEl) this.translationsLabelEl.textContent = tr('translations_header');
    if (this.translationsAddBtnEl) this.translationsAddBtnEl.textContent = tr('translations_add');
    if (this._branchesLabelEl) this._branchesLabelEl.textContent = tr('branches_assign_label');
    if (this.deleteBtnEl) this.deleteBtnEl.textContent = tr('edit_modal_delete');
    if (this.saveBtnEl) this.saveBtnEl.textContent = tr('edit_modal_save');
    if (this.exportBtnEl) this.exportBtnEl.textContent = tr('side_panel_export_md');
    if (this.imageLabelEl) this.imageLabelEl.textContent = tr('edit_modal_image');
    if (this.imagePreviewEmptyEl) this.imagePreviewEmptyEl.textContent = tr('edit_modal_image_empty');
    if (this.cropBtnEl) this.cropBtnEl.textContent = tr('edit_modal_crop_image');
    if (this.replaceBtnEl) this.replaceBtnEl.textContent = tr('edit_modal_replace_image');
    if (this.openFullImageBtnEl) this.openFullImageBtnEl.textContent = tr('file_viewer_open_full');
    for (const s of STATUSES) {
      const b = this.statusBtnEls[s];
      if (b && b.lastChild) b.lastChild.textContent = this._statusLabel(s);
    }
    if (this.parentSelectEl && this.parentSelectEl.options.length > 0) {
      this.parentSelectEl.options[0].textContent = tr('edit_modal_parent_none');
    }
    if (this.previewLabelEl) this.previewLabelEl.textContent = tr('file_preview_label');
    if (this.previewTabRenderEl) this.previewTabRenderEl.textContent = tr('file_viewer_render');
    if (this.previewTabSourceEl) this.previewTabSourceEl.textContent = tr('file_viewer_source');
    if (this.previewOpenFullEl) this.previewOpenFullEl.textContent = tr('file_viewer_open_full');
    if (this.metadataHeaderLabelEl) this.metadataHeaderLabelEl.textContent = tr('metadata_section');
    if (this.metadataVerifLabelEl) this.metadataVerifLabelEl.textContent = tr('verification_label');
    if (this.metadataSourceLabelEl) this.metadataSourceLabelEl.textContent = tr('source_url_label');
    if (this.metadataToolLabelEl) this.metadataToolLabelEl.textContent = tr('tool_label');
    if (this.metadataTechLabelEl) this.metadataTechLabelEl.textContent = tr('technique_label');
    if (this.metadataGhLabelEl) this.metadataGhLabelEl.textContent = tr('github_path_label');
    if (this.metadataGhOpenBtnEl) this.metadataGhOpenBtnEl.textContent = tr('open_on_github');
    if (this.metadataGhResyncBtnEl) this.metadataGhResyncBtnEl.textContent = tr('resync_from_github');
    if (this.metadataBookmarkLabelEl) this.metadataBookmarkLabelEl.textContent = tr('bookmark_toggle');
    if (this.transformInputLabelEl) this.transformInputLabelEl.textContent = tr('transform_input_label');
    if (this.transformMethodLabelEl) this.transformMethodLabelEl.textContent = tr('transform_method_label');
    if (this.transformOutputLabelEl) this.transformOutputLabelEl.textContent = tr('transform_output_label');
    if (this.transformInputEl) this.transformInputEl.placeholder = tr('transform_input_placeholder');
    if (this.transformOutputEl) this.transformOutputEl.placeholder = tr('transform_output_placeholder');
    if (this.transformMethodCustomEl) this.transformMethodCustomEl.placeholder = tr('transform_method_custom_placeholder');
    if (this.transformMethodSelEl) {
      for (const opt of this.transformMethodSelEl.options) {
        opt.textContent = opt.value ? this._techniqueLabel(opt.value) : tr('technique_none');
      }
    }
    if (this.annotationsHeaderLabelEl) this.annotationsHeaderLabelEl.textContent = tr('annotations_section');
    if (this.annotationsKindSelEl) {
      for (const opt of this.annotationsKindSelEl.options) {
        opt.textContent = tr(`annotation_kind_${opt.value}`);
      }
    }
    if (this.annotationsAddBtnEl) this.annotationsAddBtnEl.textContent = tr('annotations_add');
    if (this.annotationsTextPlaceholderEl) this.annotationsTextPlaceholderEl.placeholder = tr('annotations_text_placeholder');
    this._syncProvenanceButton();
    if (this.metadataSourceInputEl) this.metadataSourceInputEl.placeholder = tr('source_url_placeholder');
    if (this.metadataToolInputEl) this.metadataToolInputEl.placeholder = tr('tool_placeholder');
    if (this.metadataVerifBtnEls) {
      for (const [k, b] of Object.entries(this.metadataVerifBtnEls)) {
        const v = k === 'none' ? '' : k;
        if (b) b.textContent = this._verificationLabel(v);
      }
    }
    if (this.metadataTechSelEl) {
      for (const opt of this.metadataTechSelEl.options) {
        opt.textContent = opt.value ? this._techniqueLabel(opt.value) : tr('technique_none');
      }
    }
    this._refreshLockButton();
  }

  isReadonly() { return this._readonly; }
}
