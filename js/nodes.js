/* Helpers for working with the canvas node + edge maps. Pure state, no DOM.
   The viewer / arrow layer / side panel / editor consume a `view` shape
   derived from a node: { id, title, slug, status, tags, rect, parent, kind }.
   Conversions live here so the rest of the app keeps its existing pipelines. */

import { tr } from './i18n.js';

export const STATUSES = ['solved', 'partial', 'unsolved', 'no-data', 'dead-end'];

export const VERIFICATIONS = ['verified', 'hypothesis', 'disputed', 'falsified'];

export const TECHNIQUES = [
  'base64', 'caesar', 'rot13', 'rot47', 'vigenere', 'atbash', 'xor',
  'lsb-stego', 'morse', 'frequency-analysis', 'mojibake-reversal',
  'hash-lookup', 'wayback-archive', 'discord-screenshot', 'github-commit',
  'manual-transcription', 'audio-spectrogram', 'image-pixel-grid', 'other',
];

export const TRANSFORM_KIND = 'transform';

export const ANNOTATION_KINDS = ['rect', 'circle', 'arrow', 'label'];

export const VERIFICATION_STRIPE = {
  'verified':   '#3de88a',
  'hypothesis': '#e8c83d',
  'disputed':   '#e88a3d',
  'falsified':  '#e83d3d',
};

export function normaliseVerification(v) {
  if (typeof v !== 'string') return '';
  return VERIFICATIONS.includes(v) ? v : '';
}

export function normaliseTechnique(t) {
  if (typeof t !== 'string') return '';
  return TECHNIQUES.includes(t) ? t : '';
}

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

export function isTransformNode(n) {
  return n && n.kind === TRANSFORM_KIND;
}

const VIDEO_MEDIA_KINDS_NODE = new Set(['youtube', 'vimeo', 'twitch', 'loom', 'streamable', 'dailymotion', 'video', 'file']);

