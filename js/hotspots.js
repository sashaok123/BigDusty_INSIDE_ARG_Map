/* Hotspot CRUD operations and status filtering helpers. Pure state, no DOM. */

import { tr } from './i18n.js';

export const STATUSES = ['solved', 'partial', 'unsolved', 'nodata'];
export const ALL_STATUSES = new Set(STATUSES);

const STATUS_LABEL_KEY = {
  solved: 'status_solved',
  partial: 'status_partial',
  unsolved: 'status_unsolved',
  nodata: 'status_nodata',
};

export function statusLabel(s) {
  return STATUS_LABEL_KEY[s] ? tr(STATUS_LABEL_KEY[s]) : s;
}

export function statusVarName(s) {
  return STATUS_LABEL_KEY[s] ? `var(--${s})` : 'var(--text-dim)';
}

export function findHotspot(hotspots, id) {
  return hotspots.find((h) => h.id === id) || null;
}

export function findIndex(hotspots, id) {
  return hotspots.findIndex((h) => h.id === id);
}

export function addHotspot(hotspots, h) {
  hotspots.push(h);
}

export function updateHotspot(hotspots, id, patch) {
  const idx = findIndex(hotspots, id);
  if (idx < 0) return false;
  hotspots[idx] = { ...hotspots[idx], ...patch };
  return true;
}

export function removeHotspot(hotspots, id) {
  const idx = findIndex(hotspots, id);
  if (idx < 0) return false;
  hotspots.splice(idx, 1);
  return true;
}

export function matchesSearch(h, term) {
  if (!term) return true;
  const q = term.toLowerCase();
  if ((h.title || '').toLowerCase().includes(q)) return true;
  if ((h.slug || '').toLowerCase().includes(q)) return true;
  if (Array.isArray(h.tags) && h.tags.some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}

export function matchesFilter(h, filter) {
  if (filter === 'all') return true;
  return h.status === filter;
}

export function slugify(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function uniqueId(hotspots, base) {
  let id = slugify(base);
  if (!id) id = `hotspot-${Date.now().toString(36)}`;
  if (!findHotspot(hotspots, id)) return id;
  let n = 2;
  while (findHotspot(hotspots, `${id}-${n}`)) n += 1;
  return `${id}-${n}`;
}

export function normalizeHotspot(raw, imageW, imageH, blocksById) {
  const status = STATUSES.includes(raw.status) ? raw.status : 'unsolved';
  const blockId = (typeof raw.block_id === 'string' && raw.block_id) ? raw.block_id : null;
  let baseRect = raw.rect || {};
  const hasOwnRect = baseRect && typeof baseRect.x === 'number'
    && typeof baseRect.y === 'number'
    && typeof baseRect.w === 'number'
    && typeof baseRect.h === 'number';
  if (!hasOwnRect && blockId && blocksById && blocksById.has(blockId)) {
    baseRect = { ...blocksById.get(blockId).rect };
  }
  const W = imageW || 0;
  const H = imageH || 0;
  const x = W > 0 ? clamp(Number(baseRect.x) || 0, 0, W) : (Number(baseRect.x) || 0);
  const y = H > 0 ? clamp(Number(baseRect.y) || 0, 0, H) : (Number(baseRect.y) || 0);
  const wMax = W > 0 ? W - x : (Number(baseRect.w) || 80);
  const hMax = H > 0 ? H - y : (Number(baseRect.h) || 60);
  const w = clamp(Number(baseRect.w) || 80, 8, Math.max(8, wMax));
  const h = clamp(Number(baseRect.h) || 60, 8, Math.max(8, hMax));
  return {
    id: raw.id || raw.slug || `h-${Date.now().toString(36)}`,
    title: raw.title || 'Untitled',
    slug: raw.slug || raw.id || `h-${Date.now().toString(36)}`,
    status,
    tags: Array.isArray(raw.tags) ? [...raw.tags] : [],
    rect: { x, y, w, h },
    block_id: blockId,
  };
}

function clamp(n, lo, hi) {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}
