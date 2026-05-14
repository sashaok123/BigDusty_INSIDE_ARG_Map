/* localStorage persistence + JSON export/import. State shape:
   { version: 1, hotspots: [...], puzzles: { slug: "md text", ... } } */

const STORAGE_KEY = 'arg_map_state';
const DEBOUNCE_MS = 500;

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

export function downloadJSON(state, filename = 'arg_map_state.json') {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

export function importJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (typeof data !== 'object' || data === null) {
          throw new Error('Not an object');
        }
        if (!Array.isArray(data.hotspots)) {
          throw new Error('Missing hotspots[]');
        }
        resolve(data);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsText(file);
  });
}
