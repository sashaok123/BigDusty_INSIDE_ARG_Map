/* Reusable color picker. Builds a panel with preset swatches (8 per row),
   a recent-colors row (8 max, persisted to localStorage), a collapsible
   visual HSV picker (hue slider + saturation/value square), and a hex
   input with Apply button. Calls onChange(value) where value is either a
   preset id (when allowPresetIds is set and value matches one) or a hex
   string like "#rrggbb". Pass swatchClass to style swatch buttons. */

import { tr } from './i18n.js';

const RECENT_STORAGE_KEY = 'arg.colorPicker.recent';
const VISUAL_OPEN_KEY = 'arg.colorPicker.visualOpen';
const RECENT_MAX = 8;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(s) {
  return typeof s === 'string' && HEX_RE.test(s);
}

function normaliseHex(s) {
  if (typeof s !== 'string') return null;
  const m = s.trim().toLowerCase();
  if (!HEX_RE.test(m)) return null;
  if (m.length === 4) {
    return '#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3];
  }
  return m;
}

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isHexColor).slice(0, RECENT_MAX);
  } catch (e) { void e; return []; }
}

function saveRecent(list) {
  try {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch (e) { void e; }
}

export function pushRecentColor(hex) {
  const n = normaliseHex(hex);
  if (!n) return;
  const cur = loadRecent();
  const idx = cur.indexOf(n);
  if (idx >= 0) cur.splice(idx, 1);
  cur.unshift(n);
  saveRecent(cur);
}

export function getRecentColors() {
  return loadRecent();
}

function loadVisualOpen() {
  try {
    return localStorage.getItem(VISUAL_OPEN_KEY) === '1';
  } catch (e) { void e; return false; }
}

function saveVisualOpen(open) {
  try {
    localStorage.setItem(VISUAL_OPEN_KEY, open ? '1' : '0');
  } catch (e) { void e; }
}

export function hexToRgb(hex) {
  const n = normaliseHex(hex);
  if (!n) return null;
  const r = parseInt(n.slice(1, 3), 16);
  const g = parseInt(n.slice(3, 5), 16);
  const b = parseInt(n.slice(5, 7), 16);
  return { r, g, b };
}

export function rgbToHex(r, g, b) {
  const ch = (v) => {
    const c = Math.max(0, Math.min(255, Math.round(v)));
    const s = c.toString(16);
    return s.length === 1 ? '0' + s : s;
  };
  return '#' + ch(r) + ch(g) + ch(b);
}

export function hsvToRgb(h, s, v) {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hh < 60)        { r1 = c; g1 = x; b1 = 0; }
  else if (hh < 120)  { r1 = x; g1 = c; b1 = 0; }
  else if (hh < 180)  { r1 = 0; g1 = c; b1 = x; }
  else if (hh < 240)  { r1 = 0; g1 = x; b1 = c; }
  else if (hh < 300)  { r1 = x; g1 = 0; b1 = c; }
  else                { r1 = c; g1 = 0; b1 = x; }
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

export function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn)      h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else                 h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

