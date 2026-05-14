/* Drag-and-drop + file-picker image upload. Binds dragover/drop on the canvas
   container, validates mime + size, uploads each file via `uploadImage` and
   asks the host to add a `type: "file"` block-node for it. */

import { tr } from './i18n.js';

export const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
export const ALLOWED_VIDEO_MIMES = new Set(['video/mp4', 'video/webm']);
export const ALLOWED_MIMES = new Set([...ALLOWED_IMAGE_MIMES, ...ALLOWED_VIDEO_MIMES]);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export function isVideoMime(mime) {
  return ALLOWED_VIDEO_MIMES.has(String(mime || '').toLowerCase());
}

export function validateImageFile(file) {
  if (!file || !file.type) return 'invalid_type';
  const mime = file.type.toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) return 'invalid_type';
  const max = isVideoMime(mime) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
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
    this._build();
    this._bind();
    this._setupHidden();
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
    this.dropEl = banner;
    this.dropInnerEl = inner;
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
      input.accept = 'image/png,image/jpeg,image/webp,video/mp4,video/webm';
      input.multiple = true;
      input.style.display = 'none';
      document.body.appendChild(input);
    }
    this.pickerEl = input;
    input.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (!files.length) return;
      await this._processFiles(files, null);
    });
  }

  openFilePicker() {
    if (!this.pickerEl) return;
    this.pickerEl.click();
  }

  _bind() {
    if (!this.viewport) return;
    let depth = 0;
    const show = () => {
      this.viewport.classList.add('drop-active');
    };
    const hide = () => {
      depth = 0;
      this.viewport.classList.remove('drop-active');
    };
    this.viewport.addEventListener('dragenter', (e) => {
      if (!this.isEnabled()) return;
      if (!this._hasImageFiles(e)) return;
      e.preventDefault();
      depth += 1;
      show();
    });
    this.viewport.addEventListener('dragover', (e) => {
      if (!this.isEnabled()) return;
      if (!this._hasImageFiles(e)) return;
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
      const files = Array.from(e.dataTransfer.files).filter((f) => ALLOWED_MIMES.has((f.type || '').toLowerCase()));
      hide();
      if (!files.length) {
        this.onToast(tr('upload_image_invalid_type'), 'error');
        return;
      }
      await this._processFiles(files, { clientX: e.clientX, clientY: e.clientY });
    });
  }

  _hasImageFiles(ev) {
    if (!ev.dataTransfer) return false;
    const items = ev.dataTransfer.items;
    if (items && items.length) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') return true;
      }
      return false;
    }
    return ev.dataTransfer.types && Array.prototype.indexOf.call(ev.dataTransfer.types, 'Files') >= 0;
  }

  async _processFiles(files, dropPoint) {
    let placed = 0;
    let offset = 0;
    for (const f of files) {
      const reason = validateImageFile(f);
      if (reason === 'invalid_type') { this.onToast(tr('upload_image_invalid_type'), 'error'); continue; }
      if (reason === 'too_large')   { this.onToast(tr('upload_image_too_large'),  'error'); continue; }
      try {
        const isVideo = isVideoMime(f.type);
        let toUpload = f;
        if (!isVideo && f.type && f.type !== 'image/webp') {
          const converted = await this._convertToWebP(f).catch(() => null);
          if (converted) {
            const baseName = (f.name || 'image').replace(/\.[^.]+$/, '') + '.webp';
            toUpload = new File([converted], baseName, { type: 'image/webp' });
          }
        }
        const result = await this.onUpload(toUpload);
        if (!result || !result.url) continue;
        let w; let h;
        if (isVideo) { w = 560; h = 320; }
        else {
          const dims = await this._readImageDims(toUpload).catch(() => null);
          w = dims ? dims.w : 400;
          h = dims ? dims.h : 300;
          const longest = Math.max(w, h) || 1;
          const target = 400;
          const scale = longest > target ? target / longest : 1;
          w = Math.max(40, Math.round(w * scale));
          h = Math.max(40, Math.round(h * scale));
        }
        const worldPt = dropPoint
          ? this.toClientToImage(dropPoint.clientX, dropPoint.clientY)
          : this._defaultWorldPoint();
        if (!worldPt) continue;
        const placement = {
          file: result.url,
          imageId: result.id || null,
          sha256: result.sha256 || null,
          mime: result.mime || f.type || 'image/png',
          size: result.size || f.size || 0,
          name: f.name || (isVideo ? 'video' : 'image'),
          kind: isVideo ? 'video' : 'image',
          rect: {
            x: Math.round(worldPt.x - w / 2 + offset),
            y: Math.round(worldPt.y - h / 2 + offset),
            w,
            h,
          },
        };
        await this.onPlaceNode(placement);
        placed += 1;
        offset += 24;
      } catch (e) {
        if (e && e.kind === 'auth_expired') {
          this.onToast(tr('login_error_credentials'), 'error');
          return;
        }
        console.warn('[uploader] failed', e);
        this.onToast(tr('upload_image_failed'), 'error');
      }
    }
    if (placed > 0) this.onToast(tr('upload_image_success', { n: placed }));
  }

  _convertToWebP(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = img.naturalWidth  || img.width;
          canvas.height = img.naturalHeight || img.height;
          const cx = canvas.getContext('2d');
          cx.drawImage(img, 0, 0);
          canvas.toBlob((b) => {
            try { URL.revokeObjectURL(url); } catch (e) { void e; }
            if (b) resolve(b);
            else reject(new Error('webp_conv_null'));
          }, 'image/webp', 0.9);
        } catch (e) {
          try { URL.revokeObjectURL(url); } catch (er) { void er; }
          reject(e);
        }
      };
      img.onerror = (e) => {
        try { URL.revokeObjectURL(url); } catch (er) { void er; }
        reject(e || new Error('img_load_failed'));
      };
      img.src = url;
    });
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
