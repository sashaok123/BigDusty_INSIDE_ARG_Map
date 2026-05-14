/* Tiny Markdown formatting toolbar above a <textarea>. Buttons wrap or
   prefix the current selection with the corresponding syntax. Pure DOM,
   no external libraries. */

import { tr } from './i18n.js';

const BUTTON_DEFS = [
  { id: 'bold',    icon: 'B',  i18n: 'md_tb_bold',    wrap: ['**', '**'] },
  { id: 'italic',  icon: 'I',  i18n: 'md_tb_italic',  wrap: ['*', '*'] },
  { id: 'strike',  icon: 'S',  i18n: 'md_tb_strike',  wrap: ['~~', '~~'] },
  { id: 'code',    icon: '<>', i18n: 'md_tb_code',    wrap: ['`', '`'] },
  { id: 'sep1',    kind: 'sep' },
  { id: 'h1',      icon: 'H1', i18n: 'md_tb_h1',      linePrefix: '# ' },
  { id: 'h2',      icon: 'H2', i18n: 'md_tb_h2',      linePrefix: '## ' },
  { id: 'sep2',    kind: 'sep' },
  { id: 'ul',      icon: '•',  i18n: 'md_tb_ul',      linePrefix: '- ' },
  { id: 'ol',      icon: '1.', i18n: 'md_tb_ol',      linePrefix: '1. ' },
  { id: 'sep3',    kind: 'sep' },
  { id: 'link',    icon: '🔗',  i18n: 'md_tb_link',    wrap: ['[', '](https://)'] },
  { id: 'image',   icon: '🖼',  i18n: 'md_tb_image',   wrap: ['![alt](', ')'] },
  { id: 'quote',   icon: '"',  i18n: 'md_tb_quote',   linePrefix: '> ' },
  { id: 'codeblk', icon: '```', i18n: 'md_tb_code_block', wrap: ['\n```\n', '\n```\n'] },
  { id: 'hr',      icon: 'HR', i18n: 'md_tb_hr',      insert: '\n\n---\n\n' },
];

function applyWrap(textarea, before, after) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const selected = value.slice(start, end);
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  textarea.value = next;
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = end + before.length;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

function applyLinePrefix(textarea, prefix) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  let lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd < 0) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const isNumbered = prefix === '1. ';
  const lines = block.split('\n').map((ln, i) => {
    if (isNumbered) return `${i + 1}. ${ln}`;
    return prefix + ln;
  });
  const replaced = lines.join('\n');
  textarea.value = value.slice(0, lineStart) + replaced + value.slice(lineEnd);
  textarea.selectionStart = lineStart;
  textarea.selectionEnd = lineStart + replaced.length;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

function applyInsert(textarea, text) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  textarea.value = value.slice(0, start) + text + value.slice(end);
  textarea.selectionStart = start + text.length;
  textarea.selectionEnd = start + text.length;
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.focus();
}

export function buildMarkdownToolbar(textareaRef, opts) {
  const wrap = document.createElement('div');
  wrap.className = 'md-toolbar';
  const buttons = [];
  for (const def of BUTTON_DEFS) {
    if (def.kind === 'sep') {
      const sep = document.createElement('span');
      sep.className = 'md-tb-sep';
      wrap.appendChild(sep);
      continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'md-tb-btn';
    b.dataset.id = def.id;
    b.dataset.i18n = def.i18n;
    b.title = tr(def.i18n);
    b.setAttribute('aria-label', tr(def.i18n));
    b.textContent = def.icon;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const ta = typeof textareaRef === 'function' ? textareaRef() : textareaRef;
      if (!ta) return;
      if (def.wrap) applyWrap(ta, def.wrap[0], def.wrap[1]);
      else if (def.linePrefix) applyLinePrefix(ta, def.linePrefix);
      else if (def.insert) applyInsert(ta, def.insert);
    });
    wrap.appendChild(b);
    buttons.push(b);
  }
  if (opts && opts.extraButtons) {
    for (const extra of opts.extraButtons) {
      wrap.appendChild(extra);
    }
  }
  const retranslate = () => {
    for (const b of buttons) {
      const k = b.dataset.i18n;
      if (k) { b.title = tr(k); b.setAttribute('aria-label', tr(k)); }
    }
  };
  document.addEventListener('i18n:changed', retranslate);
  return { el: wrap, retranslate };
}
