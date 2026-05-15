/* Async loaders for the JSON Canvas file plus per-node assets (block images,
   per-puzzle markdown). Includes a legacy fallback that builds an in-memory
   canvas from the old three-file layout. */

const CANVAS_PATH = 'data/canvas.canvas';
const LEGACY_HOTSPOTS = 'data/hotspots.json';
const LEGACY_BLOCKS   = 'data/blocks_raw.json';
const LEGACY_ARROWS   = 'data/arrows.json';

const STATUS_MAP_LEGACY = {
  solved:  'solved',
  partial: 'partial',
  unsolved:'unsolved',
  nodata:  'no-data',
};

const KIND_TO_ROUTING = {
  orthogonal: 'orthogonal',
  manhattan:  'manhattan',
  bezier:     'smooth',
  straight:   'straight',
};

const SIDE_FIXED_POINT = {
  left:   [0, 0.5],
  right:  [1, 0.5],
  top:    [0.5, 0],
  bottom: [0.5, 1],
};

const mdCache = new Map();

export async function loadCanvas() {
  try {
    const res = await fetch(CANVAS_PATH, { cache: 'no-cache' });
    if (res.ok) {
      const text = await res.text();
      const obj = JSON.parse(text);
      if (validCanvas(obj)) {
        return finaliseCanvas(obj, { fellBack: false });
      }
      console.warn('[data-loader] canvas.canvas has unexpected shape, falling back');
    }
  } catch (e) {
    console.warn('[data-loader] canvas.canvas fetch failed:', e.message);
  }
  const legacy = await loadLegacy();
  return finaliseCanvas(legacyToCanvas(legacy), { fellBack: true });
}

function validCanvas(obj) {
  return !!obj && Array.isArray(obj.nodes) && Array.isArray(obj.edges);
}

function finaliseCanvas(obj, { fellBack }) {
  const nodes = new Map();
  const edges = new Map();
  for (const n of obj.nodes) {
    if (!n || typeof n.id !== 'string') continue;
    nodes.set(n.id, normaliseNode(n));
  }
  for (const e of obj.edges) {
    if (!e || typeof e.id !== 'string') continue;
    edges.set(e.id, normaliseEdge(e));
  }
  for (const n of nodes.values()) {
    if (n.type === 'text' && typeof n.text === 'string' && n.slug) {
      mdCache.set(n.slug, n.text);
    }
  }
  const branches = normaliseBranches(obj.branches);
  return { nodes, edges, branches, fellBack };
}

export function normaliseBranches(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object') continue;
    const id = typeof b.id === 'string' ? b.id.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = typeof b.label === 'string' ? b.label : id;
    const color = typeof b.color === 'string' ? b.color : '1';
    const description = typeof b.description === 'string' ? b.description : '';
    out.push({ id, label, color, description });
  }
  return out;
}

export function defaultBranchSeed() {
  return [
    ['stickers', '108-cell sticker puzzle', '1'],
    ['printer', 'Printer / 5-platform passcodes', '2'],
    ['terminal41', 'terminal41.link site', '3'],
    ['transmission', 'Transmission PNG / chip JPEG', '4'],
    ['breach', 'Breach SHA-256 hashes', '5'],
    ['viewgate', '22-char viewgate input', '6'],
    ['cummings', 'Cummings overlay / macOS', '1'],
    ['physical', 'Physical CE contents', '2'],
  ].map(([id, label, color]) => ({ id, label, color, description: '' }));
}

