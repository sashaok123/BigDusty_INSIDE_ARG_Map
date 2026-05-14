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

export function isStickyNode(n) {
  return n && n.kind === 'sticky';
}

export function isGroupNode(n) {
  return n && (n.type === 'group' || n.kind === 'group');
}

export function isTextNode(n) {
  return n && n.kind === 'text';
}

export function isVideoNode(n) {
  if (!n) return false;
  if (n.kind === 'video') return true;
  if (typeof n.mime === 'string' && /^video\//i.test(n.mime)) return true;
  if (n.media && (n.media.kind === 'youtube' || n.media.kind === 'vimeo' || n.media.kind === 'video')) return true;
  return false;
}

export function isAudioNode(n) {
  if (!n) return false;
  if (n.kind === 'audio') return true;
  if (typeof n.mime === 'string' && /^audio\//i.test(n.mime)) return true;
  return !!(n.media && n.media.kind === 'audio');
}

const DOC_MIMES = new Set(['text/html', 'text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/xml', 'text/xml', 'application/pdf']);

export function isDocumentNode(n) {
  if (!n) return false;
  if (n.kind === 'document') return true;
  return typeof n.mime === 'string' && DOC_MIMES.has(n.mime.toLowerCase());
}

export function isEditableNode(n) {
  return n && (isPuzzleNode(n) || isStickyNode(n) || isGroupNode(n) || isTextNode(n) || isVideoNode(n) || isAudioNode(n) || isDocumentNode(n));
}

export function nodeRect(n) {
  return { x: n.x, y: n.y, w: n.width, h: n.height };
}

export function nodeTitle(n) {
  if (n.type === 'group') return (n.label || n.slug || n.id || '').trim();
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
    kind: n.kind || (n.type === 'file' ? 'block' : (n.type === 'group' ? 'group' : 'puzzle')),
    type: n.type,
    file: n.file || null,
    color: n.color || '',
    caption: n.caption ? { ...n.caption } : null,
    label: typeof n.label === 'string' ? n.label : '',
    translations: n.translations && typeof n.translations === 'object' ? { ...n.translations } : null,
    text: typeof n.text === 'string' ? n.text : '',
    text_style: n.text_style && typeof n.text_style === 'object' ? { ...n.text_style } : null,
    media: n.media && typeof n.media === 'object' ? { ...n.media } : null,
    mime: n.mime || null,
    name: typeof n.name === 'string' ? n.name : '',
    branches: Array.isArray(n.branches) ? [...n.branches] : [],
  };
}

export function puzzleViews(nodes) {
  const out = [];
  for (const n of nodes.values()) {
    if (isPuzzleNode(n) || isStickyNode(n) || isTextNode(n)) out.push(toViewShape(n));
  }
  return out;
}

export function groupViews(nodes) {
  const out = [];
  for (const n of nodes.values()) {
    if (isGroupNode(n)) out.push(toViewShape(n));
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
    kind: payload.kind === 'sticky' ? 'sticky' : 'puzzle',
    slug: payload.slug || id,
  };
  if (payload.parent) node.parent = payload.parent;
  if (payload.color) node.color = payload.color;
  if (payload.caption) node.caption = { ...payload.caption };
  nodes.set(id, node);
  return node;
}

export function addStickyNode(nodes, payload) {
  return addPuzzleNode(nodes, { ...payload, kind: 'sticky', color: payload.color || '3' });
}

export function addTextNode(nodes, payload) {
  const id = payload.id;
  if (!id || nodes.has(id)) return null;
  const node = {
    id,
    type: 'text',
    x: payload.rect.x,
    y: payload.rect.y,
    width: payload.rect.w,
    height: payload.rect.h,
    text: payload.md || payload.text || '',
    status: normaliseStatus(payload.status || 'no-data'),
    tags: Array.isArray(payload.tags) ? [...payload.tags] : [],
    kind: 'text',
    slug: payload.slug || id,
  };
  if (payload.parent) node.parent = payload.parent;
  if (payload.color) node.color = payload.color;
  if (payload.translations) node.translations = { ...payload.translations };
  nodes.set(id, node);
  return node;
}

export function addGroupNode(nodes, payload) {
  const id = payload.id;
  if (!id || nodes.has(id)) return null;
  const node = {
    id,
    type: 'group',
    x: payload.rect.x,
    y: payload.rect.y,
    width: payload.rect.w,
    height: payload.rect.h,
    kind: 'group',
    label: payload.label || '',
    status: normaliseStatus(payload.status || 'no-data'),
    tags: Array.isArray(payload.tags) ? [...payload.tags] : [],
  };
  if (payload.parent) node.parent = payload.parent;
  if (payload.color) node.color = payload.color;
  if (payload.background) node.background = payload.background;
  if (payload.backgroundStyle) node.backgroundStyle = payload.backgroundStyle;
  nodes.set(id, node);
  return node;
}

export function updatePuzzleNode(nodes, id, patch) {
  const n = nodes.get(id);
  if (!n) return false;
  if (patch.title !== undefined) {
    if (n.type === 'group') n.label = patch.title;
    else if (n.type === 'text') n.text = rewriteTitleInMarkdown(n.text || '', patch.title);
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
  if (patch.color !== undefined) {
    if (patch.color) n.color = patch.color;
    else delete n.color;
  }
  if (patch.caption !== undefined) {
    if (patch.caption) n.caption = { ...patch.caption };
    else delete n.caption;
  }
  if (patch.label !== undefined && n.type === 'group') n.label = patch.label;
  if (patch.background !== undefined && n.type === 'group') {
    if (patch.background) n.background = patch.background;
    else delete n.background;
  }
  if (patch.backgroundStyle !== undefined && n.type === 'group') {
    n.backgroundStyle = patch.backgroundStyle;
  }
  if (patch.translations !== undefined) {
    if (patch.translations && typeof patch.translations === 'object') {
      n.translations = { ...patch.translations };
    } else {
      delete n.translations;
    }
  }
  if (patch.text_style !== undefined) {
    if (patch.text_style && typeof patch.text_style === 'object') {
      n.text_style = { ...patch.text_style };
    } else {
      delete n.text_style;
    }
  }
  if (patch.media !== undefined) {
    if (patch.media && typeof patch.media === 'object') n.media = { ...patch.media };
    else delete n.media;
  }
  if (patch.branches !== undefined) {
    if (Array.isArray(patch.branches)) n.branches = [...patch.branches];
    else delete n.branches;
  }
  if (patch.name !== undefined) {
    if (typeof patch.name === 'string') n.name = patch.name;
    else delete n.name;
  }
  return true;
}

export function viewWithLang(view, lang) {
  if (!view || !lang || lang === 'en' || !view.translations) return view;
  const t = view.translations[lang];
  if (!t || typeof t !== 'object') return view;
  const out = { ...view };
  if (typeof t.label === 'string' && t.label) out.title = t.label;
  if (typeof t.body === 'string' && t.body) out.text = t.body;
  if (t.caption && typeof t.caption === 'object') {
    out.caption = { ...(view.caption || {}), ...t.caption };
  }
  return out;
}

export function groupDescendantIds(nodes, groupId) {
  const out = new Set();
  const direct = [];
  for (const n of nodes.values()) if (n.parent === groupId) direct.push(n.id);
  for (const cid of direct) {
    out.add(cid);
    const child = nodes.get(cid);
    if (child && isGroupNode(child)) {
      const sub = groupDescendantIds(nodes, cid);
      for (const sid of sub) out.add(sid);
    }
  }
  return out;
}

export function nextGroupLabel(nodes) {
  let n = 1;
  const seen = new Set();
  for (const node of nodes.values()) {
    if (isGroupNode(node) && typeof node.label === 'string') {
      const m = /^Group\s+(\d+)$/.exec(node.label);
      if (m) seen.add(parseInt(m[1], 10));
    }
  }
  while (seen.has(n)) n += 1;
  return n;
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
