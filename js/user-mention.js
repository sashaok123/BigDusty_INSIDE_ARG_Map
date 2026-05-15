/* `@username` autocomplete for text/textarea inputs. Mirrors node-mention.js
   pattern but triggers on `@`. Picks insert `@username` at the caret and
   invoke onPick(username) once per insert. */

import { tr } from './i18n.js';

const MAX_RESULTS = 12;

let _sharedPopover = null;
let _activeOwner = null;

function ensurePopover() {
  if (_sharedPopover) return _sharedPopover;
  const el = document.createElement('div');
  el.className = 'mention-popover user-mention-popover';
  el.setAttribute('role', 'listbox');
  document.body.appendChild(el);
  _sharedPopover = el;
  return el;
}

function scoreCandidate(query, user) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const u = (user.username || '').toLowerCase();
  if (u === q) return 1000;
  if (u.startsWith(q)) return 200;
  if (u.includes(q)) return 80;
  return 0;
}

function rankUsers(query, users) {
  const out = [];
  for (const u of users) {
    if (!u || !u.username) continue;
    const s = scoreCandidate(query, u);
    if (s <= 0 && query) continue;
    out.push({ user: u, score: s });
  }
  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.user.username || '').localeCompare(b.user.username || '');
  });
  return out.slice(0, MAX_RESULTS).map((r) => r.user);
}

function findOpenMention(textarea) {
  const pos = textarea.selectionStart;
  if (typeof pos !== 'number') return null;
  const text = textarea.value || '';
  const before = text.slice(0, pos);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0) {
    const prev = before.charAt(at - 1);
    if (prev && !/\s|[(\[{,;:]/.test(prev)) return null;
  }
  const between = before.slice(at + 1);
  if (/\s/.test(between)) return null;
  if (between.length > 64) return null;
  return { open: at, query: between };
}

function measureCaretCoords(textarea) {
  const r = textarea.getBoundingClientRect();
  return { x: r.left + 8, y: r.bottom };
}

export function attachUserAutocomplete(textareaEl, getUsers, onPick) {
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
      empty.textContent = tr('user_mention_popover_empty');
      popover.appendChild(empty);
      return;
    }
    for (let i = 0; i < candidates.length; i++) {
      const u = candidates[i];
      const row = document.createElement('div');
      row.className = 'mention-row' + (i === activeIndex ? ' active' : '');
      row.dataset.idx = String(i);
      const dot = document.createElement('span');
      dot.className = 'mention-dot user-dot';
      const label = document.createElement('span');
      label.className = 'mention-label';
      label.textContent = u.username || '';
      row.appendChild(dot);
      row.appendChild(label);
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
    const popW = popover.offsetWidth || 200;
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
    const users = (typeof getUsers === 'function') ? (getUsers() || []) : [];
    candidates = rankUsers(openInfo.query, users);
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
    if (!picked || !picked.username) { close(); return; }
    const text = textareaEl.value || '';
    const caret = textareaEl.selectionStart;
    const before = text.slice(0, openInfo.open);
    const afterCaret = text.slice(caret);
    const insertion = `@${picked.username} `;
    const next = before + insertion + afterCaret;
    textareaEl.value = next;
    const newCaret = (before + insertion).length;
    textareaEl.setSelectionRange(newCaret, newCaret);
    textareaEl.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof onPick === 'function') {
      try {
        onPick({
          username: picked.username,
          id: picked.id || null,
          snippet: before.slice(Math.max(0, before.length - 80)) + insertion + afterCaret.slice(0, 80),
        });
      } catch (e) { void e; }
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
