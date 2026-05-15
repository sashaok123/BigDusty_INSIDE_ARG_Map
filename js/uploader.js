/* Drag-and-drop + file-picker upload. Routes images through the compression
   pipeline (downscale + WebP) before upload. Accepts images, video, audio,
   and document files (html / text / json / csv / pdf). */

import { tr } from './i18n.js';
import { compressImageBlob, formatBytes, deriveCompressedName, shouldSkipCompression } from './image-pipeline.js';
import { getSettings } from './settings.js';

export const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const ALLOWED_VIDEO_MIMES = new Set(['video/mp4', 'video/webm']);
export const ALLOWED_AUDIO_MIMES = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav',
  'audio/webm', 'audio/aac', 'audio/flac',
]);
export const ALLOWED_DOC_MIMES = new Set([
  'text/html', 'text/plain', 'text/markdown', 'text/csv',
  'application/json', 'application/xml', 'text/xml', 'application/pdf',
  'text/css', 'application/javascript', 'text/javascript',
  'text/x-python', 'application/x-python',
  'application/x-sh', 'text/x-shellscript',
]);
export const ALLOWED_MIMES = new Set([
  ...ALLOWED_IMAGE_MIMES, ...ALLOWED_VIDEO_MIMES, ...ALLOWED_AUDIO_MIMES, ...ALLOWED_DOC_MIMES,
]);
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const MAX_DOC_BYTES = 5 * 1024 * 1024;
export const LARGE_AUDIO_WARN_BYTES = 5 * 1024 * 1024;

export function isImageMime(mime) { return ALLOWED_IMAGE_MIMES.has(String(mime || '').toLowerCase()); }
export function isVideoMime(mime) { return ALLOWED_VIDEO_MIMES.has(String(mime || '').toLowerCase()); }
export function isAudioMime(mime) {
  const m = String(mime || '').toLowerCase();
  return ALLOWED_AUDIO_MIMES.has(m) || /^audio\//.test(m);
}
export function isDocMime(mime) { return ALLOWED_DOC_MIMES.has(String(mime || '').toLowerCase()); }

export function isLargeWavOrFlac(file) {
  if (!file || !file.type || typeof file.size !== 'number') return false;
  const m = String(file.type).toLowerCase();
  if (m !== 'audio/wav' && m !== 'audio/x-wav' && m !== 'audio/flac') return false;
  return file.size > LARGE_AUDIO_WARN_BYTES;
}

function maxBytesFor(mime) {
  if (isVideoMime(mime)) return MAX_VIDEO_BYTES;
  if (isAudioMime(mime)) return MAX_AUDIO_BYTES;
  if (isDocMime(mime)) return MAX_DOC_BYTES;
  return MAX_IMAGE_BYTES;
}

function fileKindFromMime(mime) {
  if (isVideoMime(mime)) return 'video';
  if (isAudioMime(mime)) return 'audio';
  if (isDocMime(mime)) return 'document';
  return 'image';
}

export function validateImageFile(file) {
  if (!file || !file.type) return 'invalid_type';
  const mime = file.type.toLowerCase();
  if (!ALLOWED_MIMES.has(mime) && !isAudioMime(mime)) return 'invalid_type';
  const max = maxBytesFor(mime);
  if (typeof file.size === 'number' && file.size > max) return 'too_large';
  return null;
}

export class Uploader {
  constructor(opts) {
    this.viewport = opts.viewport;
    this.canvasEl = opts.canvasEl;
    this.isEnabled = opts.isEnabled || (() => true);
    this.toClientToImage = opts.toClientToImage || (() => null);
    this.onUpload = opts.onUpload || (() => Promise.resolve(null));
    this.onPlaceNode = opts.onPlaceNode || (() => {});
    this.onToast = opts.onToast || (() => {});
    this.onPickerCancel = opts.onPickerCancel || null;
    this.onConfirm = opts.onConfirm || ((msg) => Promise.resolve(window.confirm(msg)));
    this._compressToast = null;
    this._build(); this._bind(); this._setupHidden();
  }

