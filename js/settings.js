/* Per-user settings persisted in localStorage. Translation provider config
   (LibreTranslate URL, DeepL key, OpenAI key) is never sent to the backend. */

const KEY = 'arg.settings';

const DEFAULTS = {
  translationProvider: 'none',
  libretranslateUrl: 'https://libretranslate.de',
  deeplApiKey: '',
  openaiApiKey: '',
  openaiModel: 'gpt-4o-mini',
  anthropicApiKey: '',
  anthropicModel: 'claude-opus-4-7-20251001',
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const obj = JSON.parse(raw);
    return { ...DEFAULTS, ...(obj && typeof obj === 'object' ? obj : {}) };
  } catch (e) {
    void e;
    return { ...DEFAULTS };
  }
}

function persist(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); }
  catch (e) { void e; }
}

let cache = null;

export function getSettings() {
  if (!cache) cache = load();
  return { ...cache };
}

export function setSettings(patch) {
  if (!patch || typeof patch !== 'object') return;
  cache = { ...getSettings(), ...patch };
  persist(cache);
  try {
    document.dispatchEvent(new CustomEvent('settings:changed', { detail: cache }));
  } catch (e) { void e; }
}

export function getTranslationProvider() {
  const s = getSettings();
  return {
    name: s.translationProvider || 'none',
    libretranslateUrl: s.libretranslateUrl,
    deeplApiKey: s.deeplApiKey,
    openaiApiKey: s.openaiApiKey,
    openaiModel: s.openaiModel,
    anthropicApiKey: s.anthropicApiKey,
    anthropicModel: s.anthropicModel,
  };
}
