/* Multi-language syntax highlighter. Regex-based scanning emits
   `<span class="hl-*">` wrapped tokens. Supports plain / json / xml / html /
   js / python / shell / css / markdown / csv. Good-enough for ARG file
   reading; not a perfect parser. */

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ENT[c]);
}

const RULES_JSON = [
  { re: /"(?:\\.|[^"\\])*"(?=\s*:)/y, cls: 'hl-prop' },
  { re: /"(?:\\.|[^"\\])*"/y, cls: 'hl-string' },
  { re: /\b(?:true|false)\b/y, cls: 'hl-bool' },
  { re: /\bnull\b/y, cls: 'hl-null' },
  { re: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, cls: 'hl-number' },
  { re: /[{}\[\],:]/y, cls: 'hl-punct' },
];

const RULES_XML = [
  { re: /<!--[\s\S]*?-->/y, cls: 'hl-comment' },
  { re: /<!\[CDATA\[[\s\S]*?\]\]>/y, cls: 'hl-comment' },
  { re: /<\?[\s\S]*?\?>/y, cls: 'hl-comment' },
  { re: /<\/?[a-zA-Z][\w:-]*/y, cls: 'hl-tag' },
  { re: /\/?>/y, cls: 'hl-punct' },
  { re: /[a-zA-Z_:][\w:.-]*\s*=/y, cls: 'hl-attr' },
  { re: /"[^"]*"|'[^']*'/y, cls: 'hl-string' },
];

const JS_KEYWORDS = new Set([
  'var', 'let', 'const', 'function', 'class', 'extends', 'super', 'this',
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
  'return', 'import', 'export', 'from', 'as', 'default', 'new', 'delete',
  'typeof', 'instanceof', 'in', 'of', 'async', 'await', 'yield', 'try',
  'catch', 'finally', 'throw', 'void', 'null', 'undefined', 'true', 'false',
  'static', 'get', 'set',
]);