  _build() {
    if (!this.viewport) return;
    const banner = document.createElement('div');
    banner.id = 'upload-dropzone';
    banner.className = 'upload-dropzone';
    const inner = document.createElement('div');
    inner.className = 'upload-dropzone-inner';
    inner.textContent = tr('upload_image_dragover');
    banner.appendChild(inner);
    this.viewport.appendChild(banner);
    this.dropEl = banner; this.dropInnerEl = inner;
    document.addEventListener('i18n:changed', () => {
      if (this.dropInnerEl) this.dropInnerEl.textContent = tr('upload_image_dragover');
    });
  }

  _setupHidden() {
    let input = document.getElementById('upload-image-picker');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'upload-image-picker';
      input.accept = [...ALLOWED_MIMES].join(',');
      input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);
    }
    this.pickerEl = input;
    input.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) await this._processFiles(files, null);
    });
  }

  openFilePicker(opts) {
    if (!this.pickerEl) return;
    this.pickerEl.accept = (opts && opts.accept) ? opts.accept : [...ALLOWED_MIMES].join(',');
    this.pickerEl.click();
    if (this.onPickerCancel && 'oncancel' in this.pickerEl) {
      const onCancel = () => { try { this.onPickerCancel(); } catch (e) { void e; } };
      this.pickerEl.addEventListener('cancel', onCancel, { once: true });
    }
  }

  openAudioPicker() {
    this.openFilePicker({ accept: [...ALLOWED_AUDIO_MIMES].join(',') });
  }

  _bind() {
    if (!this.viewport) return;
    let depth = 0;
    const show = () => { this.viewport.classList.add('drop-active'); };
    const hide = () => { depth = 0; this.viewport.classList.remove('drop-active'); };
    this.viewport.addEventListener('dragenter', (e) => {
      if (!this.isEnabled() || !this._hasImageFiles(e)) return;
      e.preventDefault(); depth += 1; show();
    });
    this.viewport.addEventListener('dragover', (e) => {
      if (!this.isEnabled() || !this._hasImageFiles(e)) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'copy'; } catch (err) { void err; }
      show();
    });
    this.viewport.addEventListener('dragleave', (e) => {
      void e;
      depth = Math.max(0, depth - 1);
      if (depth === 0) hide();
    });
    this.viewport.addEventListener('drop', async (e) => {
      if (!this.isEnabled()) { hide(); return; }
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) { hide(); return; }
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files).filter((f) => {
        const m = (f.type || '').toLowerCase();
        return ALLOWED_MIMES.has(m) || isAudioMime(m);
      });
      hide();
      if (!files.length) { this.onToast(tr('upload_image_invalid_type'), 'error'); return; }
      await this._processFiles(files, { clientX: e.clientX, clientY: e.clientY });
    });
  }

  _hasImageFiles(ev) {
    if (!ev.dataTransfer) return false;
    const items = ev.dataTransfer.items;
    if (items && items.length) {
      for (let i = 0; i < items.length; i++) if (items[i].kind === 'file') return true;
      return false;
    }
    return ev.dataTransfer.types && Array.prototype.indexOf.call(ev.dataTransfer.types, 'Files') >= 0;
  }

  _showCompressToast(origBytes) {
    const t = document.createElement('div');
    t.className = 'upload-compress-toast';
    t.textContent = tr('upload_compressing_toast', { from: formatBytes(origBytes) });
    document.body.appendChild(t);
    this._compressToast = t;
  }

  _updateCompressToast(originalBytes, finalBytes) {
    if (!this._compressToast) return;
    this._compressToast.textContent = tr('upload_compressed_to', {
      from: formatBytes(originalBytes), to: formatBytes(finalBytes),
    });
  }

  _hideCompressToast() {
    if (this._compressToast && this._compressToast.parentNode) {
      this._compressToast.parentNode.removeChild(this._compressToast);
    }
    this._compressToast = null;
  }

  async _processFiles(files, dropPoint) {
    let placed = 0; let offset = 0;
    for (const f of files) {
      const reason = validateImageFile(f);
      if (reason === 'invalid_type') { this.onToast(tr('upload_image_invalid_type'), 'error'); continue; }
      if (reason === 'too_large')   { this.onToast(tr('upload_image_too_large'),  'error'); continue; }
      try {
        const kind = fileKindFromMime(f.type);
        if (kind === 'audio' && isLargeWavOrFlac(f)) {
          const proceed = await this.onConfirm(tr('upload_large_audio_warning', { size: formatBytes(f.size) }));
          if (!proceed) continue;
        }
        let toUpload = f;
        const origSize = f.size || 0;
        let finalSize = origSize;
        let displayMime = f.type;
        let compressed = false;
        if (kind === 'image' && !shouldSkipCompression(f)) {
          this._showCompressToast(origSize);
          const result = await compressImageBlob(f).catch((err) => { console.warn('[uploader] compress failed', err); return null; });
          if (result && result.blob) {
            toUpload = new File([result.blob], deriveCompressedName(f.name), { type: result.mime || 'image/webp' });
            finalSize = result.finalSize;
            displayMime = result.mime || 'image/webp';
            compressed = !result.skipped;
            this._updateCompressToast(origSize, finalSize);
          }
          setTimeout(() => this._hideCompressToast(), 1100);
        }
        if (compressed) {
          this.onToast(tr('upload_compressed_to', { from: formatBytes(origSize), to: formatBytes(finalSize) }));
        }
        const settings = getSettings();
        const keepOriginal = !!settings.keepOriginal && compressed && origSize > finalSize;
        const uploadOpts = keepOriginal
          ? { keepOriginal: true, originalBlob: f, originalName: f.name || 'original' }
          : null;
        const result = await this.onUpload(toUpload, uploadOpts);
        if (!result || !result.url) continue;
        let w = 400; let h = 300;
        if (kind === 'video') { w = 560; h = 320; }
        else if (kind === 'audio') { w = 360; h = 110; }
        else if (kind === 'document') { w = 260; h = 200; }
        else {
          const dims = await this._readImageDims(toUpload).catch(() => null);
          w = dims ? dims.w : 400; h = dims ? dims.h : 300;
          const longest = Math.max(w, h) || 1;
          const scale = longest > 400 ? 400 / longest : 1;
          w = Math.max(40, Math.round(w * scale));
          h = Math.max(40, Math.round(h * scale));
        }
        const worldPt = dropPoint
          ? this.toClientToImage(dropPoint.clientX, dropPoint.clientY)
          : this._defaultWorldPoint();
        if (!worldPt) continue;
        await this.onPlaceNode({
          file: result.url,
          imageId: result.id || null,
          sha256: result.sha256 || null,
          mime: result.mime || displayMime || 'application/octet-stream',
          size: result.size || (toUpload && toUpload.size) || 0,
          originalSize: compressed && origSize > finalSize ? origSize : null,
          name: f.name || kind,
          kind,
          rect: {
            x: Math.round(worldPt.x - w / 2 + offset),
            y: Math.round(worldPt.y - h / 2 + offset),
            w, h,
          },
        });
        placed += 1; offset += 24;
      } catch (e) {
        if (e && e.kind === 'auth_expired') {
          this.onToast(tr('login_error_credentials'), 'error');
          this._hideCompressToast(); return;
        }
        console.warn('[uploader] failed', e);
        this.onToast(tr('upload_image_failed'), 'error');
        this._hideCompressToast();
      }
    }
    if (placed > 0) this.onToast(tr('upload_image_success', { n: placed }));
  }

  _defaultWorldPoint() {
    if (!this.canvasEl) return { x: 0, y: 0 };
    const r = this.canvasEl.getBoundingClientRect();
    return this.toClientToImage(r.left + r.width / 2, r.top + r.height / 2);
  }

  _readImageDims(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        try { URL.revokeObjectURL(url); } catch (e) { void e; }
        resolve({ w, h });
      };
      img.onerror = (e) => {
        try { URL.revokeObjectURL(url); } catch (er) { void er; }
        reject(e || new Error('img_dim_failed'));
      };
      img.src = url;
    });
  }
}
