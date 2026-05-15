/* Auto-translate adapters. Three providers: libretranslate (free, public URL
   selectable), deepl (paid, free tier exists, user-supplied API key), openai
   (chat-completion style, user-supplied key). All calls run client-side; the
   API key never leaves the browser. */

const LANG_DEEPL = {
  en: 'EN', ru: 'RU', de: 'DE', it: 'IT', da: 'DA',
};

const LANG_NAMES = {
  en: 'English', ru: 'Russian', de: 'German', it: 'Italian', da: 'Danish',
};

export function providerLabel(p) {
  if (!p || p === 'none') return 'none';
  if (p === 'libretranslate') return 'LibreTranslate';
  if (p === 'deepl') return 'DeepL';
  if (p === 'openai') return 'OpenAI';
  if (p === 'anthropic') return 'Anthropic';
  return p;
}

export async function translateOne(text, sourceLang, targetLang, provider) {
  if (!text || !text.trim()) return '';
  if (!provider || provider.name === 'none') {
    const err = new Error('no_provider');
    err.kind = 'no_provider';
    throw err;
  }
  if (provider.name === 'libretranslate') {
    return libreTranslate(text, sourceLang, targetLang, provider);
  }
  if (provider.name === 'deepl') {
    return deeplTranslate(text, sourceLang, targetLang, provider);
  }
  if (provider.name === 'openai') {
    return openaiTranslate(text, sourceLang, targetLang, provider);
  }
  if (provider.name === 'anthropic') {
    return anthropicTranslate(text, sourceLang, targetLang, provider);
  }
  const err = new Error('unknown_provider');
  err.kind = 'unknown_provider';
  throw err;
}

export async function translateMany(text, sourceLang, targetLangs, provider) {
  const out = {};
  for (const t of targetLangs) {
    if (t === sourceLang) continue;
    try {
      out[t] = await translateOne(text, sourceLang, t, provider);
    } catch (e) {
      out[t] = '';
    }
  }
  return out;
}

async function libreTranslate(text, source, target, provider) {
  const base = (provider.libretranslateUrl || '').replace(/\/+$/, '');
  if (!base) {
    const err = new Error('libretranslate_no_url');
    err.kind = 'libretranslate_no_url';
    throw err;
  }
  const url = `${base}/translate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: source || 'auto', target, format: 'text' }),
  });
  if (!res.ok) {
    const err = new Error(`libretranslate_${res.status}`);
    err.kind = 'http';
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (data && typeof data.translatedText === 'string') return data.translatedText;
  return '';
}

async function deeplTranslate(text, source, target, provider) {
  const key = provider.deeplApiKey;
  if (!key) {
    const err = new Error('deepl_no_key');
    err.kind = 'deepl_no_key';
    throw err;
  }
  const apiBase = /:fx$/.test(key)
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate';
  const body = new URLSearchParams();
  body.append('text', text);
  body.append('target_lang', LANG_DEEPL[target] || target.toUpperCase());
  if (source && LANG_DEEPL[source]) body.append('source_lang', LANG_DEEPL[source]);
  const res = await fetch(apiBase, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `DeepL-Auth-Key ${key}`,
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const err = new Error(`deepl_${res.status}`);
    err.kind = 'http';
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (data && Array.isArray(data.translations) && data.translations[0]) {
    return data.translations[0].text || '';
  }
  return '';
}

async function anthropicTranslate(text, source, target, provider) {
  const key = provider.anthropicApiKey;
  if (!key) {
    const err = new Error('anthropic_no_key');
    err.kind = 'anthropic_no_key';
    throw err;
  }
  const model = provider.anthropicModel || 'claude-opus-4-7';
  const srcName = LANG_NAMES[source] || source;
  const tgtName = LANG_NAMES[target] || target;
  const prompt = `Translate the following text from ${srcName} to ${tgtName}. Return only the translation, no explanation.\n\n---\n${text}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const err = new Error(`anthropic_${res.status}`);
    err.kind = 'http';
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (data && Array.isArray(data.content) && data.content[0] && typeof data.content[0].text === 'string') {
    return data.content[0].text.trim();
  }
  return '';
}

async function openaiTranslate(text, source, target, provider) {
  const key = provider.openaiApiKey;
  if (!key) {
    const err = new Error('openai_no_key');
    err.kind = 'openai_no_key';
    throw err;
  }
  const model = provider.openaiModel || 'gpt-4o-mini';
  const srcName = LANG_NAMES[source] || source;
  const tgtName = LANG_NAMES[target] || target;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: `Translate the user message from ${srcName} to ${tgtName}. Output only the translated text, no explanations, no quotation marks.` },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
    }),
  });
  if (!res.ok) {
    const err = new Error(`openai_${res.status}`);
    err.kind = 'http';
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const out = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : '';
  return (out || '').trim();
}
