/* Helpers for working with the canvas node + edge maps. Pure state, no DOM.
   The viewer / arrow layer / side panel / editor consume a `view` shape
   derived from a node: { id, title, slug, status, tags, rect, parent, kind }.
   Conversions live here so the rest of the app keeps its existing pipelines. */

import { tr } from './i18n.js';

export const STATUSES = ['solved', 'partial', 'unsolved', 'no-data', 'dead-end'];

const STATUS_LABEL_KEY = {
  'solved':   'status_solved',
  'partial':  'status_partial',
  'unsolved': 'status_unsolved',
  'no-data':  'status_nodata',
  'dead-end': 'status_dead_end',
};

const STATUS_CSS_VAR = {
  'solved':   'var(--solved)',
  'partial':  'var(--partial)',
  'unsolved': 'var(--unsolved)',
  'no-data':  'var(--nodata)',
  'dead-end': 'var(--dead-end, var(--text-dim))',
};

export function statusLabel(s) {
  return STATUS_LABEL_KEY[s] ? tr(STATUS_LABEL_KEY[s]) : s;
}

export function statusVarName(s) {
  return STATUS_CSS_VAR[s] || 'var(--text-dim)';
}

export function normaliseStatus(s) {
  if (s === 'nodata') return 'no-data';
  return STATUSES.includes(s) ? s : 'unsolved';
}

export function isPuzzleNode(n) {
  return n && n.kind === 'puzzle';
}

export function isBlockNode(n) {
  return n && n.kind === 'block' && n.type === 'file';
}

export function nodeRect(n) {
  return { x: n.x, y: n.y, w: n.width, h: n.height };
}

export function nodeTitle(n) {
  if (n.type === 'text' && typeof n.text === 'string') {
    const first = n.text.split('\n').find((line) => /^#{1,6}\s+/.test(line));
    if (first) return first.replace(/^#{1,6}\s+/, '').trim();
  }
  return n.slug || n.id;
}

export function nodeMarkdown(n) {
  if (n.type === 'text') return typeof n.text === 'string' ? n.text : '';
  return '';
}

export function toViewShape(n) {
  return {
    id: n.id,
    title: nodeTitle(n),
    slug: n.slug || n.id,
    status: normaliseStatus(n.status || 'unsolved'),
    tags: Array.isArray(n.tags) ? [...n.tags] : [],
    rect: nodeRect(n),
    parent: n.parent || null,
    kind: n.kind || (n.type === 'file' ? 'block' : 'puzzle'),
    type: n.type,
    file: n.file || null,
  };
}

export function puzzleViews(nodes) {
  const out = [];
  for (const n of nodes.values()) {
    if (isPuzzleNode(n)) out.push(toViewShape(n));
  }
  return out;
}

export function blockViews(nodes) {
  const out = [];
  for (const n of nodes.values()) {
    if (isBlockNode(n)) out.push({ id: n.id, rect: nodeRect(n), file: n.file });
  }
  return out;
}

export function findNode(nodes, id) {
  return nodes.get(id) || null;
}

export function addPuzzleNode(nodes, payload) {
  const id = payload.id;
  if (!id || nodes.has(id)) return null;
  const node = {
    id,
    type: 'text',
    x: payload.rect.x,
    y: payload.rect.y,
    width: payload.rect.w,
    height: payload.rect.h,
    text: payload.md || '',
    status: normaliseStatus(payload.status || 'unsolved'),
    tags: Array.isArray(payload.tags) ? [...payload.tags] : [],
    kind: 'puzzle',
    slug: payload.slug || id,
  };
  if (payload.parent) node.parent = payload.parent;
  nodes.set(id, node);
  return node;
}

export function updatePuzzleNode(nodes, id, patch) {
  const n = nodes.get(id);
  if (!n) return false;
  if (patch.title !== undefined && n.type === 'text') {
    n.text = rewriteTitleInMarkdown(n.text || '', patch.title);
  }
  if (patch.slug !== undefined) n.slug = patch.slug;
  if (patch.status !== undefined) n.status = normaliseStatus(patch.status);
  if (patch.tags !== undefined) n.tags = Array.isArray(patch.tags) ? [...patch.tags] : [];
  if (patch.rect !== undefined) {
    n.x = patch.rect.x;
    n.y = patch.rect.y;
    n.width = patch.rect.w;
    n.height = patch.rect.h;
  }
  if (patch.md !== undefined && n.type === 'text') n.text = patch.md;
  if (patch.parent !== undefined) {
    if (patch.parent) n.parent = patch.parent;
    else delete n.parent;
  }
  return true;
}

export function removeNode(nodes, id) {
  return nodes.delete(id);
}

export function matchesSearch(view, term) {
  if (!term) return true;
  const q = term.toLowerCase();
  if ((view.title || '').toLowerCase().includes(q)) return true;
  if ((view.slug || '').toLowerCase().includes(q)) return true;
  if (Array.isArray(view.tags) && view.tags.some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}

export function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function uniqueId(nodes, base) {
  let id = slugify(base);
  if (!id) id = `node-${Date.now().toString(36)}`;
  if (!nodes.has(id)) return id;
  let n = 2;
  while (nodes.has(`${id}-${n}`)) n += 1;
  return `${id}-${n}`;
}

function rewriteTitleInMarkdown(md, newTitle) {
  if (!md) return `# ${newTitle}\n`;
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m) {
      lines[i] = `${m[1]} ${newTitle}`;
      return lines.join('\n');
    }
  }
  return `# ${newTitle}\n\n${md}`;
}

export function nodeAtParentLookup(nodes, rect) {
  let best = null;
  let bestArea = Infinity;
  for (const n of nodes.values()) {
    if (!isBlockNode(n)) continue;
    if (rect.x < n.x || rect.y < n.y) continue;
    if (rect.x + rect.w > n.x + n.width)  continue;
    if (rect.y + rect.h > n.y + n.height) continue;
    const area = n.width * n.height;
    if (area < bestArea) {
      best = n;
      bestArea = area;
    }
  }
  return best ? best.id : null;
}
