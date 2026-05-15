/* `[[...]]` autocomplete for text/textarea inputs. Watches caret position
   for the most recent unmatched `[[` and shows a floating popover anchored
   under the caret. Up/Down moves the highlight; Enter inserts `[[id]]`;
   Esc dismisses. */

import { tr } from './i18n.js';

const MAX_RESULTS = 12;

let _sharedPopover = null;
let _activeOwner = null;

function ensurePopover() {
  if (_sharedPopover) return _sharedPopover;
  const el = document.createElement('div');
  el.className = 'mention-popover';
  el.setAttribute('role', 'listbox');
  document.body.appendChild(el);
  _sharedPopover = el;
  return el;
}

function scoreCandidate(query, node) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const id = (node.id || '').toLowerCase();
  const slug = (node.slug || '').toLowerCase();
  const label = (node.label || node.title || '').toLowerCase();
  if (id === q || slug === q) return 1000;
  if (id.startsWith(q) || slug.startsWith(q) || label.startsWith(q)) return 200;
  if (id.includes(q) || slug.includes(q) || label.includes(q)) return 80;
  return 0;
}

function rankNodes(query, nodes) {
  const out = [];
  for (const n of nodes) {
    if (!n || !n.id) continue;
    const s = scoreCandidate(query, n);
    if (s <= 0 && query) continue;
    out.push({ node: n, score: s });
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const la = (a.node.label || a.node.title || a.node.id).toLowerCase();
    const lb = (b.node.label || b.node.title || b.node.id).toLowerCase();
    return la.localeCompare(lb);
  });
  return out.slice(0, MAX_RESULTS).map((r) => r.node);
}

function findOpenMention(textarea) {
  const pos = textarea.selectionStart;
  if (typeof pos !== 'number') return null;
  const text = textarea.value || '';
  const before = text.slice(0, pos);
  const open = before.lastIndexOf('[[');
  if (open === -1) return null;
  const between = before.slice(open + 2);
  if (between.includes(']') || between.includes('\n')) return null;
  if (/[\[\(\)]/.test(between)) return null;
  return { open, query: between };
}

function measureCaretCoords(textarea) {
  const r = textarea.getBoundingClientRect();
  return { x: r.left + 8, y: r.bottom };
}

export function attachMentionAutocomplete(textareaEl, getNodes, onPick) {
  if (!textareaEl) return () => {};
  const popover = ensurePopover();
  let activeIndex = 0;
  let candidates = [];
  let openInfo = null;

  const close = () => {
    if (_activeOwner === textareaEl) _activeOwner = null;
    popover.classList.remove('open');
    popover.style.display = 'none';
    candidates = [];
    openInfo = null;
  };

  const render = () => {
    popover.innerHTML = '';
    if (!candidates.length) {
      const empty = document.createElement('div');
      empty.className = 'mention-empty';
      empty.textContent = tr('mention_popover_empty');
      popover.appendChild(empty);
      return;
    }
    for (let i = 0; i < candidates.length; i++) {
      const n = candidates[i];
      const row = document.createElement('div');
      row.className = 'mention-row' + (i === activeIndex ? ' active' : '');
      row.dataset.idx = String(i);
      const dot = document.createElement('span');
      dot.className = 'mention-dot';
      if (n.status) dot.dataset.status = n.status;
      const label = document.createElement('span');
      label.className = 'mention-label';
      const display = n.label || n.title || n.slug || n.id;
      label.textContent = display;
      const slug = document.createElement('span');
      slug.className = 'mention-slug';
      slug.textContent = n.id;
      row.appendChild(dot);
      row.appendChild(label);
      row.appendChild(slug);
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        insertAt(i);
      });
      popover.appendChild(row);
    }
  };

  const position = () => {
    const xy = measureCaretCoords(textareaEl);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const popW = popover.offsetWidth || 260;
    const maxX = Math.max(8, vw - 16 - popW);
    let x = Math.max(8, Math.min(maxX, xy.x));
    let y = xy.y + 4;
    popover.style.left = `${x}px`;
    popover.style.top = `${y}px`;
    if (y + popover.offsetHeight > vh - 8) {
      const altY = xy.y - 4 - popover.offsetHeight;
      if (altY > 8) popover.style.top = `${altY}px`;
    }
  };

  const refresh = () => {
    openInfo = findOpenMention(textareaEl);
    if (!openInfo) { close(); return; }
    const nodes = (typeof getNodes === 'function') ? (getNodes() || []) : [];
    candidates = rankNodes(openInfo.query, nodes);
    activeIndex = 0;
    _activeOwner = textareaEl;
    popover.classList.add('open');
    popover.style.display = 'block';
    render();
    position();
  };

  const insertAt = (idx) => {
    if (!openInfo) { close(); return; }
    if (idx < 0 || idx >= candidates.length) { close(); return; }
    const picked = candidates[idx];
    if (!picked || !picked.id) { close(); return; }
    const text = textareaEl.value || '';
    const caret = textareaEl.selectionStart;
    const before = text.slice(0, openInfo.open);
    const afterCaret = text.slice(caret);
    let trailing = '';
    if (!afterCaret.startsWith(']]')) trailing = ']]';
    const insertion = `[[${picked.id}${trailing}`;
    const next = before + insertion + afterCaret;
    textareaEl.value = next;
    const newCaret = (before + insertion).length + (trailing ? 0 : 2);
    textareaEl.setSelectionRange(newCaret, newCaret);
    textareaEl.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof onPick === 'function') {
      try { onPick(picked.id); } catch (e) { void e; }
    }
    close();
  };

  const onInput = () => { refresh(); };
  const onKeyDown = (ev) => {
    if (!openInfo) return;
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      activeIndex = Math.min(candidates.length - 1, activeIndex + 1);
      render();
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      render();
      return;
    }
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
      if (candidates.length) {
        ev.preventDefault();
        insertAt(activeIndex);
        return;
      }
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      close();
      return;
    }
    if (ev.key === 'Tab') {
      if (candidates.length) {
        ev.preventDefault();
        insertAt(activeIndex);
      }
    }
  };
  const onBlur = () => {
    setTimeout(() => {
      if (_activeOwner !== textareaEl) return;
      close();
    }, 120);
  };
  const onClickOutside = (ev) => {
    if (_activeOwner !== textareaEl) return;
    if (!openInfo) return;
    if (ev.target === textareaEl) return;
    if (popover.contains(ev.target)) return;
    close();
  };

  textareaEl.addEventListener('input', onInput);
  textareaEl.addEventListener('keydown', onKeyDown, true);
  textareaEl.addEventListener('blur', onBlur);
  document.addEventListener('mousedown', onClickOutside, true);

  return () => {
    textareaEl.removeEventListener('input', onInput);
    textareaEl.removeEventListener('keydown', onKeyDown, true);
    textareaEl.removeEventListener('blur', onBlur);
    document.removeEventListener('mousedown', onClickOutside, true);
    close();
  };
}