export function buildColorPicker(opts) {
  const presets = Array.isArray(opts && opts.presets) ? opts.presets : [];
  const current = opts && typeof opts.value === 'string' ? opts.value : '';
  const onChange = (opts && typeof opts.onChange === 'function') ? opts.onChange : () => {};
  const showAuto = !!(opts && opts.showAuto);
  const showNone = !!(opts && opts.showNone);
  const swatchClass = (opts && opts.swatchClass) || 'cp-swatch';
  const containerClass = (opts && opts.containerClass) || 'cp-root';
  const compact = !!(opts && opts.compact);

  const root = document.createElement('div');
  root.className = containerClass + (compact ? ' cp-compact' : '');

  const presetRow = document.createElement('div');
  presetRow.className = 'cp-presets';
  root.appendChild(presetRow);

  const presetButtons = [];

  if (showNone) {
    const noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    noneBtn.className = swatchClass + ' cp-none';
    noneBtn.title = tr('color_picker_none');
    noneBtn.setAttribute('aria-label', tr('color_picker_none'));
    noneBtn.addEventListener('click', () => {
      onChange('');
      syncActive('');
    });
    presetRow.appendChild(noneBtn);
    presetButtons.push({ value: '', el: noneBtn });
  }

  if (showAuto) {
    const autoBtn = document.createElement('button');
    autoBtn.type = 'button';
    autoBtn.className = swatchClass + ' cp-auto';
    autoBtn.textContent = 'A';
    autoBtn.title = tr('color_picker_auto');
    autoBtn.setAttribute('aria-label', tr('color_picker_auto'));
    autoBtn.addEventListener('click', () => {
      onChange('auto');
      syncActive('auto');
    });
    presetRow.appendChild(autoBtn);
    presetButtons.push({ value: 'auto', el: autoBtn });
  }

  for (const p of presets) {
    if (!p || typeof p.value !== 'string') continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = swatchClass;
    if (p.swatch) b.style.background = p.swatch;
    if (p.label) {
      b.title = p.label;
      b.setAttribute('aria-label', p.label);
    }
    b.addEventListener('click', () => {
      onChange(p.value);
      syncActive(p.value);
    });
    presetRow.appendChild(b);
    presetButtons.push({ value: p.value, el: b });
  }

  const toggleRow = document.createElement('div');
  toggleRow.className = 'cp-toggle-row';
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'cp-toggle';
  let visualOpen = loadVisualOpen();
  function renderToggleText() {
    toggleBtn.textContent = (visualOpen ? '▼ ' : '▶ ') + tr('color_picker_custom_hex');
  }
  renderToggleText();
  toggleRow.appendChild(toggleBtn);
  root.appendChild(toggleRow);

  const picker = document.createElement('div');
  picker.className = 'cp-picker';
  if (!visualOpen) picker.style.display = 'none';
  root.appendChild(picker);

  let hsv = { h: 0, s: 1, v: 1 };
  const startHex = isHexColor(current) ? normaliseHex(current) : null;
  if (startHex) {
    const rgb = hexToRgb(startHex);
    if (rgb) hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  }

  const hueSlider = document.createElement('div');
  hueSlider.className = 'cp-hue-slider';
  const hueMarker = document.createElement('div');
  hueMarker.className = 'cp-hue-marker';
  hueSlider.appendChild(hueMarker);
  picker.appendChild(hueSlider);

  const svSquare = document.createElement('div');
  svSquare.className = 'cp-sv-square';
  const svWhite = document.createElement('div');
  svWhite.className = 'cp-sv-white';
  svSquare.appendChild(svWhite);
  const svBlack = document.createElement('div');
  svBlack.className = 'cp-sv-black';
  svSquare.appendChild(svBlack);
  const svMarker = document.createElement('div');
  svMarker.className = 'cp-marker cp-sv-marker';
  svSquare.appendChild(svMarker);
  picker.appendChild(svSquare);

  function currentHueHex() {
    const rgb = hsvToRgb(hsv.h, 1, 1);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function syncVisualFromHsv() {
    hueMarker.style.left = `${(hsv.h / 360) * 100}%`;
    svWhite.style.background = `linear-gradient(to right, #ffffff, ${currentHueHex()})`;
    svMarker.style.left = `${hsv.s * 100}%`;
    svMarker.style.top = `${(1 - hsv.v) * 100}%`;
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    svMarker.style.background = rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function currentVisualHex() {
    const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
    return rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function emitVisual(commit) {
    const hex = currentVisualHex();
    if (isHexColor(hex)) hexInput.value = hex;
    if (commit) {
      pushRecentColor(hex);
      rebuildRecent();
      onChange(hex);
      syncActive(hex);
    } else {
      onChange(hex);
    }
  }

  function dragHue(ev) {
    const r = hueSlider.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, ev.clientX - r.left));
    hsv.h = (x / r.width) * 360;
    syncVisualFromHsv();
    emitVisual(false);
  }

  function dragSv(ev) {
    const r = svSquare.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, ev.clientX - r.left));
    const y = Math.max(0, Math.min(r.height, ev.clientY - r.top));
    hsv.s = x / r.width;
    hsv.v = 1 - (y / r.height);
    syncVisualFromHsv();
    emitVisual(false);
  }

  function attachDrag(target, onMoveFn) {
    target.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      onMoveFn(ev);
      const onMove = (e) => onMoveFn(e);
      const onUp = (e) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        onMoveFn(e);
        emitVisual(true);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  attachDrag(hueSlider, dragHue);
  attachDrag(svSquare, dragSv);

  toggleBtn.addEventListener('click', () => {
    visualOpen = !visualOpen;
    picker.style.display = visualOpen ? '' : 'none';
    saveVisualOpen(visualOpen);
    renderToggleText();
    if (visualOpen) syncVisualFromHsv();
  });

  const recentRow = document.createElement('div');
  recentRow.className = 'cp-recent';
  const recentLab = document.createElement('span');
  recentLab.className = 'cp-recent-label';
  recentLab.textContent = tr('color_picker_recent');
  recentRow.appendChild(recentLab);
  const recentList = document.createElement('div');
  recentList.className = 'cp-recent-list';
  recentRow.appendChild(recentList);
  root.appendChild(recentRow);

  function rebuildRecent() {
    while (recentList.firstChild) recentList.removeChild(recentList.firstChild);
    const list = loadRecent();
    if (!list.length) {
      const empty = document.createElement('span');
      empty.className = 'cp-recent-empty';
      empty.textContent = tr('color_picker_recent_empty');
      recentList.appendChild(empty);
      return;
    }
    for (const hex of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = swatchClass + ' cp-recent-swatch';
      b.style.background = hex;
      b.title = hex;
      b.setAttribute('aria-label', hex);
      b.addEventListener('click', () => {
        applyHexFromString(hex, true);
      });
      recentList.appendChild(b);
    }
  }
  rebuildRecent();

  const hexRow = document.createElement('div');
  hexRow.className = 'cp-hex-row';
  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.className = 'cp-hex-input';
  hexInput.placeholder = '#rrggbb';
  hexInput.spellcheck = false;
  hexInput.maxLength = 7;
  hexInput.value = isHexColor(current) ? current : '';
  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'cp-hex-apply';
  applyBtn.textContent = tr('color_picker_apply');
  const errSpan = document.createElement('span');
  errSpan.className = 'cp-hex-error';
  errSpan.textContent = '';
  hexRow.appendChild(hexInput);
  hexRow.appendChild(applyBtn);
  hexRow.appendChild(errSpan);
  root.appendChild(hexRow);

  function applyHexFromString(raw, commit) {
    const n = normaliseHex(raw);
    if (!n) {
      errSpan.textContent = tr('color_picker_invalid_hex');
      return false;
    }
    errSpan.textContent = '';
    hexInput.value = n;
    const rgb = hexToRgb(n);
    if (rgb) {
      hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      if (visualOpen) syncVisualFromHsv();
    }
    if (commit) {
      pushRecentColor(n);
      rebuildRecent();
      onChange(n);
      syncActive(n);
    } else {
      onChange(n);
    }
    return true;
  }

  function applyHex() {
    applyHexFromString(hexInput.value || '', true);
  }

  applyBtn.addEventListener('click', applyHex);
  hexInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      applyHex();
    }
  });
  hexInput.addEventListener('blur', () => {
    const raw = (hexInput.value || '').trim();
    if (!raw) return;
    if (normaliseHex(raw)) applyHex();
  });
  hexInput.addEventListener('input', () => {
    if (errSpan.textContent) errSpan.textContent = '';
    const raw = (hexInput.value || '').trim();
    const n = normaliseHex(raw);
    if (n && visualOpen) {
      const rgb = hexToRgb(n);
      if (rgb) {
        hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        syncVisualFromHsv();
      }
    }
  });

  function syncActive(active) {
    for (const it of presetButtons) {
      it.el.classList.toggle('active', it.value === active);
    }
    const recentBtns = recentList.querySelectorAll('.cp-recent-swatch');
    recentBtns.forEach((b) => {
      const hex = normaliseHex(active);
      b.classList.toggle('active', hex !== null && b.title.toLowerCase() === hex);
    });
  }
  syncActive(current);
  syncVisualFromHsv();

  return {
    root,
    setValue: (v) => {
      const next = typeof v === 'string' ? v : '';
      if (isHexColor(next)) {
        hexInput.value = next;
        const rgb = hexToRgb(next);
        if (rgb) {
          hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
          if (visualOpen) syncVisualFromHsv();
        }
      }
      syncActive(next);
    },
    refreshRecent: rebuildRecent,
  };
}
