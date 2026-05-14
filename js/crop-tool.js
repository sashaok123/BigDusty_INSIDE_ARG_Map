/* Small standalone image cropper. `openCropper(imageUrl)` opens a fullscreen
   overlay with a draggable / resizable rect on top of the loaded image and
   resolves to a PNG Blob on Apply, or null on Cancel. Pure DOM + canvas, no
   external libs, aspect-ratio free. */

import { tr } from './i18n.js';

const MIN_RECT = 16;
const HANDLE_HIT = 12;

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

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e || new Error('image_load_failed'));
    img.src = url;
  });
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function normaliseRect(r, w, h) {
  let x = r.x, y = r.y, rw = r.w, rh = r.h;
  if (rw < 0) { x += rw; rw = -rw; }
  if (rh < 0) { y += rh; rh = -rh; }
  x = clamp(x, 0, w);
  y = clamp(y, 0, h);
  if (x + rw > w) rw = w - x;
  if (y + rh > h) rh = h - y;
  if (rw < MIN_RECT) rw = Math.min(MIN_RECT, w - x);
  if (rh < MIN_RECT) rh = Math.min(MIN_RECT, h - y);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(rw), h: Math.round(rh) };
}

export function openCropper(imageUrl) {
  return new Promise((resolve) => {
    if (!imageUrl) {
      resolve(null);
      return;
    }
    const overlay = el('div', { class: 'crop-overlay' });
    const box = el('div', { class: 'crop-box' });
    const head = el('div', { class: 'crop-head' });
    const title = el('h2', { text: tr('crop_title') });
    const hint = el('span', { class: 'crop-hint', text: tr('crop_drag_hint') });
    head.appendChild(title);
    head.appendChild(hint);
    const stage = el('div', { class: 'crop-stage' });
    const canvas = el('canvas', { class: 'crop-canvas' });
    const overlayRect = el('div', { class: 'crop-rect' });
    for (const k of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      const h = el('div', { class: `crop-handle crop-handle-${k}` });
      h.dataset.handle = k;
      overlayRect.appendChild(h);
    }
    stage.appendChild(canvas);
    stage.appendChild(overlayRect);
    const foot = el('div', { class: 'crop-foot' });
    const cancelBtn = el('button', { type: 'button', class: 'modal-btn cancel', text: tr('crop_cancel') });
    const applyBtn = el('button', { type: 'button', class: 'modal-btn primary', text: tr('crop_apply') });
    foot.appendChild(cancelBtn);
    foot.appendChild(applyBtn);
    box.appendChild(head);
    box.appendChild(stage);
    box.appendChild(foot);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    let finished = false;
    let imageEl = null;
    let imgW = 0;
    let imgH = 0;
    let displayScale = 1;
    let rect = { x: 0, y: 0, w: 0, h: 0 };
    let drag = null;

    const finish = (result) => {
      if (finished) return;
      finished = true;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      resolve(result);
    };

    const cancel = () => finish(null);

    const applyCrop = () => {
      if (!imageEl || !imgW || !imgH) { finish(null); return; }
      const r = normaliseRect(rect, imgW, imgH);
      if (r.w < 2 || r.h < 2) { finish(null); return; }
      const out = document.createElement('canvas');
      out.width = r.w;
      out.height = r.h;
      const ctx = out.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(imageEl, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      out.toBlob((blob) => finish(blob || null), 'image/png');
    };

    cancelBtn.addEventListener('click', cancel);
    applyBtn.addEventListener('click', applyCrop);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) cancel();
    });

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); applyCrop(); }
    };

    const renderOverlayRect = () => {
      const left = rect.x * displayScale;
      const top = rect.y * displayScale;
      const w = rect.w * displayScale;
      const h = rect.h * displayScale;
      overlayRect.style.left = `${left}px`;
      overlayRect.style.top = `${top}px`;
      overlayRect.style.width = `${w}px`;
      overlayRect.style.height = `${h}px`;
    };

    const layout = () => {
      if (!imageEl) return;
      const stageRect = stage.getBoundingClientRect();
      const availW = Math.max(40, stageRect.width - 24);
      const availH = Math.max(40, stageRect.height - 24);
      const s = Math.min(availW / imgW, availH / imgH, 1);
      displayScale = s > 0 ? s : 1;
      const dispW = Math.round(imgW * displayScale);
      const dispH = Math.round(imgH * displayScale);
      canvas.width = imgW;
      canvas.height = imgH;
      canvas.style.width = `${dispW}px`;
      canvas.style.height = `${dispH}px`;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, imgW, imgH);
      ctx.drawImage(imageEl, 0, 0, imgW, imgH);
      renderOverlayRect();
    };

    const onResize = () => layout();

    const stageToImage = (clientX, clientY) => {
      const r = canvas.getBoundingClientRect();
      const sx = (clientX - r.left) / (r.width || 1);
      const sy = (clientY - r.top) / (r.height || 1);
      return { x: clamp(sx * imgW, 0, imgW), y: clamp(sy * imgH, 0, imgH) };
    };

    const onMove = (e) => {
      if (!drag) return;
      e.preventDefault();
      const pt = stageToImage(e.clientX, e.clientY);
      const orig = drag.origRect;
      if (drag.kind === 'move') {
        const dx = pt.x - drag.start.x;
        const dy = pt.y - drag.start.y;
        const nx = clamp(orig.x + dx, 0, imgW - orig.w);
        const ny = clamp(orig.y + dy, 0, imgH - orig.h);
        rect = { x: nx, y: ny, w: orig.w, h: orig.h };
      } else if (drag.kind === 'resize') {
        let nx = orig.x;
        let ny = orig.y;
        let nw = orig.w;
        let nh = orig.h;
        const h = drag.handle;
        if (h.includes('w')) { nx = pt.x; nw = orig.x + orig.w - pt.x; }
        if (h.includes('e')) { nw = pt.x - orig.x; }
        if (h.includes('n')) { ny = pt.y; nh = orig.y + orig.h - pt.y; }
        if (h.includes('s')) { nh = pt.y - orig.y; }
        rect = normaliseRect({ x: nx, y: ny, w: nw, h: nh }, imgW, imgH);
      } else if (drag.kind === 'draw') {
        const nx = Math.min(drag.start.x, pt.x);
        const ny = Math.min(drag.start.y, pt.y);
        const nw = Math.abs(pt.x - drag.start.x);
        const nh = Math.abs(pt.y - drag.start.y);
        rect = normaliseRect({ x: nx, y: ny, w: nw, h: nh }, imgW, imgH);
      }
      renderOverlayRect();
    };

    const onUp = () => {
      if (!drag) return;
      drag = null;
    };

    overlayRect.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const target = e.target;
      const pt = stageToImage(e.clientX, e.clientY);
      if (target && target.classList && target.classList.contains('crop-handle')) {
        drag = { kind: 'resize', handle: target.dataset.handle, origRect: { ...rect }, start: pt };
      } else {
        drag = { kind: 'move', origRect: { ...rect }, start: pt };
      }
      e.preventDefault();
      e.stopPropagation();
    });

    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const pt = stageToImage(e.clientX, e.clientY);
      drag = { kind: 'draw', origRect: { ...rect }, start: pt };
      rect = { x: pt.x, y: pt.y, w: 0, h: 0 };
      renderOverlayRect();
      e.preventDefault();
    });

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);

    loadImage(imageUrl).then((img) => {
      imageEl = img;
      imgW = img.naturalWidth || img.width;
      imgH = img.naturalHeight || img.height;
      const m = Math.round(Math.min(imgW, imgH) * 0.1);
      rect = { x: m, y: m, w: Math.max(MIN_RECT, imgW - 2 * m), h: Math.max(MIN_RECT, imgH - 2 * m) };
      layout();
    }).catch(() => {
      finish(null);
    });
  });
}