export function normaliseNode(raw) {
  const type = (raw.type === 'text' || raw.type === 'file' || raw.type === 'link' || raw.type === 'group')
    ? raw.type
    : 'text';
  const node = {
    id: raw.id,
    type,
    x: numberOr(raw.x, 0),
    y: numberOr(raw.y, 0),
    width:  numberOr(raw.width, 100),
    height: numberOr(raw.height, 100),
  };
  if (typeof raw.color === 'string') node.color = raw.color;
  if (type === 'text') {
    node.text = typeof raw.text === 'string' ? raw.text : '';
  } else if (type === 'file') {
    node.file = typeof raw.file === 'string' ? raw.file : '';
    if (typeof raw.subpath === 'string') node.subpath = raw.subpath;
  } else if (type === 'link') {
    node.url = typeof raw.url === 'string' ? raw.url : '';
  } else if (type === 'group') {
    if (typeof raw.label === 'string') node.label = raw.label;
    if (typeof raw.background === 'string') node.background = raw.background;
    if (typeof raw.backgroundStyle === 'string') node.backgroundStyle = raw.backgroundStyle;
  }
  if (typeof raw.status === 'string') node.status = raw.status;
  if (Array.isArray(raw.tags)) node.tags = raw.tags.filter((t) => typeof t === 'string');
  if (typeof raw.owner === 'string') node.owner = raw.owner;
  if (typeof raw.confidence === 'number') node.confidence = raw.confidence;
  if (typeof raw.priority === 'number') node.priority = raw.priority;
  if (typeof raw.lastTouched === 'string') node.lastTouched = raw.lastTouched;
  if (raw.caption && typeof raw.caption === 'object') node.caption = { ...raw.caption };
  if (typeof raw.parent === 'string') node.parent = raw.parent;
  if (typeof raw.kind === 'string') node.kind = raw.kind;
  if (typeof raw.slug === 'string') node.slug = raw.slug;
  if (raw.translations && typeof raw.translations === 'object') {
    node.translations = {};
    for (const [lang, payload] of Object.entries(raw.translations)) {
      if (!payload || typeof payload !== 'object') continue;
      const slot = {};
      if (typeof payload.label === 'string') slot.label = payload.label;
      if (typeof payload.body === 'string')  slot.body  = payload.body;
      if (payload.caption && typeof payload.caption === 'object') slot.caption = { ...payload.caption };
      if (typeof payload.summary === 'string') slot.summary = payload.summary;
      node.translations[lang] = slot;
    }
  }
  if (raw.text_style && typeof raw.text_style === 'object') {
    const ts = {};
    if (typeof raw.text_style.size === 'string') ts.size = raw.text_style.size;
    if (typeof raw.text_style.family === 'string') ts.family = raw.text_style.family;
    if (typeof raw.text_style.color === 'string') ts.color = raw.text_style.color;
    if (typeof raw.text_style.align === 'string') ts.align = raw.text_style.align;
    if (typeof raw.text_style.wrap === 'string') ts.wrap = raw.text_style.wrap;
    node.text_style = ts;
  }
  if (raw.media && typeof raw.media === 'object') {
    const m = {};
    if (typeof raw.media.kind === 'string') m.kind = raw.media.kind;
    if (typeof raw.media.url === 'string') m.url = raw.media.url;
    if (typeof raw.media.videoId === 'string') m.videoId = raw.media.videoId;
    if (typeof raw.media.embedUrl === 'string') m.embedUrl = raw.media.embedUrl;
    if (typeof raw.media.provider === 'string') m.provider = raw.media.provider;
    if (Number.isFinite(raw.media.volume_default)) m.volume_default = Math.max(0, Math.min(1, raw.media.volume_default));
    node.media = m;
  }
  if (typeof raw.mime === 'string') node.mime = raw.mime;
  if (raw.kind === 'video' || raw.kind === 'audio' || raw.kind === 'document') node.kind = raw.kind;
  if (typeof raw.name === 'string') node.name = raw.name;
  if (Array.isArray(raw.branches)) node.branches = raw.branches.filter((b) => typeof b === 'string');
  if (raw.locked === true) node.locked = true;
  if (typeof raw.verification === 'string' && raw.verification) node.verification = raw.verification;
  if (typeof raw.source_url === 'string' && raw.source_url) node.source_url = raw.source_url;
  if (typeof raw.tool === 'string' && raw.tool) node.tool = raw.tool;
  if (typeof raw.technique === 'string' && raw.technique) node.technique = raw.technique;
  if (typeof raw.github_path === 'string' && raw.github_path) node.github_path = raw.github_path;
  if (raw.bookmarked === true) node.bookmarked = true;
  return node;
}

