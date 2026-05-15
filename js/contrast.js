/* Smart contrast helpers. pickTextColor returns near-black or near-white based
   on the luminance of a fill colour. bgFromTheme reads --bg from current theme.
   pickTextStroke returns the opposite-contrast colour for a 1 px text outline
   that keeps text readable on busy/mixed backgrounds. */

function hexToRgbAny(input) {
  if (!input) return null;
  const s = String(input).trim();
  let m = s.match(/^#?([0-9a-fA-F]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 4) h = h.split('').map((c) => c + c).join('').slice(0, 8);
    if (h.length !== 6 && h.length !== 8) return null;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
    return { r, g, b };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (m) {
    return { r: parseFloat(m[1]) || 0, g: parseFloat(m[2]) || 0, b: parseFloat(m[3]) || 0 };
  }
  return null;
}

export function relativeLuminance(input) {
  const rgb = hexToRgbAny(input);
  if (!rgb) return 0.5;
  const conv = (v) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
  };
  const r = conv(rgb.r);
  const g = conv(rgb.g);
  const b = conv(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function pickTextColor(bgColor, opts) {
  const lum = relativeLuminance(bgColor);
  const o = opts || {};
  const dark = o.dark || '#16181c';
  const light = o.light || '#f4f5f8';
  return lum > 0.55 ? dark : light;
}

export function pickTextStroke(bgColor, opts) {
  const lum = relativeLuminance(bgColor);
  const o = opts || {};
  return lum > 0.55 ? (o.lightStroke || 'rgba(255,255,255,0.85)') : (o.darkStroke || 'rgba(0,0,0,0.85)');
}

export function bgFromTheme() {
  try {
    const style = getComputedStyle(document.documentElement);
    const canvas = style.getPropertyValue('--canvas-bg').trim();
    if (canvas) return canvas;
    const v = style.getPropertyValue('--bg').trim();
    return v || '#ffffff';
  } catch (e) {
    void e;
    return '#ffffff';
  }
}

export function readCssVar(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || (fallback || '');
  } catch (e) {
    void e;
    return fallback || '';
  }
}

export function pickTextColorForCanvas(opts) {
  const bg = bgFromTheme();
  return pickTextColor(bg, opts);
}

export function pickTextStrokeForCanvas(opts) {
  const bg = bgFromTheme();
  return pickTextStroke(bg, opts);
}
