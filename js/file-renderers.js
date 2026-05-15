/* Pluggable file renderers. Same helpers feed FileViewerModal (full-screen)
   and the inline preview in the docked editor panel. Each renderer mounts
   into a host element and returns nothing; safe to call repeatedly. */

import { highlight, detectLanguage, escapeHtml } from './highlight.js';
import { tr } from './i18n.js';

const HEX_ROW_BYTES = 16;
const HEX_MAX_ROWS = 4096;
const HEX_MAX_BYTES = HEX_ROW_BYTES * HEX_MAX_ROWS;

const TEXT_LIKE_PREFIX = /^text\//;
const TEXT_LIKE_MIMES = new Set([
  'application/json', 'application/xml', 'text/xml',
  'application/javascript', 'text/javascript',
  'text/x-python', 'application/x-python',
  'application/x-sh', 'text/x-shellscript',
]);

export function isTextLikeMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (!m) return false;
  if (TEXT_LIKE_PREFIX.test(m)) return true;
  if (TEXT_LIKE_MIMES.has(m)) return true;
  return false;
}

export function pickRenderer(mime, filename) {
  const m = String(mime || '').toLowerCase();
  const f = String(filename || '').toLowerCase();
  if (m === 'application/pdf' || /\.pdf(?:\?|#|$)/.test(f)) return 'pdf';
  if (m === 'text/html' || /\.x?html?(?:\?|#|$)/.test(f)) return 'html';
  if (m === 'application/json' || /\.json(?:\?|#|$)/.test(f)) return 'json';
  if (/^image\//.test(m) || /\.(png|jpe?g|webp|gif|bmp|svg|avif|ico|tiff?)(?:\?|#|$)/.test(f)) return 'image';
  if (isTextLikeMime(m)) return 'text';
  const lang = detectLanguage(mime, filename);
  if (lang !== 'plain') return 'text';
  if (m && /^application\//.test(m)) return 'hex';
  return 'hex';
}

export function renderHtmlInto(el, text) {
  if (!el) return;
  el.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.sandbox = 'allow-same-origin';
  iframe.style.cssText = 'width:100%;height:100%;border:0;background:#fff;display:block';
  iframe.className = 'fr-iframe';
  el.appendChild(iframe);
  try {
    const doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
    if (doc) { doc.open(); doc.write(text || ''); doc.close(); }
  } catch (e) { void e; }
}

export function renderTextInto(el, text, mime, filename) {
  if (!el) return;
  el.innerHTML = '';
  const lang = detectLanguage(mime, filename);
  const pre = document.createElement('pre');
  pre.className = 'fr-pre';
  pre.dataset.lang = lang;
  pre.innerHTML = highlight(text || '', lang);
  el.appendChild(pre);
}

export function renderJsonInto(el, text) {
  if (!el) return;
  el.innerHTML = '';
  const pre = document.createElement('pre');
  pre.className = 'fr-pre fr-json';
  let obj = null;
  let err = null;
  try { obj = JSON.parse(text || ''); } catch (e) { err = e; }
  if (err) {
    const msg = document.createElement('div');
    msg.className = 'fr-error';
    msg.textContent = err.message;
    el.appendChild(msg);
    pre.innerHTML = highlight(text || '', 'json');
    el.appendChild(pre);
    return;
  }
  pre.innerHTML = renderJsonTree(obj, 0);
  el.appendChild(pre);
  pre.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('fr-tree-toggle')) return;
    const open = t.dataset.open === '1';
    t.dataset.open = open ? '0' : '1';
    t.textContent = open ? '▸' : '▾';
    let next = t.nextElementSibling;
    while (next && !next.classList.contains('fr-tree-end')) {
      next.style.display = open ? 'none' : '';
      next = next.nextElementSibling;
    }
  });
}

function renderJsonTree(obj, indent) {
  const pad = '  '.repeat(indent);
  if (obj === null) return '<span class="hl-null">null</span>';
  if (typeof obj === 'boolean') return `<span class="hl-bool">${obj}</span>`;
  if (typeof obj === 'number') return `<span class="hl-number">${obj}</span>`;
  if (typeof obj === 'string') return `<span class="hl-string">${escapeHtml(JSON.stringify(obj))}</span>`;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '<span class="hl-punct">[]</span>';
    const sub = obj.map((v) => `${pad}  ${renderJsonTree(v, indent + 1)}`).join(',\n');
    return `<span class="fr-tree-toggle" data-open="1">▾</span><span class="hl-punct">[</span>\n${sub}\n${pad}<span class="hl-punct">]</span>`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj);
    if (keys.length === 0) return '<span class="hl-punct">{}</span>';
    const sub = keys.map((k) => {
      const v = renderJsonTree(obj[k], indent + 1);
      return `${pad}  <span class="hl-prop">"${escapeHtml(k)}"</span><span class="hl-punct">:</span> ${v}`;
    }).join(',\n');
    return `<span class="fr-tree-toggle" data-open="1">▾</span><span class="hl-punct">{</span>\n${sub}\n${pad}<span class="hl-punct">}</span>`;
  }
  return escapeHtml(String(obj));
}

export function renderPdfInto(el, url) {
  if (!el) return;
  el.innerHTML = '';
  if (!url) return;
  const embed = document.createElement('embed');
  embed.type = 'application/pdf';
  embed.src = url;
  embed.style.cssText = 'width:100%;height:100%;display:block';
  el.appendChild(embed);
}

export function renderImageInto(el, url, alt) {
  if (!el) return;
  el.innerHTML = '';
  if (!url) return;
  const img = document.createElement('img');
  img.alt = alt || '';
  img.src = url;
  img.className = 'fr-image';
  el.appendChild(img);
}

export function renderHexInto(el, bytes, opts) {
  if (!el) return;
  el.innerHTML = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const total = arr.length;
  const truncated = total > HEX_MAX_BYTES;
  const view = truncated ? arr.subarray(0, HEX_MAX_BYTES) : arr;
  const opt = opts || {};
  if (truncated && opt.onDownload) {
    const notice = document.createElement('div');
    notice.className = 'fr-hex-notice';
    notice.textContent = tr('file_preview_hex_truncated', { shown: formatBytes(view.length), total: formatBytes(total) });
    const dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'fr-hex-download';
    dl.textContent = tr('file_viewer_download');
    dl.addEventListener('click', () => { try { opt.onDownload(); } catch (e) { void e; } });
    notice.appendChild(dl);
    el.appendChild(notice);
  } else if (truncated) {
    const notice = document.createElement('div');
    notice.className = 'fr-hex-notice';
    notice.textContent = tr('file_preview_hex_truncated', { shown: formatBytes(view.length), total: formatBytes(total) });
    el.appendChild(notice);
  }
  const pre = document.createElement('pre');
  pre.className = 'fr-pre fr-hex';
  pre.textContent = buildHexDump(view);
  el.appendChild(pre);
}

function buildHexDump(bytes) {
  const rows = [];
  const len = bytes.length;
  for (let i = 0; i < len; i += HEX_ROW_BYTES) {
    const end = Math.min(i + HEX_ROW_BYTES, len);
    const offset = i.toString(16).padStart(8, '0');
    const hexParts = [];
    const asciiParts = [];
    for (let j = i; j < i + HEX_ROW_BYTES; j++) {
      if (j < end) {
        const b = bytes[j];
        hexParts.push(b.toString(16).padStart(2, '0'));
        asciiParts.push(b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.');
      } else {
        hexParts.push('  ');
        asciiParts.push(' ');
      }
    }
    rows.push(`${offset}  ${hexParts.join(' ')}  ${asciiParts.join('')}`);
  }
  return rows.join('\n');
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export async function fetchAsText(url) {
  if (!url) throw new Error('no url');
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return await res.text();
}

export async function fetchAsBytes(url) {
  if (!url) throw new Error('no url');
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export { highlight, detectLanguage };