export function isVideoNode(n) {
  if (!n) return false;
  if (n.kind === 'video') return true;
  if (typeof n.mime === 'string' && /^video\//i.test(n.mime)) return true;
  if (n.media && typeof n.media.kind === 'string' && VIDEO_MEDIA_KINDS_NODE.has(n.media.kind)) return true;
  return false;
}

export function isAudioNode(n) {
  if (!n) return false;
  if (n.kind === 'audio') return true;
  if (typeof n.mime === 'string' && /^audio\//i.test(n.mime)) return true;
  return !!(n.media && n.media.kind === 'audio');
}

const DOC_MIMES = new Set([
  'text/html', 'text/plain', 'text/markdown', 'text/csv',
  'application/json', 'application/xml', 'text/xml', 'application/pdf',
  'text/css', 'application/javascript', 'text/javascript',
  'text/x-python', 'application/x-python',
  'application/x-sh', 'text/x-shellscript',
]);

export function isDocumentNode(n) {
  if (!n) return false;
  if (n.kind === 'document') return true;
  return typeof n.mime === 'string' && DOC_MIMES.has(n.mime.toLowerCase());
}

export function isEditableNode(n) {
  return n && (isPuzzleNode(n) || isStickyNode(n) || isGroupNode(n) || isTextNode(n) || isVideoNode(n) || isAudioNode(n) || isDocumentNode(n) || isTransformNode(n));
}

export function nodeRect(n) {
  return { x: n.x, y: n.y, w: n.width, h: n.height };
}

export function nodeTitle(n) {
  if (n.type === 'group') return (n.label || n.slug || n.id || '').trim();
  if (isTransformNode(n)) {
    if (typeof n.label === 'string' && n.label.trim()) return n.label.trim();
    return n.slug || n.id;
  }
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
    locked: !!n.locked,
    caption: n.caption ? { ...n.caption } : null,
    label: typeof n.label === 'string' ? n.label : '',
    translations: n.translations && typeof n.translations === 'object' ? { ...n.translations } : null,
    text: typeof n.text === 'string' ? n.text : '',
    text_style: n.text_style && typeof n.text_style === 'object' ? { ...n.text_style } : null,
    media: n.media && typeof n.media === 'object' ? { ...n.media } : null,
    mime: n.mime || null,
    name: typeof n.name === 'string' ? n.name : '',
    branches: Array.isArray(n.branches) ? [...n.branches] : [],
    verification: typeof n.verification === 'string' ? normaliseVerification(n.verification) : '',
    source_url: typeof n.source_url === 'string' ? n.source_url : '',
    tool: typeof n.tool === 'string' ? n.tool : '',
    technique: typeof n.technique === 'string' ? normaliseTechnique(n.technique) : '',
    github_path: typeof n.github_path === 'string' ? n.github_path : '',
    bookmarked: !!n.bookmarked,
    input: typeof n.input === 'string' ? n.input : '',
    output: typeof n.output === 'string' ? n.output : '',
    method: typeof n.method === 'string' ? n.method : '',
    annotations: Array.isArray(n.annotations) ? n.annotations.map((a) => ({ ...a })) : null,
  };
}

export function puzzleViews(nodes) {
  const out = [];
  for (const n of nodes.values()) {
    if (isPuzzleNode(n) || isStickyNode(n) || isTextNode(n) || isTransformNode(n)) out.push(toViewShape(n));
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
    if (isBlockNode(n)) {
      out.push({
        id: n.id,
        rect: nodeRect(n),
        file: n.file,
        annotations: Array.isArray(n.annotations) ? n.annotations.map((a) => ({ ...a })) : null,
      });
    }
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

export function addTransformNode(nodes, payload) {
  const id = payload.id;
  if (!id || nodes.has(id)) return null;
  const node = {
    id,
    type: 'text',
    x: payload.rect.x,
    y: payload.rect.y,
    width: payload.rect.w,
    height: payload.rect.h,
    text: '',
    status: normaliseStatus(payload.status || 'unsolved'),
    tags: Array.isArray(payload.tags) ? [...payload.tags] : [],
    kind: TRANSFORM_KIND,
    slug: payload.slug || id,
    input: typeof payload.input === 'string' ? payload.input : '',
    output: typeof payload.output === 'string' ? payload.output : '',
    method: typeof payload.method === 'string' ? payload.method : '',
  };
  if (typeof payload.label === 'string') node.label = payload.label;
  if (payload.parent) node.parent = payload.parent;
  if (payload.color) node.color = payload.color;
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
    else if (isTransformNode(n)) n.label = patch.title;
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
  if (patch.label !== undefined && isTransformNode(n)) {
    if (typeof patch.label === 'string') n.label = patch.label;
    else delete n.label;
  }
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
  if (patch.verification !== undefined) {
    const v = normaliseVerification(patch.verification);
    if (v) n.verification = v;
    else delete n.verification;
  }
  if (patch.source_url !== undefined) {
    if (typeof patch.source_url === 'string' && patch.source_url) n.source_url = patch.source_url;
    else delete n.source_url;
  }
  if (patch.tool !== undefined) {
    if (typeof patch.tool === 'string' && patch.tool) n.tool = patch.tool;
    else delete n.tool;
  }
  if (patch.technique !== undefined) {
    const t = normaliseTechnique(patch.technique);
    if (t) n.technique = t;
    else delete n.technique;
  }
  if (patch.github_path !== undefined) {
    if (typeof patch.github_path === 'string' && patch.github_path) n.github_path = patch.github_path;
    else delete n.github_path;
  }
  if (patch.bookmarked !== undefined) {
    if (patch.bookmarked) n.bookmarked = true;
    else delete n.bookmarked;
  }
  if (patch.input !== undefined) {
    if (typeof patch.input === 'string') n.input = patch.input;
    else delete n.input;
  }
  if (patch.output !== undefined) {
    if (typeof patch.output === 'string') n.output = patch.output;
    else delete n.output;
  }
  if (patch.method !== undefined) {
    if (typeof patch.method === 'string') n.method = patch.method;
    else delete n.method;
  }
  if (patch.annotations !== undefined) {
    if (Array.isArray(patch.annotations) && patch.annotations.length) {
      n.annotations = patch.annotations.map((a) => ({ ...a }));
    } else {
      delete n.annotations;
    }
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
