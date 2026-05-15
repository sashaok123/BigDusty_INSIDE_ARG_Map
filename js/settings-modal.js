/* Settings modal. Stores translation provider config + test button. All in
   localStorage; nothing is sent to the project backend. */

import { tr, LANGS, getLang, setLang } from './i18n.js';
import { getSettings, setSettings } from './settings.js';
import { translateOne } from './translate.js';

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

export class SettingsModal {
  constructor() {
    this._build();
  }

  _build() {
    const modal = el('div', { id: 'auth-settings-modal', class: 'auth-modal' });
    const box = el('div', { class: 'auth-modal-box' });
    const head = el('div', { class: 'auth-modal-head' });
    const title = el('h2', { text: tr('settings_title') });
    const close = el('button', { type: 'button', class: 'auth-x', html: '&times;', onclick: () => this.close() });
    head.appendChild(title); head.appendChild(close);

    const body = el('div', { class: 'auth-modal-body' });

    const langLabel = el('label', { text: tr('settings_language') });
    const langSel = el('select');
    for (const l of LANGS) {
      const o = document.createElement('option');
      o.value = l; o.textContent = l.toUpperCase();
      langSel.appendChild(o);
    }
    langSel.value = getLang();
    langSel.addEventListener('change', () => setLang(langSel.value));
    body.appendChild(langLabel); body.appendChild(langSel);

    const keepOriginalField = el('div', { class: 'auth-settings-field auth-settings-toggle-row' });
    const keepOriginalLabel = el('label', { class: 'auth-settings-toggle-label' });
    const keepOriginalIn = el('input', { type: 'checkbox' });
    const keepOriginalText = el('span', { text: tr('settings_keep_original') });
    keepOriginalLabel.appendChild(keepOriginalIn);
    keepOriginalLabel.appendChild(keepOriginalText);
    const keepOriginalHint = el('div', { class: 'auth-settings-hint', text: tr('settings_keep_original_hint') });
    keepOriginalField.appendChild(keepOriginalLabel);
    keepOriginalField.appendChild(keepOriginalHint);
    body.appendChild(keepOriginalField);

    const providerLabel = el('label', { text: tr('settings_translation_provider') });
    const providerSel = el('select');
    for (const v of ['none', 'libretranslate', 'deepl', 'openai', 'anthropic']) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v === 'none' ? tr('settings_provider_none') : v;
      providerSel.appendChild(o);
    }

    const ltUrlLabel = el('label', { text: tr('settings_libretranslate_url') });
    const ltUrlIn = el('input', { type: 'text', placeholder: 'https://libretranslate.de', spellcheck: 'false' });
    const ltField = el('div', { class: 'auth-settings-field' }, [ltUrlLabel, ltUrlIn]);

    const deeplLabel = el('label', { text: tr('settings_deepl_key') });
    const deeplIn = el('input', { type: 'password', autocomplete: 'off', spellcheck: 'false' });
    const deeplField = el('div', { class: 'auth-settings-field' }, [deeplLabel, deeplIn]);

    const openaiLabel = el('label', { text: tr('settings_openai_key') });
    const openaiIn = el('input', { type: 'password', autocomplete: 'off', spellcheck: 'false' });
    const openaiModelLabel = el('label', { text: tr('settings_openai_model') });
    const openaiModelIn = el('input', { type: 'text', placeholder: 'gpt-4o-mini', spellcheck: 'false' });
    const openaiField = el('div', { class: 'auth-settings-field' }, [openaiLabel, openaiIn, openaiModelLabel, openaiModelIn]);

    const anthropicLabel = el('label', { text: tr('settings_anthropic_key') });
    const anthropicIn = el('input', { type: 'password', autocomplete: 'off', spellcheck: 'false' });
    const anthropicModelLabel = el('label', { text: tr('settings_anthropic_model') });
    const anthropicModelIn = el('input', { type: 'text', placeholder: 'claude-opus-4-7', spellcheck: 'false' });
    const anthropicField = el('div', { class: 'auth-settings-field' }, [anthropicLabel, anthropicIn, anthropicModelLabel, anthropicModelIn]);

    const refreshVisibility = () => {
      const v = providerSel.value;
      ltField.style.display = v === 'libretranslate' ? 'flex' : 'none';
      deeplField.style.display = v === 'deepl' ? 'flex' : 'none';
      openaiField.style.display = v === 'openai' ? 'flex' : 'none';
      anthropicField.style.display = v === 'anthropic' ? 'flex' : 'none';
    };