export function normaliseEdge(raw) {
  const edge = {
    id: raw.id,
    fromNode: typeof raw.fromNode === 'string' ? raw.fromNode : '',
    toNode:   typeof raw.toNode === 'string' ? raw.toNode : '',
  };
  if (typeof raw.fromSide === 'string') edge.fromSide = raw.fromSide;
  if (typeof raw.toSide   === 'string') edge.toSide   = raw.toSide;
  if (typeof raw.fromEnd  === 'string') edge.fromEnd  = raw.fromEnd;
  if (typeof raw.toEnd    === 'string') edge.toEnd    = raw.toEnd;
  if (typeof raw.color    === 'string') edge.color    = raw.color;
  edge.label = normaliseEdgeLabel(raw.label);
  const routing = typeof raw.routing === 'string' ? raw.routing : 'orthogonal';
  edge.routing = ['straight', 'orthogonal', 'manhattan', 'smooth'].includes(routing) ? routing : 'orthogonal';
  const style = typeof raw.style === 'string' ? raw.style : 'solid';
  edge.style = ['solid', 'dashed', 'dotted'].includes(style) ? style : 'solid';
  if (Array.isArray(raw.waypoints)) {
    edge.waypoints = raw.waypoints
      .filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number')
      .map((p) => ({ x: p.x, y: p.y }));
  }
  if (Array.isArray(raw.branches)) edge.branches = raw.branches.map((b) => {
    const out = { ...b };
    out.label = normaliseEdgeLabel(b && b.label);
    return out;
  });
  if (raw.junction && typeof raw.junction === 'object') edge.junction = { x: raw.junction.x, y: raw.junction.y };
  if (raw.fromPoint && typeof raw.fromPoint === 'object'
      && typeof raw.fromPoint.x === 'number' && typeof raw.fromPoint.y === 'number') {
    edge.fromPoint = { x: raw.fromPoint.x, y: raw.fromPoint.y };
  }
  if (raw.toPoint && typeof raw.toPoint === 'object'
      && typeof raw.toPoint.x === 'number' && typeof raw.toPoint.y === 'number') {
    edge.toPoint = { x: raw.toPoint.x, y: raw.toPoint.y };
  }
  edge.stroke = normaliseEdgeStroke(raw.stroke);
  edge.bindings = normaliseBindings(raw.bindings);
  return edge;
}

export function normaliseEdgeStroke(raw) {
  const def = { width: 2, color: 'auto' };
  if (!raw || typeof raw !== 'object') return def;
  const w = Number(raw.width);
  const width = Number.isFinite(w) ? Math.max(1, Math.min(12, w)) : def.width;
  const color = typeof raw.color === 'string' && raw.color ? raw.color : def.color;
  return { width, color };
}

export function normaliseEdgeLabel(raw) {
  if (raw == null) return { text: '', position: null, fontSize: 14, color: 'auto', rotation: 0 };
  if (typeof raw === 'string') return { text: raw, position: null, fontSize: 14, color: 'auto', rotation: 0 };
  if (typeof raw === 'object') {
    const text = typeof raw.text === 'string' ? raw.text : '';
    let position = null;
    if (raw.position && typeof raw.position === 'object'
        && Number.isFinite(raw.position.x) && Number.isFinite(raw.position.y)) {
      position = { x: raw.position.x, y: raw.position.y };
    }
    const fontSize = Number.isFinite(raw.fontSize) ? Math.max(8, Math.min(64, raw.fontSize)) : 14;
    const color = typeof raw.color === 'string' && raw.color ? raw.color : 'auto';
    const rotation = Number.isFinite(raw.rotation) ? Math.max(-180, Math.min(180, raw.rotation)) : 0;
    return { text, position, fontSize, color, rotation };
  }
  return { text: '', position: null, fontSize: 14, color: 'auto', rotation: 0 };
}

function normaliseBindings(b) {
  const def = { from: { fixedPoint: [0.5, 0.5], mode: 'orbit' }, to: { fixedPoint: [0.5, 0.5], mode: 'orbit' } };
  if (!b || typeof b !== 'object') return def;
  return {
    from: normaliseEndpointBinding(b.from, def.from),
    to:   normaliseEndpointBinding(b.to,   def.to),
  };
}

function normaliseEndpointBinding(b, fallback) {
  if (!b || typeof b !== 'object') return { ...fallback };
  const mode = b.mode === 'inside' ? 'inside' : 'orbit';
  let fp = Array.isArray(b.fixedPoint) ? b.fixedPoint : null;
  if (!fp || fp.length !== 2 || typeof fp[0] !== 'number' || typeof fp[1] !== 'number') {
    fp = [...fallback.fixedPoint];
  }
  return { mode, fixedPoint: [fp[0], fp[1]] };
}

function numberOr(v, d) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

async function loadLegacy() {
  const [blocksRes, hotspotsRes, arrowsRes] = await Promise.all([
    safeFetchJson(LEGACY_BLOCKS),
    safeFetchJson(LEGACY_HOTSPOTS),
    safeFetchJson(LEGACY_ARROWS),
  ]);
  return {
    blocks: blocksRes && Array.isArray(blocksRes.blocks) ? blocksRes.blocks : [],
    hotspots: hotspotsRes && Array.isArray(hotspotsRes.hotspots) ? hotspotsRes.hotspots : [],
    arrows: arrowsRes && Array.isArray(arrowsRes.arrows) ? arrowsRes.arrows : [],
  };
}