const RULES_JS = [
  { re: /\/\*[\s\S]*?\*\//y, cls: 'hl-comment' },
  { re: /\/\/[^\n]*/y, cls: 'hl-comment' },
  { re: /`(?:\\.|[^`\\])*`/y, cls: 'hl-string' },
  { re: /"(?:\\.|[^"\\])*"/y, cls: 'hl-string' },
  { re: /'(?:\\.|[^'\\])*'/y, cls: 'hl-string' },
  { re: /\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^\/\\\n])+\/[gimsuy]*/y, cls: 'hl-regex', guard: jsRegexGuard },
  { re: /\b0[xX][0-9a-fA-F]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y, cls: 'hl-number' },
  { re: /\b[A-Za-z_$][\w$]*\b/y, cls: 'hl-ident', map: jsIdentMap },
  { re: /[{}()\[\];,.]/y, cls: 'hl-punct' },
];

const JS_REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'in', 'of', 'instanceof', 'delete', 'void',
  'throw', 'yield', 'await', 'new', 'case', 'do', 'else',
]);

function jsRegexGuard(text, pos) {
  if (pos === 0) return true;
  let i = pos - 1;
  while (i >= 0 && /\s/.test(text[i])) i -= 1;
  if (i < 0) return true;
  const c = text[i];
  if (/[\w$)\]]/.test(c)) {
    if (/[\w$]/.test(c)) {
      let j = i;
      while (j >= 0 && /[\w$]/.test(text[j])) j -= 1;
      const ident = text.slice(j + 1, i + 1);
      if (JS_REGEX_PRECEDING_KEYWORDS.has(ident)) return true;
    }
    return false;
  }
  return true;
}

function jsIdentMap(value) {
  if (JS_KEYWORDS.has(value)) return 'hl-keyword';
  if (value === 'true' || value === 'false') return 'hl-bool';
  if (value === 'null') return 'hl-null';
  return null;
}

const PY_KEYWORDS = new Set([
  'def', 'class', 'import', 'from', 'as', 'if', 'elif', 'else', 'for',
  'while', 'return', 'yield', 'with', 'try', 'except', 'finally', 'raise',
  'lambda', 'not', 'and', 'or', 'in', 'is', 'global', 'nonlocal', 'pass',
  'break', 'continue', 'async', 'await',
]);

const RULES_PY = [
  { re: /#[^\n]*/y, cls: 'hl-comment' },
  { re: /[rRbBfFuU]{0,2}"""[\s\S]*?"""/y, cls: 'hl-string' },
  { re: /[rRbBfFuU]{0,2}'''[\s\S]*?'''/y, cls: 'hl-string' },
  { re: /[rRbBfFuU]{0,2}"(?:\\.|[^"\\\n])*"/y, cls: 'hl-string' },
  { re: /[rRbBfFuU]{0,2}'(?:\\.|[^'\\\n])*'/y, cls: 'hl-string' },
  { re: /\b0[xXoObB]?[0-9a-fA-F_]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/y, cls: 'hl-number' },
  { re: /\b[A-Za-z_][\w]*\b/y, cls: 'hl-ident', map: pyIdentMap },
  { re: /[{}()\[\]:,.]/y, cls: 'hl-punct' },
];

function pyIdentMap(value) {
  if (PY_KEYWORDS.has(value)) return 'hl-keyword';
  if (value === 'True' || value === 'False') return 'hl-bool';
  if (value === 'None') return 'hl-null';
  return null;
}

const SH_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while',
  'until', 'case', 'esac', 'function', 'return', 'select', 'time',
]);

const RULES_SH = [
  { re: /#[^\n]*/y, cls: 'hl-comment' },
  { re: /"(?:\\.|[^"\\])*"/y, cls: 'hl-string' },
  { re: /'[^']*'/y, cls: 'hl-string' },
  { re: /\$\{[^}]*\}|\$[A-Za-z_][\w]*|\$\d+/y, cls: 'hl-variable' },
  { re: /\b\d+\b/y, cls: 'hl-number' },
  { re: /\b[A-Za-z_][\w]*\b/y, cls: 'hl-ident', map: shIdentMap },
  { re: /[{}()\[\];|&<>]/y, cls: 'hl-punct' },
];

function shIdentMap(value) {
  if (SH_KEYWORDS.has(value)) return 'hl-keyword';
  return null;
}

const RULES_CSS = [
  { re: /\/\*[\s\S]*?\*\//y, cls: 'hl-comment' },
  { re: /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/y, cls: 'hl-string' },
  { re: /#[0-9a-fA-F]{3,8}\b/y, cls: 'hl-number' },
  { re: /-?\d+(?:\.\d+)?(?:px|em|rem|vh|vw|%|s|ms|deg|fr)?/y, cls: 'hl-number' },
  { re: /@[a-zA-Z-]+/y, cls: 'hl-keyword' },
  { re: /[a-zA-Z-]+(?=\s*:)/y, cls: 'hl-prop' },
  { re: /[.#][a-zA-Z_][\w-]*|::?[a-zA-Z-]+/y, cls: 'hl-selector' },
  { re: /[{};,]/y, cls: 'hl-punct' },
];

const RULES_CSV = [
  { re: /[^,\n]+/y, cls: 'hl-csv-col' },
  { re: /,/y, cls: 'hl-punct' },
];

function applyRules(text, rules) {
  if (!text) return '';
  let out = '';
  let pos = 0;
  const len = text.length;
  while (pos < len) {
    let matched = null;
    let matchedRule = null;
    for (const rule of rules) {
      rule.re.lastIndex = pos;
      if (rule.guard && !rule.guard(text, pos)) continue;
      const m = rule.re.exec(text);
      if (m && m.index === pos) {
        matched = m[0];
        matchedRule = rule;
        break;
      }
    }
    if (matched) {
      let cls = matchedRule.cls;
      if (matchedRule.map) {
        const remapped = matchedRule.map(matched);
        if (remapped) cls = remapped;
        else { out += escapeHtml(matched); pos += matched.length; continue; }
      }
      out += `<span class="${cls}">${escapeHtml(matched)}</span>`;
      pos += matched.length;
    } else {
      out += escapeHtml(text[pos]);
      pos += 1;
    }
  }
  return out;
}

function highlightCsv(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const parts = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) { parts.push(''); continue; }
    const cells = line.split(',');
    const cellsHtml = cells.map((cell, idx) => {
      const cls = idx % 2 === 0 ? 'hl-csv-col0' : 'hl-csv-col1';
      return `<span class="${cls}">${escapeHtml(cell)}</span>`;
    }).join('<span class="hl-punct">,</span>');
    parts.push(cellsHtml);
  }
  return parts.join('\n');
}

function highlightMarkdown(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let inFence = false;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^```/.test(raw)) {
      inFence = !inFence;
      out.push(`<span class="hl-codeblock">${escapeHtml(raw)}</span>`);
      continue;
    }
    if (inFence) {
      out.push(`<span class="hl-codeblock">${escapeHtml(raw)}</span>`);
      continue;
    }
    if (/^#{1,6}\s+/.test(raw)) {
      out.push(`<span class="hl-heading">${escapeHtml(raw)}</span>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(raw) || /^\s*\d+\.\s+/.test(raw)) {
      out.push(transformInlineMd(raw));
      continue;
    }
    out.push(transformInlineMd(raw));
  }
  return out.join('\n');
}

function transformInlineMd(line) {
  let out = '';
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    if (ch === '`') {
      const close = line.indexOf('`', i + 1);
      if (close > i) {
        out += `<span class="hl-codeblock">${escapeHtml(line.slice(i, close + 1))}</span>`;
        i = close + 1; continue;
      }
    }
    if (ch === '*' && line[i + 1] === '*') {
      const close = line.indexOf('**', i + 2);
      if (close > i) {
        out += `<span class="hl-bold">${escapeHtml(line.slice(i, close + 2))}</span>`;
        i = close + 2; continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const close = line.indexOf(ch, i + 1);
      if (close > i && /\S/.test(line[i + 1] || '')) {
        out += `<span class="hl-italic">${escapeHtml(line.slice(i, close + 1))}</span>`;
        i = close + 1; continue;
      }
    }
    if (ch === '[') {
      const closeBracket = line.indexOf(']', i + 1);
      if (closeBracket > i && line[closeBracket + 1] === '(') {
        const closeParen = line.indexOf(')', closeBracket + 2);
        if (closeParen > closeBracket) {
          out += `<span class="hl-link">${escapeHtml(line.slice(i, closeParen + 1))}</span>`;
          i = closeParen + 1; continue;
        }
      }
    }
    out += escapeHtml(ch);
    i += 1;
  }
  return out;
}