    providerSel.addEventListener('change', refreshVisibility);
    body.appendChild(providerLabel); body.appendChild(providerSel);
    body.appendChild(ltField); body.appendChild(deeplField); body.appendChild(openaiField); body.appendChild(anthropicField);

    const testRow = el('div', { class: 'auth-settings-test' });
    const testBtn = el('button', { type: 'button', class: 'modal-btn', text: tr('settings_translation_test') });
    const testOut = el('div', { class: 'auth-settings-test-out' });
    testRow.appendChild(testBtn); testRow.appendChild(testOut);
    body.appendChild(testRow);

    const actions = el('div', { class: 'auth-actions' });
    const saveBtn = el('button', { type: 'button', class: 'auth-primary', text: tr('settings_save') });
    actions.appendChild(saveBtn);
    body.appendChild(actions);

    box.appendChild(head); box.appendChild(body);
    modal.appendChild(box);
    document.body.appendChild(modal);

    saveBtn.addEventListener('click', () => {
      setSettings({
        translationProvider: providerSel.value,
        libretranslateUrl: ltUrlIn.value.trim(),
        deeplApiKey: deeplIn.value,
        openaiApiKey: openaiIn.value,
        openaiModel: openaiModelIn.value.trim() || 'gpt-4o-mini',
        anthropicApiKey: anthropicIn.value,
        anthropicModel: anthropicModelIn.value.trim() || 'claude-opus-4-7',
        keepOriginal: !!keepOriginalIn.checked,
      });
      this.close();
    });

    testBtn.addEventListener('click', async () => {
      testOut.textContent = '...';
      const provider = {
        name: providerSel.value,
        libretranslateUrl: ltUrlIn.value.trim(),
        deeplApiKey: deeplIn.value,
        openaiApiKey: openaiIn.value,
        openaiModel: openaiModelIn.value.trim() || 'gpt-4o-mini',
        anthropicApiKey: anthropicIn.value,
        anthropicModel: anthropicModelIn.value.trim() || 'claude-opus-4-7',
      };
      try {
        const result = await translateOne('Hello, world.', 'en', 'ru', provider);
        testOut.textContent = result || tr('settings_test_empty');
        testOut.classList.remove('error');
      } catch (e) {
        testOut.textContent = (e && e.message) || tr('settings_test_failed');
        testOut.classList.add('error');
      }
    });

    modal.addEventListener('mousedown', (e) => { if (e.target === modal) this.close(); });

    this.modalEl = modal;
    this.providerSelEl = providerSel;
    this.ltUrlIn = ltUrlIn;
    this.deeplIn = deeplIn;
    this.openaiIn = openaiIn;
    this.openaiModelIn = openaiModelIn;
    this.anthropicIn = anthropicIn;
    this.anthropicModelIn = anthropicModelIn;
    this.langSelEl = langSel;
    this.titleEl = title;
    this.saveBtnEl = saveBtn;
    this.testBtnEl = testBtn;
    this.keepOriginalInEl = keepOriginalIn;
    this.keepOriginalTextEl = keepOriginalText;
    this.keepOriginalHintEl = keepOriginalHint;
    this._refreshVisibility = refreshVisibility;

    document.addEventListener('i18n:changed', () => this._retranslate());
  }

  open() {
    const s = getSettings();
    this.providerSelEl.value = s.translationProvider || 'none';
    this.ltUrlIn.value = s.libretranslateUrl || '';
    this.deeplIn.value = s.deeplApiKey || '';
    this.openaiIn.value = s.openaiApiKey || '';
    this.openaiModelIn.value = s.openaiModel || 'gpt-4o-mini';
    this.anthropicIn.value = s.anthropicApiKey || '';
    this.anthropicModelIn.value = s.anthropicModel || 'claude-opus-4-7';
    if (this.keepOriginalInEl) this.keepOriginalInEl.checked = !!s.keepOriginal;
    this.langSelEl.value = getLang();
    this._refreshVisibility();
    this.modalEl.classList.add('open');
  }

  close() {
    this.modalEl.classList.remove('open');
  }

  _retranslate() {
    if (this.titleEl) this.titleEl.textContent = tr('settings_title');
    if (this.saveBtnEl) this.saveBtnEl.textContent = tr('settings_save');
    if (this.testBtnEl) this.testBtnEl.textContent = tr('settings_translation_test');
    if (this.keepOriginalTextEl) this.keepOriginalTextEl.textContent = tr('settings_keep_original');
    if (this.keepOriginalHintEl) this.keepOriginalHintEl.textContent = tr('settings_keep_original_hint');
  }
}