async function safeFetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    void e;
    return null;
  }
}

export function legacyToCanvas(legacy) {
  const fileIds = new Set();
  const nodes = [];
  for (const b of legacy.blocks) {
    const id = b.id;
    fileIds.add(id);
    nodes.push({
      id,
      type: 'file',
      x: int(b.rect && b.rect.x),
      y: int(b.rect && b.rect.y),
      width:  int(b.rect && b.rect.w),
      height: int(b.rect && b.rect.h),
      file: b.file || `data/blocks/${id}.webp`,
      status: 'no-data',
      tags: [],
      kind: 'block',
    });
  }
  for (const h of legacy.hotspots) {
    const slug = h.slug || h.id || 'untitled';
    const rect = h.rect || {};
    const legacyStatus = typeof h.status === 'string' ? h.status : 'unsolved';
    const status = STATUS_MAP_LEGACY[legacyStatus] || 'unsolved';
    const node = {
      id: h.id || slug,
      type: 'text',
      x: int(rect.x), y: int(rect.y),
      width: int(rect.w || 300), height: int(rect.h || 180),
      text: '',
      status,
      tags: Array.isArray(h.tags) ? [...h.tags] : [],
      kind: 'puzzle',
      slug,
    };
    if (typeof h.block_id === 'string' && fileIds.has(h.block_id)) node.parent = h.block_id;
    nodes.push(node);
  }
  const edges = [];
  for (const a of legacy.arrows) {
    const src = a.from || {};
    const dst = a.to || {};
    if (!src.block_id || !dst.block_id) continue;
    const kind = typeof a.kind === 'string' ? a.kind : 'orthogonal';
    const routing = KIND_TO_ROUTING[kind] || 'orthogonal';
    const style = ['solid', 'dashed', 'dotted'].includes(a.style) ? a.style : 'solid';
    const edge = {
      id: a.id,
      fromNode: src.block_id,
      toNode: dst.block_id,
      routing,
      style,
      bindings: {
        from: { mode: 'orbit', fixedPoint: SIDE_FIXED_POINT[src.side] || [0.5, 0.5] },
        to:   { mode: 'orbit', fixedPoint: SIDE_FIXED_POINT[dst.side] || [0.5, 0.5] },
      },
    };
    if (['left', 'right', 'top', 'bottom'].includes(src.side)) edge.fromSide = src.side;
    if (['left', 'right', 'top', 'bottom'].includes(dst.side)) edge.toSide   = dst.side;
    edge.label = normaliseEdgeLabel(a.label);
    edges.push(edge);
  }
  return { nodes, edges };
}

function int(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function loadBlockImage(node) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${node.file}`));
    img.src = node.file;
  });
}

export async function loadFileNodeText(node) {
  if (!node || typeof node.file !== 'string') return '';
  try {
    const res = await fetch(node.file, { cache: 'no-cache' });
    if (!res.ok) return '';
    return await res.text();
  } catch (e) {
    void e;
    return '';
  }
}

export async function loadPuzzleMarkdown(slug) {
  if (mdCache.has(slug)) return mdCache.get(slug);
  const url = `data/puzzles/${slug}.md`;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) {
      const empty = `# ${slug}\n\nNo content yet. Use **Edit raw MD** to add notes.\n`;
      mdCache.set(slug, empty);
      return empty;
    }
    const text = await res.text();
    mdCache.set(slug, text);
    return text;
  } catch (e) {
    const fallback = `# ${slug}\n\nFailed to load: ${e.message}\n`;
    mdCache.set(slug, fallback);
    return fallback;
  }
}

export function setCachedMarkdown(slug, text) {
  mdCache.set(slug, text);
}

export function getCachedMarkdown(slug) {
  return mdCache.get(slug);
}

export function snapshotMarkdownCache() {
  const out = {};
  for (const [k, v] of mdCache) out[k] = v;
  return out;
}

export function restoreMarkdownCache(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') mdCache.set(k, v);
  }
}

export function serializeCanvas(nodes, edges, branches) {
  const out = {
    nodes: Array.from(nodes.values()).map((n) => ({ ...n })),
    edges: Array.from(edges.values()).map((e) => ({ ...e })),
  };
  if (Array.isArray(branches) && branches.length) {
    out.branches = branches.map((b) => ({ ...b }));
  }
  return out;
}