export function highlight(text, language) {
  if (text == null) return '';
  const lang = String(language || 'plain').toLowerCase();
  switch (lang) {
    case 'json': return applyRules(text, RULES_JSON);
    case 'xml':
    case 'html': return applyRules(text, RULES_XML);
    case 'js':
    case 'javascript':
    case 'typescript':
    case 'ts': return applyRules(text, RULES_JS);
    case 'python':
    case 'py': return applyRules(text, RULES_PY);
    case 'shell':
    case 'bash':
    case 'sh': return applyRules(text, RULES_SH);
    case 'css': return applyRules(text, RULES_CSS);
    case 'markdown':
    case 'md': return highlightMarkdown(text);
    case 'csv': return highlightCsv(text);
    case 'plain':
    default: return escapeHtml(text);
  }
}

export function detectLanguage(mime, filename) {
  const m = String(mime || '').toLowerCase().trim();
  if (m === 'text/html') return 'html';
  if (m === 'application/json') return 'json';
  if (m === 'application/xml' || m === 'text/xml') return 'xml';
  if (m === 'text/markdown') return 'markdown';
  if (m === 'text/css') return 'css';
  if (m === 'text/csv') return 'csv';
  if (m === 'application/javascript' || m === 'text/javascript') return 'js';
  if (m === 'text/x-python' || m === 'application/x-python') return 'python';
  if (m === 'application/x-sh' || m === 'text/x-shellscript') return 'shell';
  const name = String(filename || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot < 0) return 'plain';
  const ext = name.slice(dot + 1);
  if (ext === 'py') return 'python';
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs' || ext === 'ts'
      || ext === 'jsx' || ext === 'tsx') return 'js';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'json') return 'json';
  if (ext === 'xml') return 'xml';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'css') return 'css';
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'shell';
  if (ext === 'csv') return 'csv';
  return 'plain';
}

export { escapeHtml };
