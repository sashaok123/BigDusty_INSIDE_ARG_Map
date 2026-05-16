/* Reusable color picker. Builds a panel with preset swatches (8 per row),
   a recent-colors row (8 max, persisted to localStorage), and a hex input
   with Apply button. Calls onChange(value) where value is either a preset
   id (when allowPresetIds is set and value matches one) or a hex string
   like "#rrggbb". Pass swatchClass to style swatch buttons consistently
   with the host page's CSS (default: "cp-swatch"). */

import { tr } from './i18n.js';

const RECENT_STORAGE_KEY = 'arg.colorPicker.recent';
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
        onChange(hex);
        syncActive(hex);
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

  function applyHex() {
    const v = (hexInput.value || '').trim();
    const n = normaliseHex(v);
    if (!n) {
      errSpan.textContent = tr('color_picker_invalid_hex');
      return;
    }
    errSpan.textContent = '';
    hexInput.value = n;
    pushRecentColor(n);
    rebuildRecent();
    onChange(n);
    syncActive(n);
  }

  applyBtn.addEventListener('click', applyHex);
  hexInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      applyHex();
    }
  });
  hexInput.addEventListener('input', () => {
    if (errSpan.textContent) errSpan.textContent = '';
  });

  function syncActive(active) {
    for (const it of presetButtons) {
      it.el.classList.toggle('active', it.value === active);
    }
    const recentBtns = recentList.querySelectorAll('.cp-recent-swatch');
    recentBtns.forEach((b) => {
      const bg = (b.style.background || '').toLowerCase();
      const hex = normaliseHex(active);
      b.classList.toggle('active', hex !== null && b.title.toLowerCase() === hex);
    });
  }
  syncActive(current);

  return {
    root,
    setValue: (v) => {
      const next = typeof v === 'string' ? v : '';
      if (isHexColor(next)) hexInput.value = next;
      syncActive(next);
    },
    refreshRecent: rebuildRecent,
  };
}
