/* Image compression pipeline. Keeps source dimensions unless the long side
   exceeds 6000 px (browser memory safety cap), then encodes WebP at quality
   0.92 / 0.8 / 0.7 until under 2 MB. Skips the recompression hop for already-
   small WebP/JPEG/PNG under 500 KB. The user controls displayed size by
   resizing the node on canvas; we only target weight, not resolution. */

const MAX_LONG_SIDE = 6000;
const TARGET_BYTES = 2 * 1024 * 1024;
const SKIP_RECOMPRESS_BELOW = 500 * 1024;
const QUALITY_LADDER = [0.92, 0.8, 0.7];

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve({ img, url }); };
    img.onerror = (e) => {
      try { URL.revokeObjectURL(url); } catch (er) { void er; }
      reject(e || new Error('img_load_failed'));
    };
    img.src = url;
  });
}

function drawScaled(img, targetW, targetH) {
  const canvas = document.createElement('canvas');
  canvas.width = targetW; canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (ctx && 'imageSmoothingQuality' in ctx) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => { if (b) resolve(b); else reject(new Error('canvas_toBlob_null')); }, type, quality);
  });
}

function isLikelyCompressedSmall(file) {
  if (!file || !file.type) return false;
  const mime = String(file.type).toLowerCase();
  const ok = mime === 'image/webp' || mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/png';
  return ok && typeof file.size === 'number' && file.size <= SKIP_RECOMPRESS_BELOW;
}

export function shouldSkipCompression(file) { return isLikelyCompressedSmall(file); }

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export async function compressImageBlob(file, opts) {
  if (!file || !file.type) return null;
  const onProgress = (opts && typeof opts.onProgress === 'function') ? opts.onProgress : null;
  const originalSize = file.size || 0;
  if (isLikelyCompressedSmall(file)) {
    return { blob: file, originalSize, finalSize: originalSize, skipped: true, quality: null, scaled: false, mime: file.type };
  }
  const loaded = await loadImage(file).catch(() => null);
  if (!loaded) return null;
  const { img, url } = loaded;
  try {
    const natW = img.naturalWidth || img.width || 0;
    const natH = img.naturalHeight || img.height || 0;
    if (!natW || !natH) {
      return { blob: file, originalSize, finalSize: originalSize, skipped: true, quality: null, scaled: false, mime: file.type };
    }
    const longest = Math.max(natW, natH);
    let targetW = natW; let targetH = natH; let scaled = false;
    if (longest > MAX_LONG_SIDE) {
      const scale = MAX_LONG_SIDE / longest;
      targetW = Math.max(1, Math.round(natW * scale));
      targetH = Math.max(1, Math.round(natH * scale));
      scaled = true;
    }
    const canvas = drawScaled(img, targetW, targetH);
    let best = null;
    for (let i = 0; i < QUALITY_LADDER.length; i++) {
      const q = QUALITY_LADDER[i];
      if (onProgress) {
        try { onProgress({ phase: 'encoding', quality: q, attempt: i + 1, total: QUALITY_LADDER.length }); } catch (e) { void e; }
      }
      const blob = await canvasToBlob(canvas, 'image/webp', q).catch(() => null);
      if (!blob) continue;
      best = { blob, quality: q };
      if (blob.size <= TARGET_BYTES) break;
    }
    if (!best) {
      return { blob: file, originalSize, finalSize: originalSize, skipped: true, quality: null, scaled: false, mime: file.type };
    }
    return {
      blob: best.blob, originalSize, finalSize: best.blob.size, skipped: false,
      quality: best.quality, scaled, mime: 'image/webp', width: targetW, height: targetH,
    };
  } finally {
    try { URL.revokeObjectURL(url); } catch (e) { void e; }
  }
}

export function deriveCompressedName(originalName) {
  return `${(originalName || 'image').replace(/\.[^.]+$/, '')}.webp`;
}
