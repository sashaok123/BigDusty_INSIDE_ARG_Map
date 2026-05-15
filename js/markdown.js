/* Tiny vanilla Markdown parser. Supports headings, lists, links, bare URLs,
   images, inline + fenced code, blockquotes, hr, tables, bold/italic. No
   raw HTML passthrough. */

const ESC = (s) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const BARE_URL = /(^|[\s(])((?:https?:\/\/|www\.)[^\s<>"`\]]+[^\s<>"`\].,;:!?)\]])/g;

let _mentionLookup = null;
export function setMentionLookup(fn) {
  _mentionLookup = typeof fn === 'function' ? fn : null;
}

let _userMentionLookup = null;
export function setUserMentionLookup(fn) {
  _userMentionLookup = typeof fn === 'function' ? fn : null;
}

function inline(text) {
  const placeholders = [];
  const stash = (html) => {
    placeholders.push(html);
    return `\x00${placeholders.length - 1}\x00`;
  };

  let s = text;

  s = s.replace(/!\[([^\]]*?)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => {
    const t = title ? ` title="${ESC(title)}"` : '';
    return stash(`<img src="${ESC(src)}" alt="${ESC(alt)}"${t}>`);
  });

  s = s.replace(/\[\[([a-zA-Z0-9_\-:.]+)\]\]/g, (_, mentionId) => {
    const label = _mentionLookup ? _mentionLookup(mentionId) : null;
    if (label) {
      return stash(`<a class="md-mention" data-mention-id="${ESC(mentionId)}" href="#${ESC(mentionId)}">${ESC(label)}</a>`);
    }
    return stash(`<span class="md-mention-missing" data-mention-id="${ESC(mentionId)}" title="${ESC(mentionId)}">[[${ESC(mentionId)}]]</span>`);
  });

  s = s.replace(/(^|[\s(])@([A-Za-z0-9_\-]{1,64})/g, (match, pre, uname) => {
    const tip = _userMentionLookup ? _userMentionLookup(uname) : null;
    const titleAttr = tip ? ` title="${ESC(tip)}"` : '';
    return pre + stash(`<span class="md-mention-user" data-mention-user="${ESC(uname)}"${titleAttr}>@${ESC(uname)}</span>`);
  });

  s = s.replace(/\[([^\]]+?)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, href, title) => {
    const t = title ? ` title="${ESC(title)}"` : '';
    return stash(`<a href="${ESC(href)}" target="_blank" rel="noopener"${t}>${inlineNoLinks(label)}</a>`);
  });

  s = s.replace(/`([^`\n]+?)`/g, (_, code) => stash(`<code>${ESC(code)}</code>`));

  s = ESC(s);
  s = s.replace(BARE_URL, (m, pre, url) => {
    let trimmed = url;
    let trail = '';
    while (trimmed.length && /[.,;:!?)\]]/.test(trimmed.slice(-1))) {
      trail = trimmed.slice(-1) + trail;
      trimmed = trimmed.slice(0, -1);
    }
    const href = trimmed.startsWith('www.') ? `http://${trimmed}` : trimmed;
    return `${pre}<a href="${href}" target="_blank" rel="noopener">${trimmed}</a>${trail}`;
  });

  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');

  s = s.replace(/\x00(\d+)\x00/g, (_, i) => placeholders[parseInt(i, 10)]);
  return s;
}

function inlineNoLinks(text) {
  let s = ESC(text);
  s = s.replace(/`([^`\n]+?)`/g, (_, code) => `<code>${code}</code>`);
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
  return s;
}

function renderTable(rows) {
  if (rows.length < 2) return '';
  const head = rows[0].split('|').slice(1, -1).map((c) => c.trim());
  const sep = rows[1];
  if (!/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(sep)) return '';
  const aligns = sep.split('|').slice(1, -1).map((c) => {
    const t = c.trim();
    const l = t.startsWith(':');
    const r = t.endsWith(':');
    if (l && r) return 'center';
    if (r) return 'right';
    if (l) return 'left';
    return null;
  });
  const body = rows.slice(2).map((row) => row.split('|').slice(1, -1).map((c) => c.trim()));
  let html = '<table><thead><tr>';
  head.forEach((h, i) => {
    const a = aligns[i] ? ` style="text-align:${aligns[i]}"` : '';
    html += `<th${a}>${inline(h)}</th>`;
  });
  html += '</tr></thead><tbody>';
  for (const row of body) {
    html += '<tr>';
    row.forEach((c, i) => {
      const a = aligns[i] ? ` style="text-align:${aligns[i]}"` : '';
      html += `<td${a}>${inline(c)}</td>`;
    });
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function closeLists(stack, out) {
  while (stack.length) {
    const tag = stack.pop();
    out.push(`</${tag}>`);
    if (stack.length > 0) out.push('</li>');
  }
}

function listMarker(line) {
  const ul = line.match(/^(\s*)([-*+])\s+(.*)$/);
  if (ul) return { indent: ul[1].length, type: 'ul', text: ul[3] };
  const ol = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (ol) return { indent: ol[1].length, type: 'ol', text: ol[3] };
  return null;
}

export function renderMarkdown(src) {
  if (!src) return '';
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const listStack = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      closeLists(listStack, out);
      i++;
      const buf = [];
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push(`<pre class="copy-pre"><code>${ESC(buf.join('\n'))}</code><button class="copy-btn" type="button">Copy</button></pre>`);
      continue;
    }

    if (/^\s*$/.test(line)) {
      closeLists(listStack, out);
      i++;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      closeLists(listStack, out);
      const lvl = h[1].length;
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeLists(listStack, out);
      out.push('<hr>');
      i++;
      continue;
    }

    const bq = line.match(/^\s*>\s?(.*)$/);
    if (bq) {
      closeLists(listStack, out);
      const buf = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*>\s?(.*)$/);
        if (!m) break;
        buf.push(m[1]);
        i++;
      }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      closeLists(listStack, out);
      const buf = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        buf.push(lines[i]);
        i++;
      }
      out.push(renderTable(buf));
      continue;
    }

    const lm = listMarker(line);
    if (lm) {
      const wanted = lm.indent > 0 ? 2 : 1;
      while (listStack.length > wanted) {
        out.push(`</${listStack.pop()}>`);
        out.push('</li>');
      }
      if (listStack.length < wanted) {
        while (listStack.length < wanted) {
          if (listStack.length > 0) {
            const last = out[out.length - 1];
            if (last && last.endsWith('</li>')) {
              out[out.length - 1] = last.slice(0, -5);
            }
          }
          out.push(`<${lm.type}>`);
          listStack.push(lm.type);
        }
      } else if (listStack.length === wanted && listStack[wanted - 1] !== lm.type) {
        out.push(`</${listStack.pop()}>`);
        out.push(`<${lm.type}>`);
        listStack.push(lm.type);
      }
      out.push(`<li>${inline(lm.text)}</li>`);
      i++;
      continue;
    }

    closeLists(listStack, out);
    const para = [line];
    i++;
    while (i < lines.length
      && lines[i].trim() !== ''
      && !/^```/.test(lines[i])
      && !/^#{1,6}\s+/.test(lines[i])
      && !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i])
      && !listMarker(lines[i])
      && !(lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1]))) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(para.join('\n'))}</p>`);
  }

  closeLists(listStack, out);
  return out.join('\n');
}

export function attachCodeCopyButtons(root) {
  root.querySelectorAll('pre.copy-pre button.copy-btn').forEach((btn) => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const code = btn.parentElement.querySelector('code');
      const txt = code ? code.textContent : '';
      if (navigator.clipboard) {
        navigator.clipboard.writeText(txt).then(() => {
          btn.textContent = 'Copied';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = 'Copy';
            btn.classList.remove('copied');
          }, 1500);
        });
      }
    });
  });
}
