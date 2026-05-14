/* localStorage persistence + canvas import/export. Current shape (v3):
   { version: 3, canvas: { nodes: [...], edges: [...] }, lang, puzzles }. */

import { legacyToCanvas, serializeCanvas } from './data-loader.js';

const STORAGE_KEY = 'arg_map_state';
const DEBOUNCE_MS = 1500;
const STATE_VERSION = 3;

let saveTimer = null;

export function saveState(state) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('[persistence] save failed', e);
    }
  }, DEBOUNCE_MS);
}

export function saveStateImmediate(state) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[persistence] save failed', e);
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[persistence] load failed', e);
    return null;
  }
}

export function clearState() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[persistence] clear failed', e);
  }
}

export function downloadCanvasFile(nodes, edges, filename = 'canvas.canvas') {
  const payload = serializeCanvas(nodes, edges);
  const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

export function importCanvasFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        resolve(parseImported(data));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsText(file);
  });
}

function parseImported(data) {
  if (!data || typeof data !== 'object') throw new Error('Not an object');
  if (Array.isArray(data.nodes) && Array.isArray(data.edges)) {
    return { nodes: data.nodes, edges: data.edges };
  }
  if (data.version === STATE_VERSION && data.canvas
      && Array.isArray(data.canvas.nodes) && Array.isArray(data.canvas.edges)) {
    return { nodes: data.canvas.nodes, edges: data.canvas.edges };
  }
  if (Array.isArray(data.hotspots)) {
    const legacy = {
      blocks: [],
      hotspots: data.hotspots,
      arrows: Array.isArray(data.arrows) ? data.arrows : [],
    };
    return legacyToCanvas(legacy);
  }
  throw new Error('Unknown file shape');
}
